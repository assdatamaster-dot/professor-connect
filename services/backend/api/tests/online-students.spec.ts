import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';

import { PresenceManager, StudentPresenceManager } from '@professor-connect/websocket';

import { createApp } from '../src/app.js';
import { AUTHORIZATION_HEADERS, TEST_IDENTITY, TestAuthService } from './auth-fixture.js';

test('GET /api/students/online retorna presenca e estado operacional da organizacao', async () => {
  const studentPresenceManager = new StudentPresenceManager(
    () => new Date('2026-01-01T00:00:00.000Z'),
  );
  const server = createServer(
    createApp(
      new PresenceManager(),
      studentPresenceManager,
      undefined,
      undefined,
      new TestAuthService(),
    ),
  );

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const address = server.address();
    assert(address !== null && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const unauthorized = await fetch(`${baseUrl}/api/students/online`);
    assert.equal(unauthorized.status, 401);
    const emptyResponse = await fetch(`${baseUrl}/api/students/online`, {
      headers: AUTHORIZATION_HEADERS,
    });
    assert.equal(emptyResponse.status, 200);
    assert.deepEqual(await emptyResponse.json(), { count: 0, students: [] });

    studentPresenceManager.registerStudent({
      id: 'student-id',
      name: 'Ana',
      socketId: 'socket-id',
      organizationId: TEST_IDENTITY.organizationId,
    });

    const response = await fetch(`${baseUrl}/api/students/online`, {
      headers: AUTHORIZATION_HEADERS,
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      count: 1,
      students: [
        {
          id: 'student-id',
          name: 'Ana',
          connectionStatus: 'ONLINE',
          attendanceStatus: 'AVAILABLE',
          onlineSince: '2026-01-01T00:00:00.000Z',
          lastHeartbeat: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error === undefined ? resolve() : reject(error)));
    });
  }
});
