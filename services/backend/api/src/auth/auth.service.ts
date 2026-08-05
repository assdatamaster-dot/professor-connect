import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';

import bcrypt from 'bcrypt';
import jwt, { type JwtPayload } from 'jsonwebtoken';

import { environment } from '@professor-connect/config';
import { prismaClient } from '@professor-connect/database';
import type { Prisma } from '@professor-connect/database';

import {
  AuthError,
  type AuthenticatedIdentity,
  type AuthServiceContract,
  type OnboardOrganizationInput,
  type RegisterInput,
  type RequestMetadata,
  type TokenPair,
  type UpdateProfileInput,
  type UserProfile,
  type UserRole,
} from './auth.types.js';
import {
  allowsSelfRegistration,
  resolveAuthenticationOrganization,
} from './authentication-organization.js';

const DUMMY_PASSWORD_HASH = '$2b$12$19xZvnvv/1M6atEpXU5NqelfSx3qxJVcG8q9iJtbPO3JpDa5x9mTK';

const USER_INCLUDE = {
  organization: true,
  roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
  professor: true,
  student: true,
} as const;

type UserWithAccess = NonNullable<Awaited<ReturnType<typeof findUserById>>>;
type AuthDatabase = Pick<Prisma.TransactionClient, 'authToken' | 'user'>;

async function findUserById(userId: string, database: AuthDatabase = prismaClient) {
  return database.user.findFirst({
    where: { id: userId, deletedAt: null },
    include: USER_INCLUDE,
  });
}

export class AuthService implements AuthServiceContract {
  public async createSessionForUser(
    userId: string,
    metadata: RequestMetadata,
    database: AuthDatabase = prismaClient,
  ): Promise<{ identity: AuthenticatedIdentity; tokens: TokenPair }> {
    const user = await findUserById(userId, database);
    if (user === null || user.status !== 'ACTIVE') {
      throw new AuthError('Administrador inicial indisponível', 500, 'bootstrap_session_failed');
    }
    const identity = this.toIdentity(user, randomUUID());
    const tokens = await this.issueTokenPair(user, identity.sessionFamilyId, metadata, database);
    return { identity, tokens };
  }

  public async register(
    input: RegisterInput,
    metadata: RequestMetadata,
  ): Promise<{ identity: AuthenticatedIdentity; tokens: TokenPair }> {
    const email = input.email.trim().toLowerCase();
    const name = input.name.trim().replace(/\s+/g, ' ');
    const passwordHash = await bcrypt.hash(input.password, environment.bcryptRounds);

    try {
      const createdUserId = await prismaClient.$transaction(async (transaction) => {
        const [organization, role] = await Promise.all([
          resolveAuthenticationOrganization(transaction),
          transaction.role.findUnique({ where: { name: input.role } }),
        ]);
        if (organization === null || role === null) {
          throw new AuthError(
            'Configuração de acesso indisponível',
            503,
            'registration_unavailable',
          );
        }
        const settings = await transaction.systemSettings.findUnique({
          where: { organizationId: organization.id },
          select: { defaults: true },
        });
        if (settings === null || !allowsSelfRegistration(settings.defaults)) {
          throw new AuthError(
            'O autocadastro está desativado. Solicite uma conta ao administrador.',
            403,
            'self_registration_disabled',
          );
        }
        const user = await transaction.user.create({
          data: {
            organizationId: organization.id,
            email,
            displayName: name,
            passwordHash,
            passwordChangedAt: new Date(),
            lastLoginAt: new Date(),
            status: 'ACTIVE',
            roles: { create: { roleId: role.id } },
          },
          select: { id: true },
        });
        const profile = {
          id: randomUUID(),
          organizationId: organization.id,
          userId: user.id,
          name,
        };
        if (input.role === 'TEACHER') await transaction.professor.create({ data: profile });
        else await transaction.student.create({ data: profile });
        return user.id;
      });
      const user = await findUserById(createdUserId);
      if (user === null) throw new AuthError('Cadastro não concluído', 500, 'registration_failed');
      const identity = this.toIdentity(user, randomUUID());
      const tokens = await this.issueTokenPair(user, identity.sessionFamilyId, metadata);
      await this.audit('user.registered', user.id, user.organizationId, {
        role: input.role,
        ...metadata,
      });
      return { identity, tokens };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new AuthError('Este e-mail já está cadastrado', 409, 'email_already_registered');
      }
      throw error;
    }
  }

  public async onboardOrganization(
    input: OnboardOrganizationInput,
    metadata: RequestMetadata,
  ): Promise<{ identity: AuthenticatedIdentity; tokens: TokenPair }> {
    this.assertOnboardingKey(input.setupKey);
    const email = input.email.trim().toLowerCase();
    const name = input.name.trim().replace(/\s+/g, ' ');
    const organizationName = input.organizationName.trim().replace(/\s+/g, ' ');
    const organizationSlug = input.organizationSlug.trim().toLowerCase();
    const passwordHash = await bcrypt.hash(input.password, environment.bcryptRounds);

    try {
      const createdUserId = await prismaClient.$transaction(async (transaction) => {
        const role = await transaction.role.findUnique({ where: { name: 'ADMIN' } });
        if (role === null) {
          throw new AuthError('Configuração de acesso indisponível', 503, 'onboarding_unavailable');
        }
        const existingOrganization = await transaction.organization.findUnique({
          where: { slug: organizationSlug },
          select: {
            id: true,
            users: {
              where: { deletedAt: null, roles: { some: { role: { name: 'ADMIN' } } } },
              select: { id: true },
              take: 1,
            },
          },
        });
        if (existingOrganization?.users.length === 1) {
          throw new AuthError(
            'A instituição já possui administrador',
            409,
            'organization_already_onboarded',
          );
        }
        const organization =
          existingOrganization ??
          (await transaction.organization.create({
            data: { name: organizationName, slug: organizationSlug },
            select: { id: true, users: { select: { id: true }, take: 1 } },
          }));
        const duplicate = await transaction.user.findFirst({
          where: {
            organizationId: organization.id,
            email: { equals: email, mode: 'insensitive' },
            deletedAt: null,
          },
          select: { id: true },
        });
        if (duplicate !== null) {
          throw new AuthError('Este e-mail já está cadastrado', 409, 'email_already_registered');
        }
        const user = await transaction.user.create({
          data: {
            organizationId: organization.id,
            email,
            displayName: name,
            passwordHash,
            passwordChangedAt: new Date(),
            lastLoginAt: new Date(),
            status: 'ACTIVE',
            roles: { create: { roleId: role.id } },
          },
          select: { id: true },
        });
        return user.id;
      });
      const user = await findUserById(createdUserId);
      if (user === null) throw new AuthError('Cadastro não concluído', 500, 'onboarding_failed');
      const identity = this.toIdentity(user, randomUUID());
      const tokens = await this.issueTokenPair(user, identity.sessionFamilyId, metadata);
      await this.audit('organization.onboarded', user.id, user.organizationId, {
        organizationSlug,
        ...metadata,
      });
      return { identity, tokens };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new AuthError('Instituição ou e-mail já cadastrado', 409, 'onboarding_conflict');
      }
      throw error;
    }
  }

  public async login(
    emailInput: string,
    password: string,
    organizationSlug: string | undefined,
    metadata: RequestMetadata,
  ): Promise<{ identity: AuthenticatedIdentity; tokens: TokenPair }> {
    const email = emailInput.trim().toLowerCase();
    const organization = await resolveAuthenticationOrganization(prismaClient, organizationSlug);
    const user =
      organization === null
        ? null
        : await prismaClient.user.findFirst({
            where: {
              email: { equals: email, mode: 'insensitive' },
              deletedAt: null,
              organizationId: organization.id,
            },
            include: USER_INCLUDE,
          });
    const passwordMatches = await bcrypt.compare(
      password,
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );

    if (
      user === null ||
      user.passwordHash === null ||
      !passwordMatches ||
      user.status !== 'ACTIVE'
    ) {
      await this.audit('auth.login.failed', undefined, undefined, {
        email,
        organizationSlug: organization?.slug ?? organizationSlug?.trim().toLowerCase() ?? null,
        ...metadata,
      });
      throw new AuthError('Credenciais inválidas');
    }
    const identity = this.toIdentity(user, randomUUID());
    await prismaClient.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    const tokens = await this.issueTokenPair(user, identity.sessionFamilyId, metadata);
    await this.audit('auth.login.succeeded', user.id, user.organizationId ?? undefined, metadata);
    return { identity, tokens };
  }

  public async refresh(
    refreshToken: string,
    metadata: RequestMetadata,
  ): Promise<{ identity: AuthenticatedIdentity; tokens: TokenPair }> {
    const payload = this.verifyJwt(refreshToken, environment.jwtRefreshSecret, 'refresh');
    const tokenId = this.requireClaim(payload, 'jti');
    const familyId = this.requireClaim(payload, 'fid');
    const stored = await prismaClient.authToken.findUnique({ where: { id: tokenId } });

    if (
      stored === null ||
      stored.familyId !== familyId ||
      stored.expiresAt <= new Date() ||
      !this.hashMatches(refreshToken, stored.tokenHash)
    ) {
      throw new AuthError('Refresh token inválido');
    }
    if (stored.revokedAt !== null) {
      await prismaClient.authToken.updateMany({
        where: { familyId },
        data: { revokedAt: new Date() },
      });
      await this.audit(
        'auth.refresh.reuse-detected',
        stored.userId,
        undefined,
        metadata,
        'WARNING',
      );
      throw new AuthError('Sessão revogada', 401, 'session_revoked');
    }
    const user = await findUserById(stored.userId);
    if (user === null || user.status !== 'ACTIVE') {
      throw new AuthError('Usuário inativo', 403, 'user_inactive');
    }

    const claimed = await prismaClient.authToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date(), lastUsedAt: new Date() },
    });
    if (claimed.count !== 1) {
      await prismaClient.authToken.updateMany({
        where: { familyId },
        data: { revokedAt: new Date() },
      });
      await this.audit(
        'auth.refresh.reuse-detected',
        stored.userId,
        user.organizationId ?? undefined,
        metadata,
        'WARNING',
      );
      throw new AuthError('Sessão revogada', 401, 'session_revoked');
    }
    const identity = this.toIdentity(user, familyId);
    const tokens = await this.issueTokenPair(user, familyId, metadata);
    await this.audit('auth.token.refreshed', user.id, user.organizationId ?? undefined, metadata);
    return { identity, tokens };
  }

  public async verifyAccessToken(accessToken: string): Promise<AuthenticatedIdentity> {
    const payload = this.verifyJwt(accessToken, environment.jwtAccessSecret, 'access');
    const userId = this.requireClaim(payload, 'sub');
    const familyId = this.requireClaim(payload, 'sid');
    const [user, activeSession] = await Promise.all([
      findUserById(userId),
      prismaClient.authToken.findFirst({
        where: { familyId, userId, revokedAt: null, expiresAt: { gt: new Date() } },
        select: { id: true },
      }),
    ]);
    if (user === null || user.status !== 'ACTIVE' || activeSession === null) {
      throw new AuthError('Sessão inválida', 401, 'session_invalid');
    }
    return this.toIdentity(user, familyId);
  }

  public async logout(identity: AuthenticatedIdentity): Promise<void> {
    await prismaClient.authToken.updateMany({
      where: { userId: identity.userId, familyId: identity.sessionFamilyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit('auth.logout', identity.userId, identity.organizationId);
  }

  public async logoutAll(identity: AuthenticatedIdentity): Promise<void> {
    await prismaClient.authToken.updateMany({
      where: { userId: identity.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit('auth.sessions.revoked-all', identity.userId, identity.organizationId);
  }

  public async listSessions(
    identity: AuthenticatedIdentity,
  ): Promise<readonly Record<string, unknown>[]> {
    const sessions = await prismaClient.authToken.findMany({
      where: { userId: identity.userId },
      orderBy: { createdAt: 'desc' },
      distinct: ['familyId'],
      select: {
        familyId: true,
        userAgent: true,
        ipAddress: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
      },
    });
    return sessions.map((session) => ({
      ...session,
      current: session.familyId === identity.sessionFamilyId,
      active: session.revokedAt === null && session.expiresAt > new Date(),
    }));
  }

  public async revokeSession(identity: AuthenticatedIdentity, familyId: string): Promise<void> {
    const result = await prismaClient.authToken.updateMany({
      where: { userId: identity.userId, familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count === 0) throw new AuthError('Sessão não encontrada', 404, 'session_not_found');
    await this.audit('auth.session.revoked', identity.userId, identity.organizationId, {
      familyId,
    });
  }

  public async changePassword(
    identity: AuthenticatedIdentity,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await prismaClient.user.findUnique({ where: { id: identity.userId } });
    if (
      user?.passwordHash === null ||
      user?.passwordHash === undefined ||
      !(await bcrypt.compare(currentPassword, user.passwordHash))
    ) {
      await this.audit(
        'auth.password.change-failed',
        identity.userId,
        identity.organizationId,
        undefined,
        'WARNING',
      );
      throw new AuthError('Senha atual inválida');
    }
    const passwordHash = await bcrypt.hash(newPassword, environment.bcryptRounds);
    await prismaClient.$transaction([
      prismaClient.user.update({
        where: { id: identity.userId },
        data: { passwordHash, passwordChangedAt: new Date() },
      }),
      prismaClient.authToken.updateMany({
        where: { userId: identity.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    await this.audit('auth.password.changed', identity.userId, identity.organizationId);
  }

  public async getProfile(identity: AuthenticatedIdentity): Promise<UserProfile> {
    const user = await findUserById(identity.userId);
    if (user === null) throw new AuthError('Usuário não encontrado', 404, 'user_not_found');
    return this.toProfile(user);
  }

  public async updateProfile(
    identity: AuthenticatedIdentity,
    input: UpdateProfileInput,
  ): Promise<UserProfile> {
    const user = await prismaClient.user.findUnique({ where: { id: identity.userId } });
    if (user === null) throw new AuthError('Usuário não encontrado', 404, 'user_not_found');

    let passwordHash: string | undefined;
    if (input.password !== undefined) {
      if (
        input.currentPassword === undefined ||
        user.passwordHash === null ||
        !(await bcrypt.compare(input.currentPassword, user.passwordHash))
      ) {
        await this.audit(
          'auth.password.change-failed',
          identity.userId,
          identity.organizationId,
          undefined,
          'WARNING',
        );
        throw new AuthError('Senha atual inválida');
      }
      passwordHash = await bcrypt.hash(input.password, environment.bcryptRounds);
    }

    const normalizedName = input.name?.trim().replace(/\s+/g, ' ');
    await prismaClient.$transaction(async (transaction) => {
      await transaction.user.update({
        where: { id: identity.userId },
        data: {
          ...(normalizedName === undefined ? {} : { displayName: normalizedName }),
          ...(input.avatar === undefined ? {} : { avatarUrl: input.avatar }),
          ...(passwordHash === undefined ? {} : { passwordHash, passwordChangedAt: new Date() }),
        },
      });
      if (normalizedName !== undefined) {
        if (identity.roles.includes('TEACHER')) {
          await transaction.professor.updateMany({
            where: { userId: identity.userId },
            data: { name: normalizedName },
          });
        } else if (identity.roles.includes('STUDENT')) {
          await transaction.student.updateMany({
            where: { userId: identity.userId },
            data: { name: normalizedName },
          });
        }
      }
      if (passwordHash !== undefined) {
        await transaction.authToken.updateMany({
          where: { userId: identity.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
    });
    await this.audit('user.profile.updated', identity.userId, identity.organizationId, {
      nameChanged: normalizedName !== undefined,
      avatarChanged: input.avatar !== undefined,
    });
    if (passwordHash !== undefined) {
      await this.audit('auth.password.changed', identity.userId, identity.organizationId);
    }
    return this.getProfile(identity);
  }

  private async issueTokenPair(
    user: UserWithAccess,
    familyId: string,
    metadata: RequestMetadata,
    database: AuthDatabase = prismaClient,
  ): Promise<TokenPair> {
    if (user.organizationId === null)
      throw new AuthError('Usuário sem instituição', 403, 'organization_required');
    const tokenId = randomUUID();
    const identity = this.toIdentity(user, familyId);
    const accessToken = jwt.sign(
      {
        typ: 'access',
        org: identity.organizationId,
        roles: identity.roles,
        permissions: identity.permissions,
        profileId: identity.profileId,
        sid: familyId,
      },
      environment.jwtAccessSecret,
      {
        algorithm: 'HS256',
        subject: user.id,
        issuer: environment.jwtIssuer,
        audience: environment.jwtAudience,
        expiresIn: environment.accessTokenTtlSeconds,
        jwtid: randomUUID(),
      },
    );
    const refreshToken = jwt.sign({ typ: 'refresh', fid: familyId }, environment.jwtRefreshSecret, {
      algorithm: 'HS256',
      subject: user.id,
      issuer: environment.jwtIssuer,
      audience: environment.jwtAudience,
      expiresIn: environment.refreshTokenTtlSeconds,
      jwtid: tokenId,
    });
    await database.authToken.create({
      data: {
        id: tokenId,
        userId: user.id,
        familyId,
        tokenHash: this.hash(refreshToken),
        expiresAt: new Date(Date.now() + environment.refreshTokenTtlSeconds * 1000),
        ...(metadata.userAgent === undefined ? {} : { userAgent: metadata.userAgent }),
        ...(metadata.ipAddress === undefined ? {} : { ipAddress: metadata.ipAddress }),
      },
    });
    return {
      accessToken,
      refreshToken,
      accessTokenExpiresIn: environment.accessTokenTtlSeconds,
      refreshTokenExpiresIn: environment.refreshTokenTtlSeconds,
      tokenType: 'Bearer',
    };
  }

  private toIdentity(user: UserWithAccess, sessionFamilyId: string): AuthenticatedIdentity {
    if (user.organizationId === null)
      throw new AuthError('Usuário sem instituição', 403, 'organization_required');
    const roles = user.roles.map(({ role }) => role.name as UserRole);
    const permissions = [
      ...new Set(
        user.roles.flatMap(({ role }) => role.permissions.map(({ permission }) => permission.code)),
      ),
    ];
    const profileId = user.professor?.id ?? user.student?.id;
    return {
      userId: user.id,
      organizationId: user.organizationId,
      email: user.email,
      displayName: user.displayName,
      ...(user.avatarUrl === null ? {} : { avatarUrl: user.avatarUrl }),
      roles,
      permissions,
      profileId,
      sessionFamilyId,
    };
  }

  private toProfile(user: UserWithAccess): UserProfile {
    const role = (['ADMIN', 'TEACHER', 'STUDENT'] as const).find((candidate) =>
      user.roles.some(({ role: assignedRole }) => assignedRole.name === candidate),
    );
    if (role === undefined) throw new AuthError('Usuário sem perfil', 403, 'role_required');
    return {
      name: user.displayName,
      email: user.email,
      role,
      avatar: user.avatarUrl,
      status: user.status,
      lastLogin: user.lastLoginAt,
    };
  }

  private verifyJwt(token: string, secret: string, expectedType: 'access' | 'refresh'): JwtPayload {
    try {
      const payload = jwt.verify(token, secret, {
        algorithms: ['HS256'],
        issuer: environment.jwtIssuer,
        audience: environment.jwtAudience,
      });
      if (typeof payload === 'string' || payload.typ !== expectedType)
        throw new Error('Tipo inválido');
      return payload;
    } catch {
      throw new AuthError('Token inválido ou expirado', 401, 'token_invalid');
    }
  }

  private requireClaim(payload: JwtPayload, claim: 'jti' | 'fid' | 'sub' | 'sid'): string {
    const value = payload[claim];
    if (typeof value !== 'string' || value.length === 0) throw new AuthError('Token inválido');
    return value;
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
  private hashMatches(token: string, expected: string): boolean {
    const actualBuffer = Buffer.from(this.hash(token), 'hex');
    const expectedBuffer = Buffer.from(expected, 'hex');
    return (
      actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
    );
  }

  private assertOnboardingKey(candidate: string): void {
    const expected = environment.adminOnboardingKey;
    if (expected === undefined) {
      throw new AuthError('Onboarding administrativo indisponível', 503, 'onboarding_unavailable');
    }
    const candidateBuffer = Buffer.from(candidate);
    const expectedBuffer = Buffer.from(expected);
    if (
      candidateBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(candidateBuffer, expectedBuffer)
    ) {
      throw new AuthError('Chave de onboarding inválida', 403, 'onboarding_denied');
    }
  }

  private async audit(
    action: string,
    actorId?: string,
    organizationId?: string,
    metadata?: RequestMetadata | Record<string, unknown>,
    severity: 'INFO' | 'WARNING' = 'INFO',
  ): Promise<void> {
    await prismaClient.auditLog
      .create({
        data: {
          actorType: actorId === undefined ? 'anonymous' : 'user',
          ...(actorId === undefined ? {} : { actorId }),
          action,
          ...(organizationId === undefined
            ? {}
            : { entityType: 'organization', entityId: organizationId }),
          severity,
          ...(metadata === undefined ? {} : { metadata: metadata as Prisma.InputJsonValue }),
        },
      })
      .catch(() => undefined);
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}
