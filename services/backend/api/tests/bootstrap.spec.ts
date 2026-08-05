import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';

import { BootstrapService } from '../src/bootstrap/bootstrap.service.js';
import {
  BootstrapError,
  type BootstrapServiceContract,
  type BootstrapSetupInput,
  type BootstrapSetupResult,
} from '../src/bootstrap/bootstrap.types.js';
import { createApp } from '../src/app.js';

test('endpoints detectam banco vazio, concluem setup e bloqueiam reexecução', async () => {
  class MemoryBootstrapService implements BootstrapServiceContract {
    public initialized = false;
    public lastInput: BootstrapSetupInput | null = null;

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
      this.lastInput = input;
      return Promise.resolve(setupResult());
    }
  }

  const bootstrap = new MemoryBootstrapService();
  const server = createServer(
    createApp(undefined, undefined, undefined, undefined, undefined, undefined, bootstrap),
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert(address !== null && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const initialStatus = await fetch(`${baseUrl}/api/bootstrap/status`);
    assert.equal(initialStatus.status, 200);
    assert.deepEqual(await initialStatus.json(), { initialized: false });

    const setup = await fetch(`${baseUrl}/api/bootstrap/setup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://painel.professor-connect.example',
        'X-Forwarded-Host': 'painel.professor-connect.example',
        'X-Forwarded-Proto': 'https',
      },
      body: JSON.stringify(controllerInput()),
    });
    assert.equal(setup.status, 201);
    assert.equal(
      setup.headers.get('access-control-allow-origin'),
      'https://painel.professor-connect.example',
    );
    const body = (await setup.json()) as BootstrapSetupResult;
    assert.equal(body.identity.roles.includes('ADMIN'), true);
    assert.equal(body.tokens.accessToken, 'access-token');
    assert.equal(bootstrap.lastInput?.organization.slug, 'colegio-teste');
    assert.equal(bootstrap.lastInput?.administrator.avatar, undefined);

    const completedStatus = await fetch(`${baseUrl}/api/bootstrap/status`);
    assert.deepEqual(await completedStatus.json(), { initialized: true });
    const repeated = await fetch(`${baseUrl}/api/bootstrap/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(controllerInput()),
    });
    assert.equal(repeated.status, 403);
    assert.equal(((await repeated.json()) as { code: string }).code, 'bootstrap_already_completed');
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error === undefined ? resolve() : reject(error))),
    );
  }
});

test('serviço cria organização, administrador, configurações, auditoria e sessão atomicamente', async () => {
  const memory = createMemoryDatabase();
  const service = new BootstrapService(
    { createSessionForUser: () => Promise.resolve(setupResult()) } as never,
    memory.database as never,
  );

  assert.deepEqual(await service.initialize(), { initialized: false });
  const result = await service.setup(serviceInput(), {
    ipAddress: '127.0.0.1',
    userAgent: 'bootstrap-test',
  });
  const snapshot = memory.snapshot();
  assert.equal(result.identity.roles.includes('ADMIN'), true);
  assert.equal(snapshot.organizations.length, 1);
  assert.equal(snapshot.users.length, 1);
  assert.equal(snapshot.settings.length, 1);
  assert.equal(snapshot.initializedAt instanceof Date, true);
  assert.deepEqual(
    snapshot.audits.map((audit) => audit.action),
    [
      'bootstrap.started',
      'bootstrap.organization.created',
      'bootstrap.settings.initialized',
      'bootstrap.administrator.created',
      'bootstrap.completed',
    ],
  );
  await assert.rejects(
    () => service.setup(serviceInput(), {}),
    (error: unknown) =>
      error instanceof BootstrapError && error.code === 'bootstrap_already_completed',
  );
});

test('falha ao emitir a sessão desfaz toda a transação de bootstrap', async () => {
  const memory = createMemoryDatabase();
  const service = new BootstrapService(
    {
      createSessionForUser: () => Promise.reject(new Error('falha simulada na sessão')),
    } as never,
    memory.database as never,
  );

  await assert.rejects(() => service.setup(serviceInput(), {}), /falha simulada/);
  const snapshot = memory.snapshot();
  assert.equal(snapshot.initializedAt, null);
  assert.equal(snapshot.organizations.length, 0);
  assert.equal(snapshot.users.length, 0);
  assert.equal(snapshot.settings.length, 0);
  assert.equal(snapshot.audits.length, 0);
  assert.deepEqual(await service.initialize(), { initialized: false });
});

interface MemoryState {
  initializedAt: Date | null;
  organizationId: string | null;
  administratorId: string | null;
  organizations: { id: string; name: string; slug: string }[];
  users: { id: string; organizationId: string }[];
  settings: unknown[];
  audits: { action: string }[];
}

function createMemoryDatabase(): {
  readonly database: unknown;
  readonly snapshot: () => MemoryState;
} {
  let state: MemoryState = {
    initializedAt: null,
    organizationId: null,
    administratorId: null,
    organizations: [],
    users: [],
    settings: [],
    audits: [],
  };
  const root = {
    bootstrapState: {
      findUnique: () => Promise.resolve({ id: 1, initializedAt: state.initializedAt }),
    },
    organization: {
      findFirst: () => Promise.resolve(state.organizations[0] ?? null),
    },
    user: {
      findFirst: () => Promise.resolve(state.users[0] ?? null),
    },
    $transaction: async (run: (transaction: unknown) => Promise<unknown>): Promise<unknown> => {
      const working = structuredClone(state);
      const transaction = {
        bootstrapState: {
          updateMany: (arguments_: { data: { initializedAt: Date } }) => {
            if (working.initializedAt !== null) return Promise.resolve({ count: 0 });
            working.initializedAt = arguments_.data.initializedAt;
            return Promise.resolve({ count: 1 });
          },
          update: (arguments_: {
            data: { organizationId: string; administratorId: string; initializedAt: Date };
          }) => {
            working.organizationId = arguments_.data.organizationId;
            working.administratorId = arguments_.data.administratorId;
            working.initializedAt = arguments_.data.initializedAt;
            return Promise.resolve({});
          },
        },
        organization: {
          findMany: () => Promise.resolve(working.organizations),
          create: (arguments_: { data: { name: string; slug: string } }) => {
            const organization = {
              id: '10000000-0000-4000-8000-000000000001',
              name: arguments_.data.name,
              slug: arguments_.data.slug,
            };
            working.organizations.push(organization);
            return Promise.resolve(organization);
          },
          update: (arguments_: { where: { id: string }; data: { name: string; slug: string } }) => {
            const organization = working.organizations.find(
              (candidate) => candidate.id === arguments_.where.id,
            );
            if (organization === undefined) throw new Error('organização ausente');
            organization.name = arguments_.data.name;
            organization.slug = arguments_.data.slug;
            return Promise.resolve(organization);
          },
        },
        user: {
          count: () => Promise.resolve(working.users.length),
          create: (arguments_: { data: { organizationId: string } }) => {
            const user = {
              id: '50000000-0000-4000-8000-000000000003',
              organizationId: arguments_.data.organizationId,
            };
            working.users.push(user);
            return Promise.resolve(user);
          },
        },
        systemSettings: {
          create: (arguments_: { data: unknown }) => {
            working.settings.push(arguments_.data);
            return Promise.resolve(arguments_.data);
          },
        },
        role: {
          upsert: (arguments_: { where: { name: string } }) =>
            Promise.resolve({ id: `role-${arguments_.where.name}` }),
        },
        permission: {
          upsert: (arguments_: { where: { code: string } }) =>
            Promise.resolve({ id: `permission-${arguments_.where.code}` }),
        },
        rolePermission: { upsert: () => Promise.resolve({}) },
        auditLog: {
          create: (arguments_: { data: { action: string } }) => {
            working.audits.push({ action: arguments_.data.action });
            return Promise.resolve({});
          },
        },
      };
      const result = await run(transaction);
      state = working;
      return result;
    },
  };
  return { database: root, snapshot: () => structuredClone(state) };
}

function controllerInput(): Record<string, unknown> {
  const input = serviceInput();
  return {
    organization: input.organization,
    administrator: { ...input.administrator, confirmPassword: input.administrator.password },
    settings: input.settings,
  };
}

function serviceInput(): BootstrapSetupInput {
  return {
    organization: {
      name: 'Colégio Teste',
      slug: 'colegio-teste',
      city: 'São Paulo',
      state: 'SP',
      country: 'BR',
      timezone: 'America/Sao_Paulo',
      language: 'pt-BR',
    },
    administrator: {
      firstName: 'Admin',
      lastName: 'Principal',
      email: 'admin@colegio.test',
      password: 'Strong#Password1',
    },
    settings: {
      systemName: 'Professor Connect',
      theme: 'system',
      language: 'pt-BR',
      defaults: { sessionDurationMinutes: 60, allowSelfRegistration: false },
    },
  };
}

function setupResult(): BootstrapSetupResult {
  return {
    identity: {
      userId: '50000000-0000-4000-8000-000000000003',
      organizationId: '10000000-0000-4000-8000-000000000001',
      email: 'admin@colegio.test',
      displayName: 'Admin Principal',
      roles: ['ADMIN'],
      permissions: ['users.manage'],
      profileId: undefined,
      sessionFamilyId: '60000000-0000-4000-8000-000000000001',
    },
    tokens: {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      accessTokenExpiresIn: 900,
      refreshTokenExpiresIn: 3600,
      tokenType: 'Bearer',
    },
    organization: {
      id: '10000000-0000-4000-8000-000000000001',
      name: 'Colégio Teste',
      slug: 'colegio-teste',
    },
  };
}
