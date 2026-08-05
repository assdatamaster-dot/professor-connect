import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { AUTHORIZATION_HEADERS, TEST_IDENTITY, TestAuthService } from './auth-fixture.js';

test('login, refresh, identidade e logout percorrem o fluxo autenticado', async () => {
  const server = createServer(
    createApp(undefined, undefined, undefined, undefined, new TestAuthService()),
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert(address !== null && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'aluno@example.edu', password: 'Strong#Password1' }),
    });
    assert.equal(login.status, 200);
    const refresh = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: 'refresh-token-long-enough-for-validation' }),
    });
    assert.equal(refresh.status, 200);
    const me = await fetch(`${baseUrl}/api/auth/me`, { headers: AUTHORIZATION_HEADERS });
    assert.equal(me.status, 200);
    assert.deepEqual(await me.json(), { identity: TEST_IDENTITY });
    const logout = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: AUTHORIZATION_HEADERS,
    });
    assert.equal(logout.status, 204);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error === undefined ? resolve() : reject(error))),
    );
  }
});

test('cadastro público e perfil funcionam sem bootstrap de usuário', async () => {
  const server = createServer(
    createApp(undefined, undefined, undefined, undefined, new TestAuthService()),
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert(address !== null && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const register = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Aluno Teste',
        email: 'aluno@example.edu',
        password: 'Strong#Password1',
        confirmPassword: 'Strong#Password1',
        role: 'ALUNO',
      }),
    });
    assert.equal(register.status, 201);
    const registerBody = JSON.stringify(await register.json());
    assert.doesNotMatch(registerBody, /passwordHash|Strong#Password1/);
    const invalidRegister = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Aluno Teste',
        email: 'outro@example.edu',
        password: 'Strong#Password1',
        confirmPassword: 'Different#Password2',
        role: 'STUDENT',
      }),
    });
    assert.equal(invalidRegister.status, 400);
    const profile = await fetch(`${baseUrl}/users/me`, { headers: AUTHORIZATION_HEADERS });
    assert.equal(profile.status, 200);
    assert.deepEqual(await profile.json(), {
      name: 'Aluno Teste',
      email: 'aluno@example.edu',
      role: 'STUDENT',
      avatar: null,
      status: 'ACTIVE',
      lastLogin: null,
    });
    const forbiddenFields = await fetch(`${baseUrl}/users/me`, {
      method: 'PUT',
      headers: { ...AUTHORIZATION_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'ADMIN' }),
    });
    assert.equal(forbiddenFields.status, 400);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error === undefined ? resolve() : reject(error))),
    );
  }
});

test('onboarding manual legado não fica exposto fora do wizard', async () => {
  const authService = new TestAuthService();
  const server = createServer(createApp(undefined, undefined, undefined, undefined, authService));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert(address !== null && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const onboarding = await fetch(`${baseUrl}/api/auth/onboard-organization`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organizationName: 'Instituição de Teste',
        organizationSlug: 'instituicao-teste',
        name: 'Administrador de Teste',
        email: 'admin@instituicao.test',
        password: 'Strong#Password1',
        confirmPassword: 'Strong#Password1',
        setupKey: 'onboarding-test-key-with-more-than-32-characters',
      }),
    });
    assert.equal(onboarding.status, 404);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error === undefined ? resolve() : reject(error))),
    );
  }
});
