import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';

import { PresenceManager } from '@professor-connect/websocket';

import { createApp } from '../src/app.js';
import { AUTHORIZATION_HEADERS, TEST_IDENTITY, TestAuthService } from './auth-fixture.js';

test('GET /api/professors/online retorna somente professores disponíveis', async () => {
  const presenceManager = new PresenceManager(
    () => new Date('2026-01-01T00:00:00.000Z'),
    () => 'professor-id',
  );
  const server = createServer(
    createApp(presenceManager, undefined, undefined, undefined, new TestAuthService()),
  );

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const address = server.address();
    assert(address !== null && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const unauthorized = await fetch(`${baseUrl}/api/professors/online`);
    assert.equal(unauthorized.status, 401);
    const emptyResponse = await fetch(`${baseUrl}/api/professors/online`, {
      headers: AUTHORIZATION_HEADERS,
    });
    assert.equal(emptyResponse.status, 200);
    assert.deepEqual(await emptyResponse.json(), { count: 0, professors: [] });

    presenceManager.registerProfessor({
      name: 'Carlos',
      socketId: 'socket-id',
      organizationId: TEST_IDENTITY.organizationId,
    });

    const response = await fetch(`${baseUrl}/api/professors/online`, {
      headers: AUTHORIZATION_HEADERS,
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      count: 1,
      professors: [
        {
          id: 'professor-id',
          name: 'Carlos',
          status: 'available',
          availableSince: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    presenceManager.setAvailability('socket-id', 'unavailable');
    const unavailableResponse = await fetch(`${baseUrl}/api/professors/online`, {
      headers: AUTHORIZATION_HEADERS,
    });
    assert.deepEqual(await unavailableResponse.json(), { count: 0, professors: [] });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error === undefined ? resolve() : reject(error)));
    });
  }
});
