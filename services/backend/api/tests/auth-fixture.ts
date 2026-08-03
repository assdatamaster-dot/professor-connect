import type {
  AuthenticatedIdentity,
  AuthServiceContract,
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
  public login(): Promise<{ identity: AuthenticatedIdentity; tokens: TokenPair }> {
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
}
export const AUTHORIZATION_HEADERS = {
  Authorization: `Bearer ${TEST_TOKENS.accessToken}`,
} as const;
