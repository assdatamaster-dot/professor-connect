import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';

import type { AuthenticatedIdentity } from '../src/auth/auth.types.js';
import { createApp } from '../src/app.js';
import { TestAdminService } from './admin-fixture.js';
import {
  AUTHORIZATION_HEADERS,
  TEST_IDENTITY,
  TEST_TOKENS,
  TestAuthService,
} from './auth-fixture.js';

test('ADMIN consulta indicadores e usuários com paginação e filtros', async () => {
  const adminService = new TestAdminService();
  await withServer(new TestAuthService(), adminService, async (baseUrl) => {
    const dashboard = await fetch(`${baseUrl}/api/admin/dashboard`, {
      headers: AUTHORIZATION_HEADERS,
    });
    assert.equal(dashboard.status, 200);
    assert.deepEqual(await dashboard.json(), {
      teachers: 4,
      students: 12,
      onlineTeachers: 2,
      onlineStudents: 5,
      activeAttendances: 1,
      finishedAttendances: 30,
      totalUsers: 17,
      generatedAt: '2026-08-05T12:00:00.000Z',
    });
    const users = await fetch(
      `${baseUrl}/api/admin/users?role=TEACHER&name=Ana&email=edu.br&status=ACTIVE&page=2&pageSize=10`,
      { headers: AUTHORIZATION_HEADERS },
    );
    assert.equal(users.status, 200);
    assert.deepEqual(adminService.lastListInput, {
      role: 'TEACHER',
      name: 'Ana',
      email: 'edu.br',
      status: 'ACTIVE',
      page: 2,
      pageSize: 10,
    });
  });
});

test('ADMIN cadastra usuário sem retornar senha', async () => {
  const adminService = new TestAdminService();
  await withServer(new TestAuthService(), adminService, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/admin/users`, {
      method: 'POST',
      headers: { ...AUTHORIZATION_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'TEACHER',
        name: 'Professor Teste',
        email: 'professor@example.edu',
        password: 'Strong#Password1',
        confirmPassword: 'Strong#Password1',
        status: 'ACTIVE',
      }),
    });
    assert.equal(response.status, 201);
    const body = JSON.stringify(await response.json());
    assert.doesNotMatch(body, /Strong#Password1|passwordHash/);
    assert.equal(adminService.lastCreatedInput?.role, 'TEACHER');
  });
});

test('Professor e aluno recebem 403 em todo o painel administrativo', async () => {
  const nonAdminIdentity: AuthenticatedIdentity = {
    ...TEST_IDENTITY,
    roles: ['STUDENT'],
    permissions: ['users.manage'],
  };
  class NonAdminAuthService extends TestAuthService {
    public override verifyAccessToken(token: string): Promise<AuthenticatedIdentity> {
      return token === TEST_TOKENS.accessToken
        ? Promise.resolve(nonAdminIdentity)
        : Promise.reject(new Error('invalid'));
    }
  }
  await withServer(new NonAdminAuthService(), new TestAdminService(), async (baseUrl) => {
    for (const path of ['/api/admin/dashboard', '/api/admin/users?role=STUDENT']) {
      const response = await fetch(`${baseUrl}${path}`, { headers: AUTHORIZATION_HEADERS });
      assert.equal(response.status, 403);
      assert.equal(((await response.json()) as { code: string }).code, 'permission_denied');
    }
  });
});

async function withServer(
  authService: TestAuthService,
  adminService: TestAdminService,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = createServer(
    createApp(undefined, undefined, undefined, undefined, authService, adminService),
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert(address !== null && typeof address === 'object');
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error === undefined ? resolve() : reject(error))),
    );
  }
}
