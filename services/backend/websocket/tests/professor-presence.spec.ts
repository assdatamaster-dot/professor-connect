import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';

import { Server as SocketServer } from 'socket.io';
import { io, type Socket } from 'socket.io-client';

import {
  PROFESSOR_PRESENCE_EVENTS,
  PresenceManager,
  ProfessorPresenceGateway,
  type ProfessorOnlinePayload,
} from '../src/index.js';
import type { CommunicationLogger } from '../src/modules/communication/communication.types.js';

interface ClientEvents {
  [PROFESSOR_PRESENCE_EVENTS.HEARTBEAT]: () => void;
  [PROFESSOR_PRESENCE_EVENTS.ONLINE]: (payload: ProfessorOnlinePayload) => void;
}

test('mantém a presença nominal enquanto o professor envia heartbeat', async () => {
  const httpServer = createServer();
  const socketServer = new SocketServer<ClientEvents>(httpServer, { serveClient: false });
  const manager = new PresenceManager();
  const messages: string[] = [];
  const logger: CommunicationLogger = {
    info(message): void {
      messages.push(message);
    },
    error(_message, error): void {
      throw error;
    },
  };
  const gateway = new ProfessorPresenceGateway(socketServer, manager, logger, 90_000, 30_000);

  gateway.registerEvents();
  await listen(httpServer);

  const address = httpServer.address();
  assert(address !== null && typeof address === 'object');
  const client: Socket<Record<never, never>, ClientEvents> = io(
    `http://127.0.0.1:${address.port}`,
    { transports: ['websocket'] },
  );

  try {
    await waitForEvent(client, 'connect');
    client.emit(PROFESSOR_PRESENCE_EVENTS.ONLINE, { name: '  Carlos  ' });
    await waitUntil(() => manager.getOnlineProfessors().length === 1);

    const professor = manager.getOnlineProfessors()[0];
    assert(professor !== undefined);
    const previousHeartbeat = professor.lastHeartbeat;

    client.emit(PROFESSOR_PRESENCE_EVENTS.HEARTBEAT);
    await waitUntil(() => messages.includes('Professor Carlos heartbeat'));

    assert.equal(manager.getOnlineProfessors()[0]?.name, 'Carlos');
    const updatedProfessor = manager.getOnlineProfessors()[0];
    assert(updatedProfessor !== undefined);
    assert(updatedProfessor.lastHeartbeat.getTime() >= previousHeartbeat.getTime());
    assert(messages.includes('Professor Carlos conectado'));

    client.disconnect();
    await waitUntil(() => manager.getOnlineProfessors().length === 0);
    assert(messages.includes('Professor Carlos desconectado'));
  } finally {
    client.disconnect();
    gateway.dispose();
    await closeSocketServer(socketServer);
  }
});

test('remove automaticamente professor sem heartbeat após o timeout', () => {
  let now = new Date('2026-01-01T00:00:00.000Z');
  const manager = new PresenceManager(
    () => now,
    () => 'professor-id',
  );

  manager.registerProfessor({ name: 'Carlos', socketId: 'socket-id' });
  now = new Date('2026-01-01T00:01:31.000Z');

  const removed = manager.removeProfessorsWithoutHeartbeat(90_000);

  assert.equal(removed.length, 1);
  assert.equal(removed[0]?.name, 'Carlos');
  assert.deepEqual(manager.getOnlineProfessors(), []);
});

async function listen(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
}

async function closeSocketServer(server: SocketServer<ClientEvents>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

async function waitForEvent(client: Socket, event: 'connect'): Promise<void> {
  if (client.connected) {
    return;
  }
  await new Promise<void>((resolve) => client.once(event, resolve));
}

async function waitUntil(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;

  while (!condition()) {
    if (Date.now() >= deadline) {
      throw new Error('Tempo limite excedido');
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}
