import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';

import { PresenceManager, StudentPresenceManager } from '@professor-connect/websocket';

import { createApp } from '../src/app.js';

test('GET /api/students/online retorna somente id e nome dos alunos', async () => {
  const studentPresenceManager = new StudentPresenceManager(
    () => new Date('2026-01-01T00:00:00.000Z'),
  );
  const server = createServer(createApp(new PresenceManager(), studentPresenceManager));

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const address = server.address();
    assert(address !== null && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const emptyResponse = await fetch(`${baseUrl}/api/students/online`);
    assert.equal(emptyResponse.status, 200);
    assert.deepEqual(await emptyResponse.json(), { count: 0, students: [] });

    studentPresenceManager.registerStudent({
      id: 'student-id',
      name: 'Ana',
      socketId: 'socket-id',
    });

    const response = await fetch(`${baseUrl}/api/students/online`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      count: 1,
      students: [{ id: 'student-id', name: 'Ana' }],
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error === undefined ? resolve() : reject(error)));
    });
  }
});
