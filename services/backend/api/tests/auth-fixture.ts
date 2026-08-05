import type {
  AuthenticatedIdentity,
  AuthServiceContract,
  OnboardOrganizationInput,
  UserProfile,
  TokenPair,
} from '../src/auth/auth.types.js';

export const TEST_IDENTITY: AuthenticatedIdentity = {
  userId: '50000000-0000-4000-8000-000000000003',
  organizationId: '10000000-0000-4000-8000-000000000001',
  email: 'aluno@example.edu',
  displayName: 'Aluno Teste',
  roles: ['ADMIN'],
  permissions: ['professors.online.read', 'students.online.read', 'sessions.read'],
  profileId: 'student-id',
  sessionFamilyId: '60000000-0000-4000-8000-000000000001',
};
export const TEST_TOKENS: TokenPair = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  accessTokenExpiresIn: 900,
  refreshTokenExpiresIn: 3600,
  tokenType: 'Bearer',
};

export class TestAuthService implements AuthServiceContract {
  public lastOnboardingInput: OnboardOrganizationInput | null = null;
  public lastLogin: {
    readonly email: string;
    readonly password: string;
    readonly organizationSlug?: string;
  } | null = null;
  public register(): Promise<{ identity: AuthenticatedIdentity; tokens: TokenPair }> {
    return Promise.resolve({ identity: TEST_IDENTITY, tokens: TEST_TOKENS });
  }
  public onboardOrganization(
    input: OnboardOrganizationInput,
  ): Promise<{ identity: AuthenticatedIdentity; tokens: TokenPair }> {
    this.lastOnboardingInput = input;
    return Promise.resolve({ identity: TEST_IDENTITY, tokens: TEST_TOKENS });
  }
  public login(
    email: string,
    password: string,
    organizationSlug: string | undefined,
  ): Promise<{ identity: AuthenticatedIdentity; tokens: TokenPair }> {
    this.lastLogin = {
      email,
      password,
      ...(organizationSlug === undefined ? {} : { organizationSlug }),
    };
    return Promise.resolve({ identity: TEST_IDENTITY, tokens: TEST_TOKENS });
  }
  public refresh(): Promise<{ identity: AuthenticatedIdentity; tokens: TokenPair }> {
    return Promise.resolve({ identity: TEST_IDENTITY, tokens: TEST_TOKENS });
  }
  public verifyAccessToken(token: string): Promise<AuthenticatedIdentity> {
    return token === TEST_TOKENS.accessToken
      ? Promise.resolve(TEST_IDENTITY)
      : Promise.reject(new Error('invalid'));
  }
  public logout(): Promise<void> {
    return Promise.resolve();
  }
  public logoutAll(): Promise<void> {
    return Promise.resolve();
  }
  public listSessions(): Promise<readonly Record<string, unknown>[]> {
    return Promise.resolve([]);
  }
  public revokeSession(): Promise<void> {
    return Promise.resolve();
  }
  public changePassword(): Promise<void> {
    return Promise.resolve();
  }
  public getProfile(): Promise<UserProfile> {
    return Promise.resolve({
      name: TEST_IDENTITY.displayName,
      email: TEST_IDENTITY.email,
      role: 'STUDENT',
      avatar: null,
      status: 'ACTIVE',
      lastLogin: null,
    });
  }
  public updateProfile(): Promise<UserProfile> {
    return this.getProfile();
  }
}
export const AUTHORIZATION_HEADERS = {
  Authorization: `Bearer ${TEST_TOKENS.accessToken}`,
} as const;
