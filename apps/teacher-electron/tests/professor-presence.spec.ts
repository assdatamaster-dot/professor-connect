import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { Server as SocketServer } from 'socket.io';

import { ProfessorPresenceController } from '../main/professor-presence.controller.js';
import { ProfessorPresenceStatus } from '../shared/presence-contracts.js';

interface PresenceEvents {
  'professor:heartbeat': () => void;
  'professor:online': (payload: { readonly name: string }) => void;
}

test('lê config.json, registra o professor e desconecta pelo Socket.IO', async () => {
  const httpServer = createServer();
  const socketServer = new SocketServer<PresenceEvents>(httpServer, { serveClient: false });
  const receivedNames: string[] = [];
  let disconnectCount = 0;

  socketServer.on('connection', (socket) => {
    socket.on('professor:online', ({ name }) => receivedNames.push(name));
    socket.on('disconnect', () => {
      disconnectCount += 1;
    });
  });
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));

  const address = httpServer.address();
  assert(address !== null && typeof address === 'object');
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'professor-connect-'));
  const configPath = path.join(temporaryDirectory, 'config.json');
  await writeFile(
    configPath,
    JSON.stringify({ serverUrl: `http://127.0.0.1:${address.port}` }),
    'utf8',
  );
  const controller = new ProfessorPresenceController(configPath);

  try {
    const initialSnapshot = await controller.connect('  Carlos  ');
    assert.equal(initialSnapshot.status, ProfessorPresenceStatus.CONNECTING);

    await waitUntil(
      () =>
        controller.getSnapshot().status === ProfessorPresenceStatus.CONNECTED &&
        receivedNames[0] === 'Carlos',
    );
    assert.equal(controller.getSnapshot().serverConnected, true);

    const disconnectedSnapshot = controller.disconnect();
    await waitUntil(() => disconnectCount === 1);
    assert.equal(disconnectedSnapshot.status, ProfessorPresenceStatus.DISCONNECTED);
    assert.equal(disconnectedSnapshot.professorName, undefined);
  } finally {
    controller.dispose();
    await new Promise<void>((resolve, reject) => {
      socketServer.close((error) => (error === undefined ? resolve() : reject(error)));
    });
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

async function waitUntil(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;

  while (!condition()) {
    if (Date.now() >= deadline) {
      throw new Error('Tempo limite excedido');
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}
