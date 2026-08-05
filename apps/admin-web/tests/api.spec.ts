import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AdminApi, ApiError } from '../src/api.js';
import type { AuthResponse, DashboardMetrics } from '../src/types.js';
import type { BootstrapSetupInput, BootstrapSetupResult } from '../src/types.js';

const refreshTokenKey = 'professor-connect.admin.refresh-token';

test('login administrativo preserva sessão e autentica chamadas protegidas', async () => {
  const storage = installMemoryStorage();
  const originalFetch = globalThis.fetch;
  const requests: { readonly path: string; readonly init: RequestInit | undefined }[] = [];
  const auth = authResponse(['ADMIN']);
  const dashboard: DashboardMetrics = {
    teachers: 3,
    students: 8,
    onlineTeachers: 1,
    onlineStudents: 2,
    activeAttendances: 1,
    finishedAttendances: 5,
    totalUsers: 12,
    generatedAt: '2026-08-05T12:00:00.000Z',
  };
  globalThis.fetch = (input, init) => {
    const path = String(input);
    requests.push({ path, init });
    return Promise.resolve(
      path === '/api/auth/login' ? jsonResponse(auth) : jsonResponse(dashboard),
    );
  };
  try {
    const api = new AdminApi();
    const result = await api.login(
      'admin@instituicao.test',
      'Strong#Password1',
      'instituicao-teste',
    );
    assert.deepEqual(result.identity.roles, ['ADMIN']);
    assert.equal(storage.getItem(refreshTokenKey), 'refresh-token');
    assert.deepEqual(await api.dashboard(), dashboard);
    const authorization = new Headers(requests[1]?.init?.headers).get('authorization');
    assert.equal(authorization, 'Bearer access-token');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('login no painel rejeita professor ou aluno e remove os tokens recebidos', async () => {
  const storage = installMemoryStorage();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(jsonResponse(authResponse(['TEACHER'])));
  try {
    const api = new AdminApi();
    await assert.rejects(
      () => api.login('professor@instituicao.test', 'Strong#Password1', 'instituicao-teste'),
      (error: unknown) => error instanceof ApiError && error.code === 'admin_required',
    );
    assert.equal(storage.getItem(refreshTokenKey), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('bootstrap consulta status, envia o wizard e preserva a sessão automática', async () => {
  const storage = installMemoryStorage();
  const originalFetch = globalThis.fetch;
  const requests: { readonly path: string; readonly init: RequestInit | undefined }[] = [];
  const setupResult: BootstrapSetupResult = {
    ...authResponse(['ADMIN']),
    organization: {
      id: '10000000-0000-4000-8000-000000000001',
      name: 'Instituição Teste',
      slug: 'instituicao-teste',
    },
  };
  globalThis.fetch = (request, init) => {
    const path = String(request);
    requests.push({ path, init });
    return Promise.resolve(
      path === '/api/bootstrap/status'
        ? jsonResponse({ initialized: false })
        : jsonResponse(setupResult, 201),
    );
  };
  try {
    const api = new AdminApi();
    assert.deepEqual(await api.bootstrapStatus(), { initialized: false });
    const result = await api.bootstrapSetup(bootstrapInput(), null, null);
    assert.equal(result.organization.slug, 'instituicao-teste');
    assert.equal(storage.getItem(refreshTokenKey), 'refresh-token');
    assert.equal(storage.getItem('professor-connect.admin.organization'), 'instituicao-teste');
    assert(requests[1]?.init?.body instanceof FormData);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('bootstrap preserva o campo e a mensagem detalhada da validação da API', async () => {
  installMemoryStorage();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          code: 'validation_error',
          message: 'Dados de entrada inválidos',
          issues: [
            {
              path: 'administrator.password',
              message: 'A senha deve ter pelo menos 12 caracteres',
            },
          ],
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      ),
    );
  try {
    const api = new AdminApi();
    await assert.rejects(
      () => api.bootstrapSetup(bootstrapInput(), null, null),
      (error: unknown) =>
        error instanceof ApiError &&
        error.issues[0]?.path === 'administrator.password' &&
        error.issues[0]?.message === 'A senha deve ter pelo menos 12 caracteres',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function authResponse(roles: readonly string[]): AuthResponse {
  return {
    identity: {
      userId: '50000000-0000-4000-8000-000000000003',
      organizationId: '10000000-0000-4000-8000-000000000001',
      email: 'admin@instituicao.test',
      displayName: 'Administrador de Teste',
      roles,
    },
    tokens: { accessToken: 'access-token', refreshToken: 'refresh-token' },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function bootstrapInput(): BootstrapSetupInput {
  return {
    organization: {
      name: 'Instituição Teste',
      tradeName: '',
      taxId: '',
      slug: 'instituicao-teste',
      city: 'São Paulo',
      state: 'SP',
      country: 'BR',
      timezone: 'America/Sao_Paulo',
      language: 'pt-BR',
    },
    administrator: {
      firstName: 'Admin',
      lastName: 'Teste',
      email: 'admin@instituicao.test',
      password: 'Strong#Password1',
      confirmPassword: 'Strong#Password1',
      phone: '',
    },
    settings: {
      systemName: 'Professor Connect',
      theme: 'system',
      language: 'pt-BR',
      defaults: { sessionDurationMinutes: 60, allowSelfRegistration: false },
    },
  };
}

function installMemoryStorage(): Storage {
  const values = new Map<string, string>();
  const storage: Storage = {
    get length(): number {
      return values.size;
    },
    clear(): void {
      values.clear();
    },
    getItem(key): string | null {
      return values.get(key) ?? null;
    },
    key(index): string | null {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key): void {
      values.delete(key);
    },
    setItem(key, value): void {
      values.set(key, value);
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });
  return storage;
}
