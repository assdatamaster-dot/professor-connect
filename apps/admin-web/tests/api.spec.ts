import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AdminApi, ApiError } from '../src/api.js';
import type { AuthResponse, DashboardMetrics } from '../src/types.js';

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

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
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
