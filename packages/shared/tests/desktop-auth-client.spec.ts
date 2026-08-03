import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DesktopAuthClient, type AuthTokenStore, type StoredAuthSession } from '../src/index.js';

class MemoryStore implements AuthTokenStore {
  public session: StoredAuthSession | undefined;
  public load(): Promise<StoredAuthSession | undefined> {
    return Promise.resolve(this.session);
  }
  public save(session: StoredAuthSession): Promise<void> {
    this.session = session;
    return Promise.resolve();
  }
  public clear(): Promise<void> {
    this.session = undefined;
    return Promise.resolve();
  }
}

test('faz login, renova access token automaticamente e elimina refresh expirado', async () => {
  const originalFetch = globalThis.fetch;
  let now = 1_000_000;
  let refreshCount = 0;
  globalThis.fetch = async (input, init) => {
    const url = input.toString();
    if (url.endsWith('/api/auth/login')) return tokenResponse('access-1', 'refresh-1', 60, 120);
    if (url.endsWith('/api/auth/refresh')) {
      refreshCount += 1;
      assert.match(String(init?.body), /refresh-1/);
      return tokenResponse('access-2', 'refresh-2', 60, 120);
    }
    throw new Error(`URL inesperada: ${url}`);
  };
  try {
    const store = new MemoryStore();
    const client = new DesktopAuthClient('https://api.example.edu', store, () => now);
    const identity = await client.login('aluno@example.edu', 'Strong#Password1');
    assert.equal(identity.roles[0], 'STUDENT');
    assert.equal(await client.getAccessToken(), 'access-1');
    now += 31_000;
    assert.equal(await client.getAccessToken(), 'access-2');
    assert.equal(refreshCount, 1);
    now += 121_000;
    await assert.rejects(() => client.getAccessToken(), /Sessão expirada/);
    assert.equal(store.session, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function tokenResponse(
  accessToken: string,
  refreshToken: string,
  accessTokenExpiresIn: number,
  refreshTokenExpiresIn: number,
): Response {
  return Response.json({
    identity: {
      userId: 'user-1',
      organizationId: 'organization-1',
      displayName: 'Aluno',
      email: 'aluno@example.edu',
      roles: ['STUDENT'],
      profileId: 'student-1',
    },
    tokens: {
      accessToken,
      refreshToken,
      accessTokenExpiresIn,
      refreshTokenExpiresIn,
      tokenType: 'Bearer',
    },
  });
}
