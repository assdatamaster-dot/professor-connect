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
  type RequestMetadata,
  type TokenPair,
  type UserRole,
} from './auth.types.js';

const USER_INCLUDE = {
  organization: true,
  roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
  professor: true,
  student: true,
} as const;

type UserWithAccess = NonNullable<Awaited<ReturnType<typeof findUserById>>>;

async function findUserById(userId: string) {
  return prismaClient.user.findUnique({ where: { id: userId }, include: USER_INCLUDE });
}

export class AuthService implements AuthServiceContract {
  public async login(
    emailInput: string,
    password: string,
    organizationSlug: string | undefined,
    metadata: RequestMetadata,
  ): Promise<{ identity: AuthenticatedIdentity; tokens: TokenPair }> {
    const email = emailInput.trim().toLowerCase();
    const user = await prismaClient.user.findFirst({
      where: {
        email: { equals: email, mode: 'insensitive' },
        ...(organizationSlug === undefined
          ? {}
          : { organization: { slug: organizationSlug.trim().toLowerCase() } }),
      },
      include: USER_INCLUDE,
    });
    const passwordMatches =
      user?.passwordHash !== null &&
      user?.passwordHash !== undefined &&
      (await bcrypt.compare(password, user.passwordHash));

    if (user === null || !passwordMatches || user.status !== 'ACTIVE') {
      await this.audit('auth.login.failed', undefined, undefined, {
        email,
        organizationSlug,
        ...metadata,
      });
      throw new AuthError('Credenciais inválidas');
    }
    const identity = this.toIdentity(user, randomUUID());
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

  private async issueTokenPair(
    user: UserWithAccess,
    familyId: string,
    metadata: RequestMetadata,
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
    await prismaClient.authToken.create({
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
      roles,
      permissions,
      profileId,
      sessionFamilyId,
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
