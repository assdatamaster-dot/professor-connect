import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';

import { PresenceManager } from '@professor-connect/websocket';

import { createApp } from '../src/app.js';

test('GET /api/professors/online retorna somente id e nome dos professores', async () => {
  const presenceManager = new PresenceManager(
    () => new Date('2026-01-01T00:00:00.000Z'),
    () => 'professor-id',
  );
  const server = createServer(createApp(presenceManager));

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const address = server.address();
    assert(address !== null && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const emptyResponse = await fetch(`${baseUrl}/api/professors/online`);
    assert.equal(emptyResponse.status, 200);
    assert.deepEqual(await emptyResponse.json(), { count: 0, professors: [] });

    presenceManager.registerProfessor({ name: 'Carlos', socketId: 'socket-id' });

    const response = await fetch(`${baseUrl}/api/professors/online`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      count: 1,
      professors: [{ id: 'professor-id', name: 'Carlos' }],
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error === undefined ? resolve() : reject(error)));
    });
  }
});
