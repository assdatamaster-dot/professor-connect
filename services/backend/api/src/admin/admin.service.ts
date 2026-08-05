import { randomUUID } from 'node:crypto';

import bcrypt from 'bcrypt';

import { environment } from '@professor-connect/config';
import { prismaClient, type Prisma } from '@professor-connect/database';
import type {
  PresenceManager,
  SessionManager,
  StudentPresenceManager,
} from '@professor-connect/websocket';

import type { AuthenticatedIdentity, RequestMetadata } from '../auth/auth.types.js';
import {
  AdminError,
  type AdminServiceContract,
  type CreateManagedUserInput,
  type DashboardMetrics,
  type ListUsersInput,
  type ManagedUser,
  type ManagedUserRole,
  type ManagedUserStatus,
  type PaginatedUsers,
  type UpdateManagedUserInput,
  type UserAvatarRecord,
} from './admin.types.js';

const MANAGED_USER_SELECT = {
  id: true,
  displayName: true,
  email: true,
  status: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  roles: { select: { role: { select: { name: true } } } },
  professor: { select: { id: true } },
  student: { select: { id: true } },
  avatar: { select: { updatedAt: true } },
} as const;

type SelectedManagedUser = Prisma.UserGetPayload<{ select: typeof MANAGED_USER_SELECT }>;

export class AdminService implements AdminServiceContract {
  public constructor(
    private readonly professorPresenceManager: PresenceManager,
    private readonly studentPresenceManager: StudentPresenceManager,
    private readonly sessionManager: SessionManager,
    private readonly disconnectRealtimeUser: (userId: string) => void = () => undefined,
  ) {}

  public async dashboard(identity: AuthenticatedIdentity): Promise<DashboardMetrics> {
    const organizationId = identity.organizationId;
    const activeSessions = this.sessionManager.listActiveSessions();
    const onlineTeachers = this.onlineTeacherIds(organizationId);
    const onlineStudents = this.onlineStudentIds(organizationId);
    const activeSessionIds = new Set(
      activeSessions
        .filter(
          (session) =>
            onlineTeachers.has(session.teacherId) || onlineStudents.has(session.studentId),
        )
        .map((session) => session.sessionId),
    );
    const [teachers, students, persistedActiveAttendances, finishedAttendances, totalUsers] =
      await Promise.all([
        this.countUsers(organizationId, 'TEACHER'),
        this.countUsers(organizationId, 'STUDENT'),
        prismaClient.attendanceSession.count({
          where: { status: 'ACTIVE', professor: { organizationId } },
        }),
        prismaClient.attendanceSession.count({
          where: { status: 'FINISHED', professor: { organizationId } },
        }),
        prismaClient.user.count({ where: { organizationId, deletedAt: null } }),
      ]);

    return {
      teachers,
      students,
      onlineTeachers: onlineTeachers.size,
      onlineStudents: onlineStudents.size,
      activeAttendances: Math.max(activeSessionIds.size, persistedActiveAttendances),
      finishedAttendances,
      totalUsers,
      generatedAt: new Date(),
    };
  }

  public async listUsers(
    identity: AuthenticatedIdentity,
    input: ListUsersInput,
  ): Promise<PaginatedUsers> {
    const where: Prisma.UserWhereInput = {
      organizationId: identity.organizationId,
      deletedAt: null,
      roles: { some: { role: { name: input.role } } },
      ...(input.name === undefined
        ? {}
        : { displayName: { contains: input.name, mode: 'insensitive' } }),
      ...(input.email === undefined
        ? {}
        : { email: { contains: input.email, mode: 'insensitive' } }),
      ...(input.status === undefined ? {} : { status: input.status }),
    };
    const [items, totalItems] = await Promise.all([
      prismaClient.user.findMany({
        where,
        select: MANAGED_USER_SELECT,
        orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      prismaClient.user.count({ where }),
    ]);
    const onlineIds =
      input.role === 'TEACHER'
        ? this.onlineTeacherIds(identity.organizationId)
        : this.onlineStudentIds(identity.organizationId);
    return {
      items: items.map((user) => this.toManagedUser(user, onlineIds)),
      pagination: {
        page: input.page,
        pageSize: input.pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / input.pageSize),
      },
    };
  }

  public async createUser(
    identity: AuthenticatedIdentity,
    input: CreateManagedUserInput,
    metadata: RequestMetadata,
  ): Promise<ManagedUser> {
    const email = normalizeEmail(input.email);
    const name = normalizeName(input.name);
    const passwordHash = await bcrypt.hash(input.password, environment.bcryptRounds);
    try {
      const userId = await prismaClient.$transaction(async (transaction) => {
        const [role, duplicate] = await Promise.all([
          transaction.role.findUnique({ where: { name: input.role } }),
          transaction.user.findFirst({
            where: {
              organizationId: identity.organizationId,
              email: { equals: email, mode: 'insensitive' },
              deletedAt: null,
            },
            select: { id: true },
          }),
        ]);
        if (role === null) {
          throw new AdminError('Perfil de acesso indisponível', 503, 'role_unavailable');
        }
        if (duplicate !== null) {
          throw new AdminError('Este e-mail já está cadastrado', 409, 'email_already_registered');
        }
        const user = await transaction.user.create({
          data: {
            organizationId: identity.organizationId,
            email,
            displayName: name,
            passwordHash,
            passwordChangedAt: new Date(),
            status: input.status,
            roles: { create: { roleId: role.id } },
          },
          select: { id: true },
        });
        const profile = {
          id: randomUUID(),
          organizationId: identity.organizationId,
          userId: user.id,
          name,
        };
        if (input.role === 'TEACHER') await transaction.professor.create({ data: profile });
        else await transaction.student.create({ data: profile });
        return user.id;
      });
      await this.audit('admin.user.created', identity, userId, input.role, metadata, {
        status: input.status,
      });
      return this.requireManagedUser(identity, userId);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new AdminError('Este e-mail já está cadastrado', 409, 'email_already_registered');
      }
      throw error;
    }
  }

  public async updateUser(
    identity: AuthenticatedIdentity,
    userId: string,
    input: UpdateManagedUserInput,
    metadata: RequestMetadata,
  ): Promise<ManagedUser> {
    const current = await this.requireManagedUser(identity, userId);
    const normalizedName = input.name === undefined ? undefined : normalizeName(input.name);
    const normalizedEmail = input.email === undefined ? undefined : normalizeEmail(input.email);
    if (normalizedEmail !== undefined && normalizedEmail !== current.email.toLowerCase()) {
      const duplicate = await prismaClient.user.findFirst({
        where: {
          organizationId: identity.organizationId,
          id: { not: userId },
          email: { equals: normalizedEmail, mode: 'insensitive' },
          deletedAt: null,
        },
        select: { id: true },
      });
      if (duplicate !== null) {
        throw new AdminError('Este e-mail já está cadastrado', 409, 'email_already_registered');
      }
    }
    try {
      await prismaClient.$transaction(async (transaction) => {
        await transaction.user.update({
          where: { id: userId },
          data: {
            ...(normalizedName === undefined ? {} : { displayName: normalizedName }),
            ...(normalizedEmail === undefined ? {} : { email: normalizedEmail }),
          },
        });
        if (normalizedName !== undefined) {
          if (current.role === 'TEACHER') {
            await transaction.professor.updateMany({
              where: { userId },
              data: { name: normalizedName },
            });
          } else {
            await transaction.student.updateMany({
              where: { userId },
              data: { name: normalizedName },
            });
          }
        }
      });
      await this.audit('admin.user.updated', identity, userId, current.role, metadata, {
        nameChanged: normalizedName !== undefined,
        emailChanged: normalizedEmail !== undefined,
      });
      return this.requireManagedUser(identity, userId);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new AdminError('Este e-mail já está cadastrado', 409, 'email_already_registered');
      }
      throw error;
    }
  }

  public async updateStatus(
    identity: AuthenticatedIdentity,
    userId: string,
    status: ManagedUserStatus,
    metadata: RequestMetadata,
  ): Promise<ManagedUser> {
    const current = await this.requireManagedUser(identity, userId);
    if (current.status === status) return current;
    await prismaClient.$transaction([
      prismaClient.user.update({ where: { id: userId }, data: { status } }),
      ...(status === 'ACTIVE'
        ? []
        : [
            prismaClient.authToken.updateMany({
              where: { userId, revokedAt: null },
              data: { revokedAt: new Date() },
            }),
          ]),
    ]);
    const action =
      status === 'BLOCKED'
        ? 'admin.user.blocked'
        : current.status === 'BLOCKED' && status === 'ACTIVE'
          ? 'admin.user.unblocked'
          : 'admin.user.status-updated';
    await this.audit(action, identity, userId, current.role, metadata, {
      previousStatus: current.status,
      status,
    });
    if (status !== 'ACTIVE') this.disconnectRealtimeUser(userId);
    return this.requireManagedUser(identity, userId);
  }

  public async resetPassword(
    identity: AuthenticatedIdentity,
    userId: string,
    newPassword: string,
    metadata: RequestMetadata,
  ): Promise<void> {
    const current = await this.requireManagedUser(identity, userId);
    const passwordHash = await bcrypt.hash(newPassword, environment.bcryptRounds);
    await prismaClient.$transaction([
      prismaClient.user.update({
        where: { id: userId },
        data: { passwordHash, passwordChangedAt: new Date() },
      }),
      prismaClient.authToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    await this.audit('admin.user.password-reset', identity, userId, current.role, metadata);
    this.disconnectRealtimeUser(userId);
  }

  public async deleteUser(
    identity: AuthenticatedIdentity,
    userId: string,
    metadata: RequestMetadata,
  ): Promise<void> {
    const current = await this.requireManagedUser(identity, userId);
    const deletedAt = new Date();
    await prismaClient.$transaction(async (transaction) => {
      await transaction.authToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: deletedAt },
      });
      await transaction.userAvatar.deleteMany({ where: { userId } });
      await transaction.user.update({
        where: { id: userId },
        data: {
          email: `${userId}@deleted.invalid`,
          displayName: 'Usuário excluído',
          passwordHash: null,
          avatarUrl: null,
          status: 'INACTIVE',
          deletedAt,
        },
      });
      if (current.role === 'TEACHER') {
        await transaction.professor.updateMany({
          where: { userId },
          data: { name: 'Usuário excluído' },
        });
      } else {
        await transaction.student.updateMany({
          where: { userId },
          data: { name: 'Usuário excluído' },
        });
      }
    });
    await this.audit('admin.user.deleted', identity, userId, current.role, metadata);
    this.disconnectRealtimeUser(userId);
  }

  public async saveAvatar(
    identity: AuthenticatedIdentity,
    userId: string,
    mimeType: string,
    bytes: Uint8Array,
    metadata: RequestMetadata,
  ): Promise<void> {
    const current = await this.requireManagedUser(identity, userId);
    const databaseBytes = new Uint8Array(bytes);
    await prismaClient.userAvatar.upsert({
      where: { userId },
      create: { userId, mimeType, bytes: databaseBytes },
      update: { mimeType, bytes: databaseBytes },
    });
    await this.audit('admin.user.avatar-updated', identity, userId, current.role, metadata);
  }

  public async getAvatar(
    identity: AuthenticatedIdentity,
    userId: string,
  ): Promise<UserAvatarRecord> {
    await this.requireManagedUser(identity, userId);
    const avatar = await prismaClient.userAvatar.findUnique({ where: { userId } });
    if (avatar === null) throw new AdminError('Avatar não encontrado', 404, 'avatar_not_found');
    return avatar;
  }

  public async deleteAvatar(
    identity: AuthenticatedIdentity,
    userId: string,
    metadata: RequestMetadata,
  ): Promise<void> {
    const current = await this.requireManagedUser(identity, userId);
    await prismaClient.userAvatar.deleteMany({ where: { userId } });
    await this.audit('admin.user.avatar-removed', identity, userId, current.role, metadata);
  }

  private countUsers(organizationId: string, role: ManagedUserRole): Promise<number> {
    return prismaClient.user.count({
      where: {
        organizationId,
        deletedAt: null,
        roles: { some: { role: { name: role } } },
      },
    });
  }

  private async requireManagedUser(
    identity: AuthenticatedIdentity,
    userId: string,
  ): Promise<ManagedUser> {
    const user = await prismaClient.user.findFirst({
      where: {
        id: userId,
        organizationId: identity.organizationId,
        deletedAt: null,
        roles: {
          some: { role: { name: { in: ['TEACHER', 'STUDENT'] } } },
          none: { role: { name: 'ADMIN' } },
        },
      },
      select: MANAGED_USER_SELECT,
    });
    if (user === null) throw new AdminError('Usuário não encontrado', 404, 'user_not_found');
    const profileId = user.professor?.id ?? user.student?.id;
    const onlineIds =
      user.professor === null
        ? this.onlineStudentIds(identity.organizationId)
        : this.onlineTeacherIds(identity.organizationId);
    return this.toManagedUser(user, onlineIds, profileId);
  }

  private toManagedUser(
    user: SelectedManagedUser,
    onlineIds: ReadonlySet<string>,
    knownProfileId?: string,
  ): ManagedUser {
    const role = user.roles.some(({ role: assigned }) => assigned.name === 'TEACHER')
      ? 'TEACHER'
      : 'STUDENT';
    const profileId = knownProfileId ?? user.professor?.id ?? user.student?.id ?? null;
    return {
      id: user.id,
      profileId,
      name: user.displayName,
      email: user.email,
      role,
      status: user.status,
      online: profileId !== null && onlineIds.has(profileId),
      hasAvatar: user.avatar !== null,
      avatarUpdatedAt: user.avatar?.updatedAt ?? null,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  private onlineTeacherIds(organizationId: string): ReadonlySet<string> {
    return new Set(
      this.professorPresenceManager
        .getOnlineProfessors()
        .filter((teacher) => teacher.organizationId === organizationId)
        .map((teacher) => teacher.id),
    );
  }

  private onlineStudentIds(organizationId: string): ReadonlySet<string> {
    return new Set(
      this.studentPresenceManager
        .getOnlineStudents()
        .filter((student) => student.organizationId === organizationId)
        .map((student) => student.id),
    );
  }

  private async audit(
    action: string,
    identity: AuthenticatedIdentity,
    targetUserId: string,
    targetRole: ManagedUserRole,
    metadata: RequestMetadata,
    details: Record<string, unknown> = {},
  ): Promise<void> {
    await prismaClient.auditLog.create({
      data: {
        actorType: 'user',
        actorId: identity.userId,
        action,
        entityType: 'user',
        entityId: targetUserId,
        metadata: {
          organizationId: identity.organizationId,
          targetRole,
          ...metadata,
          ...details,
        } as Prisma.InputJsonValue,
      },
    });
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}
