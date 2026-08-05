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

test('ADMIN edita, altera status, redefine senha e exclui usuário', async () => {
  const adminService = new TestAdminService();
  await withServer(new TestAuthService(), adminService, async (baseUrl) => {
    const update = await fetch(`${baseUrl}/api/admin/users/${MANAGED_USER_ID}`, {
      method: 'PUT',
      headers: { ...AUTHORIZATION_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Professor Atualizado', email: 'novo@example.edu' }),
    });
    assert.equal(update.status, 200);
    assert.deepEqual(adminService.lastUpdatedInput, {
      name: 'Professor Atualizado',
      email: 'novo@example.edu',
    });

    const status = await fetch(`${baseUrl}/api/admin/users/${MANAGED_USER_ID}/status`, {
      method: 'PUT',
      headers: { ...AUTHORIZATION_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'BLOCKED' }),
    });
    assert.equal(status.status, 200);
    assert.equal(adminService.lastStatus, 'BLOCKED');

    const password = await fetch(`${baseUrl}/api/admin/users/${MANAGED_USER_ID}/reset-password`, {
      method: 'POST',
      headers: { ...AUTHORIZATION_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        newPassword: 'NewStrong#Password2',
        confirmPassword: 'NewStrong#Password2',
      }),
    });
    assert.equal(password.status, 204);
    assert.equal(adminService.lastPassword, 'NewStrong#Password2');

    const deletion = await fetch(`${baseUrl}/api/admin/users/${MANAGED_USER_ID}`, {
      method: 'DELETE',
      headers: AUTHORIZATION_HEADERS,
    });
    assert.equal(deletion.status, 204);
    assert.equal(adminService.lastDeletedUserId, MANAGED_USER_ID);
  });
});

test('ADMIN envia, consulta e remove avatar validado', async () => {
  const adminService = new TestAdminService();
  await withServer(new TestAuthService(), adminService, async (baseUrl) => {
    const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const form = new FormData();
    form.append('avatar', new Blob([pngBytes], { type: 'image/png' }), 'avatar.png');
    const upload = await fetch(`${baseUrl}/api/admin/users/${MANAGED_USER_ID}/avatar`, {
      method: 'POST',
      headers: AUTHORIZATION_HEADERS,
      body: form,
    });
    assert.equal(upload.status, 204);
    assert.equal(adminService.lastAvatar?.userId, MANAGED_USER_ID);
    assert.equal(adminService.lastAvatar?.mimeType, 'image/png');
    assert.deepEqual(new Uint8Array(adminService.lastAvatar?.bytes ?? []), pngBytes);

    const avatar = await fetch(`${baseUrl}/api/admin/users/${MANAGED_USER_ID}/avatar`, {
      headers: AUTHORIZATION_HEADERS,
    });
    assert.equal(avatar.status, 200);
    assert.equal(avatar.headers.get('content-type'), 'image/png');
    assert.deepEqual(new Uint8Array(await avatar.arrayBuffer()), pngBytes);

    const deletion = await fetch(`${baseUrl}/api/admin/users/${MANAGED_USER_ID}/avatar`, {
      method: 'DELETE',
      headers: AUTHORIZATION_HEADERS,
    });
    assert.equal(deletion.status, 204);
    assert.equal(adminService.lastDeletedAvatarUserId, MANAGED_USER_ID);
  });
});

test('upload administrativo rejeita conteúdo que não corresponde ao MIME', async () => {
  await withServer(new TestAuthService(), new TestAdminService(), async (baseUrl) => {
    const form = new FormData();
    form.append(
      'avatar',
      new Blob([Uint8Array.from([0x00, 0x01, 0x02])], { type: 'image/png' }),
      'avatar.png',
    );
    const response = await fetch(`${baseUrl}/api/admin/users/${MANAGED_USER_ID}/avatar`, {
      method: 'POST',
      headers: AUTHORIZATION_HEADERS,
      body: form,
    });
    assert.equal(response.status, 400);
    assert.equal(((await response.json()) as { code: string }).code, 'invalid_avatar');
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

const MANAGED_USER_ID = '70000000-0000-4000-8000-000000000001';
