import { createServer } from 'node:http';

import { AuthError, type AuthenticatedIdentity, type TokenPair } from '../src/auth/auth.types.js';
import {
  BootstrapError,
  type BootstrapServiceContract,
  type BootstrapSetupInput,
  type BootstrapSetupResult,
} from '../src/bootstrap/bootstrap.types.js';
import { createApp } from '../src/app.js';
import { TestAdminService } from './admin-fixture.js';
import { TEST_IDENTITY, TEST_TOKENS, TestAuthService } from './auth-fixture.js';

if (process.env.NODE_ENV === 'production') {
  throw new Error(
    'O servidor de preview administrativo é proibido em produção. Inicie services/backend/api/dist/server.js.',
  );
}

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

class PreviewBootstrapService implements BootstrapServiceContract {
  private initialized = process.env.ADMIN_PREVIEW_FIRST_RUN !== 'true';
  private administratorEmail = email;
  private administratorPassword = password;
  private organizationName = 'Professor Connect';
  private organizationSlug = organizationSlug;

  public initialize(): Promise<{ initialized: boolean }> {
    return Promise.resolve({ initialized: this.initialized });
  }

  public setup(input: BootstrapSetupInput): Promise<BootstrapSetupResult> {
    if (this.initialized) {
      throw new BootstrapError(
        'A configuração inicial já foi concluída.',
        403,
        'bootstrap_already_completed',
      );
    }
    this.initialized = true;
    this.administratorEmail = input.administrator.email.trim().toLowerCase();
    this.administratorPassword = input.administrator.password;
    this.organizationName = input.organization.name;
    this.organizationSlug = input.organization.slug;
    return Promise.resolve({
      identity: {
        ...identity,
        displayName: `${input.administrator.firstName} ${input.administrator.lastName}`,
      },
      tokens: TEST_TOKENS,
      organization: {
        id: identity.organizationId,
        name: this.organizationName,
        slug: this.organizationSlug,
      },
    });
  }

  public recoverSession(
    receivedEmail: string,
    receivedPassword: string,
  ): Promise<BootstrapSetupResult> {
    if (
      !this.initialized ||
      receivedEmail.trim().toLowerCase() !== this.administratorEmail ||
      receivedPassword !== this.administratorPassword
    ) {
      throw new BootstrapError('Credenciais inválidas', 401, 'authentication_failed');
    }
    return Promise.resolve({
      identity,
      tokens: TEST_TOKENS,
      organization: {
        id: identity.organizationId,
        name: this.organizationName,
        slug: this.organizationSlug,
      },
    });
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
    new PreviewBootstrapService(),
  ),
);

server.listen(port, host, () => {
  console.info(`Painel administrativo de teste: http://${host}:${port}/admin/`);
  console.info(`Instituição: ${organizationSlug}`);
  console.info(`Usuário: ${email}`);
  console.info(`Senha: ${password}`);
  console.info('Use ADMIN_PREVIEW_FIRST_RUN=true para abrir o Assistente de Configuração.');
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
