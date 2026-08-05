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

export interface RegisterInput {
  readonly name: string;
  readonly email: string;
  readonly password: string;
  readonly role: 'TEACHER' | 'STUDENT';
}

export interface OnboardOrganizationInput {
  readonly organizationName: string;
  readonly organizationSlug: string;
  readonly name: string;
  readonly email: string;
  readonly password: string;
  readonly setupKey: string;
}

export interface UserProfile {
  readonly name: string;
  readonly email: string;
  readonly role: 'TEACHER' | 'STUDENT' | 'ADMIN';
  readonly avatar: string | null;
  readonly status: 'ACTIVE' | 'INACTIVE' | 'BLOCKED';
  readonly lastLogin: Date | null;
}

export interface UpdateProfileInput {
  readonly name?: string;
  readonly avatar?: string | null;
  readonly currentPassword?: string;
  readonly password?: string;
}

export interface AuthServiceContract {
  register(
    input: RegisterInput,
    metadata: RequestMetadata,
  ): Promise<{ identity: AuthenticatedIdentity; tokens: TokenPair }>;
  onboardOrganization(
    input: OnboardOrganizationInput,
    metadata: RequestMetadata,
  ): Promise<{ identity: AuthenticatedIdentity; tokens: TokenPair }>;
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
  getProfile(identity: AuthenticatedIdentity): Promise<UserProfile>;
  updateProfile(identity: AuthenticatedIdentity, input: UpdateProfileInput): Promise<UserProfile>;
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
