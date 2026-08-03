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
