import bcrypt from 'bcrypt';

import { environment } from '@professor-connect/config';
import { prismaClient } from '@professor-connect/database';
import type { Prisma } from '@professor-connect/database';

import { AuthService } from '../auth/auth.service.js';
import type { RequestMetadata } from '../auth/auth.types.js';
import {
  BootstrapError,
  type BootstrapServiceContract,
  type BootstrapSetupInput,
  type BootstrapSetupResult,
  type BootstrapStatus,
} from './bootstrap.types.js';

const permissionsByRole = {
  ADMIN: [
    'socket.connect',
    'professors.online.read',
    'students.online.read',
    'sessions.read',
    'session.request',
    'session.respond',
    'webrtc.use',
    'remote-control.request',
    'remote-control.approve',
    'files.transfer',
    'users.manage',
    'audit.read',
  ],
  TEACHER: [
    'socket.connect',
    'students.online.read',
    'sessions.read',
    'session.respond',
    'webrtc.use',
    'remote-control.request',
    'files.transfer',
  ],
  STUDENT: [
    'socket.connect',
    'professors.online.read',
    'sessions.read',
    'session.request',
    'webrtc.use',
    'remote-control.approve',
    'files.transfer',
  ],
} as const;

export class BootstrapService implements BootstrapServiceContract {
  public constructor(
    private readonly authService: Pick<AuthService, 'createSessionForUser'> = new AuthService(),
    private readonly database = prismaClient,
  ) {}

  public async initialize(): Promise<BootstrapStatus> {
    const [state, organization, administrator] = await Promise.all([
      this.database.bootstrapState.findUnique({ where: { id: 1 } }),
      this.database.organization.findFirst({ select: { id: true } }),
      this.database.user.findFirst({
        where: {
          deletedAt: null,
          roles: { some: { role: { name: 'ADMIN' } } },
        },
        select: { id: true },
      }),
    ]);
    if (state === null) {
      throw new BootstrapError(
        'Estado de inicialização indisponível. Verifique as migrations.',
        503,
        'bootstrap_unavailable',
      );
    }
    return {
      initialized:
        state.initializedAt !== null || (organization !== null && administrator !== null),
    };
  }

  public async setup(
    input: BootstrapSetupInput,
    metadata: RequestMetadata,
  ): Promise<BootstrapSetupResult> {
    const passwordHash = await bcrypt.hash(input.administrator.password, environment.bcryptRounds);
    const now = new Date();
    const tradeName = optionalText(input.organization.tradeName);
    const taxId = optionalTaxId(input.organization.taxId);
    const phone = optionalText(input.administrator.phone);

    try {
      return await this.database.$transaction(async (transaction) => {
        const claimed = await transaction.bootstrapState.updateMany({
          where: { id: 1, initializedAt: null },
          data: { initializedAt: now },
        });
        if (claimed.count !== 1) this.alreadyCompleted();

        const [existingOrganizations, administratorCount] = await Promise.all([
          transaction.organization.findMany({ orderBy: { createdAt: 'asc' }, take: 2 }),
          transaction.user.count({
            where: {
              deletedAt: null,
              roles: { some: { role: { name: 'ADMIN' } } },
            },
          }),
        ]);
        if (existingOrganizations.length > 1 || administratorCount > 0) this.alreadyCompleted();

        await this.audit(transaction, 'bootstrap.started', metadata);
        const roles = await this.ensureAccessReferenceData(transaction);
        const organizationData = {
          name: normalizeText(input.organization.name),
          tradeName: tradeName ?? null,
          taxId: taxId ?? null,
          slug: input.organization.slug.trim().toLowerCase(),
          city: normalizeText(input.organization.city),
          state: input.organization.state.trim().toUpperCase(),
          country: input.organization.country.trim().toUpperCase(),
          timezone: input.organization.timezone.trim(),
          language: input.organization.language.trim(),
        };
        const existingOrganization = existingOrganizations[0];
        const organization =
          existingOrganization === undefined
            ? await transaction.organization.create({ data: organizationData })
            : await transaction.organization.update({
                where: { id: existingOrganization.id },
                data: organizationData,
              });
        await this.audit(
          transaction,
          existingOrganization === undefined
            ? 'bootstrap.organization.created'
            : 'bootstrap.organization.configured',
          metadata,
          {
            entityType: 'organization',
            entityId: organization.id,
            organizationSlug: organization.slug,
          },
        );

        await transaction.systemSettings.create({
          data: {
            organizationId: organization.id,
            systemName: normalizeText(input.settings.systemName),
            theme: input.settings.theme,
            language: input.settings.language,
            defaults: input.settings.defaults as Prisma.InputJsonValue,
            ...(input.settings.logo === undefined
              ? {}
              : {
                  logoMimeType: input.settings.logo.mimeType,
                  logoBytes: new Uint8Array(input.settings.logo.bytes),
                }),
          },
        });
        await this.audit(transaction, 'bootstrap.settings.initialized', metadata, {
          entityType: 'organization',
          entityId: organization.id,
          theme: input.settings.theme,
          language: input.settings.language,
        });

        const displayName = normalizeText(
          `${input.administrator.firstName} ${input.administrator.lastName}`,
        );
        const administrator = await transaction.user.create({
          data: {
            organizationId: organization.id,
            email: input.administrator.email.trim().toLowerCase(),
            displayName,
            firstName: normalizeText(input.administrator.firstName),
            lastName: normalizeText(input.administrator.lastName),
            ...(phone === undefined ? {} : { phone }),
            passwordHash,
            passwordChangedAt: now,
            lastLoginAt: now,
            status: 'ACTIVE',
            roles: { create: { roleId: roles.ADMIN } },
            ...(input.administrator.avatar === undefined
              ? {}
              : {
                  avatar: {
                    create: {
                      mimeType: input.administrator.avatar.mimeType,
                      bytes: new Uint8Array(input.administrator.avatar.bytes),
                    },
                  },
                }),
          },
        });
        await this.audit(transaction, 'bootstrap.administrator.created', metadata, {
          actorId: administrator.id,
          entityType: 'user',
          entityId: administrator.id,
          organizationId: organization.id,
        });

        await transaction.bootstrapState.update({
          where: { id: 1 },
          data: {
            initializedAt: now,
            organizationId: organization.id,
            administratorId: administrator.id,
          },
        });
        const session = await this.authService.createSessionForUser(
          administrator.id,
          metadata,
          transaction,
        );
        await this.audit(transaction, 'bootstrap.completed', metadata, {
          actorId: administrator.id,
          entityType: 'organization',
          entityId: organization.id,
          organizationSlug: organization.slug,
        });
        return {
          ...session,
          organization: {
            id: organization.id,
            name: organization.name,
            slug: organization.slug,
          },
        };
      });
    } catch (error) {
      if (error instanceof BootstrapError) throw error;
      if (isUniqueConstraintError(error)) {
        throw new BootstrapError(
          'Instituição, CNPJ ou e-mail já cadastrado',
          409,
          'bootstrap_conflict',
        );
      }
      throw error;
    }
  }

  private alreadyCompleted(): never {
    throw new BootstrapError(
      'A configuração inicial já foi concluída.',
      403,
      'bootstrap_already_completed',
    );
  }

  private async ensureAccessReferenceData(
    transaction: Prisma.TransactionClient,
  ): Promise<Record<keyof typeof permissionsByRole, string>> {
    const roleIds = {} as Record<keyof typeof permissionsByRole, string>;
    for (const [roleName, permissionCodes] of Object.entries(permissionsByRole) as [
      keyof typeof permissionsByRole,
      readonly string[],
    ][]) {
      const role = await transaction.role.upsert({
        where: { name: roleName },
        create: { name: roleName, description: `Perfil ${roleName.toLowerCase()}` },
        update: {},
      });
      roleIds[roleName] = role.id;
      for (const code of permissionCodes) {
        const permission = await transaction.permission.upsert({
          where: { code },
          create: { code, description: `Permissão ${code}` },
          update: {},
        });
        await transaction.rolePermission.upsert({
          where: {
            roleId_permissionId: { roleId: role.id, permissionId: permission.id },
          },
          create: { roleId: role.id, permissionId: permission.id },
          update: {},
        });
      }
    }
    return roleIds;
  }

  private async audit(
    transaction: Prisma.TransactionClient,
    action: string,
    metadata: RequestMetadata,
    context: {
      readonly actorId?: string;
      readonly entityType?: string;
      readonly entityId?: string;
      readonly [key: string]: unknown;
    } = {},
  ): Promise<void> {
    const { actorId, entityType, entityId, ...details } = context;
    await transaction.auditLog.create({
      data: {
        actorType: actorId === undefined ? 'anonymous' : 'user',
        ...(actorId === undefined ? {} : { actorId }),
        action,
        ...(entityType === undefined ? {} : { entityType }),
        ...(entityId === undefined ? {} : { entityId }),
        metadata: { ...metadata, ...details } as Prisma.InputJsonValue,
      },
    });
  }
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function optionalText(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  return normalizeText(value);
}

function optionalTaxId(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\D/g, '');
  return normalized === undefined || normalized === '' ? undefined : normalized;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}
