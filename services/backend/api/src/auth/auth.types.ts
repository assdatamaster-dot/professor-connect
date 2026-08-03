export type UserRole = 'ADMIN' | 'TEACHER' | 'STUDENT';

export interface AuthenticatedIdentity {
  readonly userId: string;
  readonly organizationId: string;
  readonly email: string;
  readonly displayName: string;
  readonly roles: readonly UserRole[];
  readonly permissions: readonly string[];
  readonly profileId: string | undefined;
  readonly sessionFamilyId: string;
}

export interface TokenPair {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly accessTokenExpiresIn: number;
  readonly refreshTokenExpiresIn: number;
  readonly tokenType: 'Bearer';
}

export interface RequestMetadata {
  readonly ipAddress?: string;
  readonly userAgent?: string;
}

export interface AuthServiceContract {
  login(
    email: string,
    password: string,
    organizationSlug: string | undefined,
    metadata: RequestMetadata,
  ): Promise<{ identity: AuthenticatedIdentity; tokens: TokenPair }>;
  refresh(
    refreshToken: string,
    metadata: RequestMetadata,
  ): Promise<{ identity: AuthenticatedIdentity; tokens: TokenPair }>;
  verifyAccessToken(accessToken: string): Promise<AuthenticatedIdentity>;
  logout(identity: AuthenticatedIdentity): Promise<void>;
  logoutAll(identity: AuthenticatedIdentity): Promise<void>;
  listSessions(identity: AuthenticatedIdentity): Promise<readonly Record<string, unknown>[]>;
  revokeSession(identity: AuthenticatedIdentity, familyId: string): Promise<void>;
  changePassword(
    identity: AuthenticatedIdentity,
    currentPassword: string,
    newPassword: string,
  ): Promise<void>;
}

export class AuthError extends Error {
  public constructor(
    message: string,
    public readonly statusCode = 401,
    public readonly code = 'authentication_failed',
  ) {
    super(message);
    this.name = 'AuthError';
  }
}
