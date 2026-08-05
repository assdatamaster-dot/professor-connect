import { createServer } from 'node:http';

import { AuthError, type AuthenticatedIdentity, type TokenPair } from '../src/auth/auth.types.js';
import { createApp } from '../src/app.js';
import { TestAdminService } from './admin-fixture.js';
import { TEST_IDENTITY, TEST_TOKENS, TestAuthService } from './auth-fixture.js';

const host = '127.0.0.1';
const port = Number(process.env.ADMIN_PREVIEW_PORT ?? '4300');
const email = 'admin@professor-connect.test';
const password = 'Admin#ProfessorConnect2026';
const organizationSlug = 'professor-connect';
const identity: AuthenticatedIdentity = {
  ...TEST_IDENTITY,
  email,
  displayName: 'Administrador de Teste',
  roles: ['ADMIN'],
  profileId: undefined,
};

class PreviewAuthService extends TestAuthService {
  public override login(
    receivedEmail: string,
    receivedPassword: string,
    receivedOrganizationSlug: string | undefined,
  ): Promise<{ identity: AuthenticatedIdentity; tokens: TokenPair }> {
    if (
      receivedEmail.trim().toLowerCase() !== email ||
      receivedPassword !== password ||
      receivedOrganizationSlug !== organizationSlug
    ) {
      throw new AuthError('Credenciais inválidas');
    }
    return Promise.resolve({ identity, tokens: TEST_TOKENS });
  }

  public override refresh(): Promise<{ identity: AuthenticatedIdentity; tokens: TokenPair }> {
    return Promise.resolve({ identity, tokens: TEST_TOKENS });
  }

  public override verifyAccessToken(token: string): Promise<AuthenticatedIdentity> {
    return token === TEST_TOKENS.accessToken
      ? Promise.resolve(identity)
      : Promise.reject(new AuthError('Token inválido'));
  }
}

const server = createServer(
  createApp(
    undefined,
    undefined,
    undefined,
    undefined,
    new PreviewAuthService(),
    new TestAdminService(),
  ),
);

server.listen(port, host, () => {
  console.info(`Painel administrativo de teste: http://${host}:${port}/admin/`);
  console.info(`Instituição: ${organizationSlug}`);
  console.info(`Usuário: ${email}`);
  console.info(`Senha: ${password}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
