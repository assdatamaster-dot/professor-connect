import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';

import { Server as SocketServer } from 'socket.io';
import { io, type Socket } from 'socket.io-client';

import {
  STUDENT_PRESENCE_EVENTS,
  StudentPresenceGateway,
  StudentPresenceManager,
  type StudentRegisterPayload,
} from '../src/index.js';
import type { CommunicationLogger } from '../src/modules/communication/communication.types.js';

interface ClientEvents {
  [STUDENT_PRESENCE_EVENTS.DISCONNECT]: (acknowledge?: () => void) => void;
  [STUDENT_PRESENCE_EVENTS.HEARTBEAT]: () => void;
  [STUDENT_PRESENCE_EVENTS.REGISTER]: (payload: StudentRegisterPayload) => void;
}

test('registra aluno, atualiza heartbeat e remove no evento de saída', async () => {
  const httpServer = createServer();
  const socketServer = new SocketServer<ClientEvents>(httpServer, { serveClient: false });
  const manager = new StudentPresenceManager();
  const messages: string[] = [];
  const logger = createLogger(messages);
  const gateway = new StudentPresenceGateway(socketServer, manager, logger);

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
    client.emit(STUDENT_PRESENCE_EVENTS.REGISTER, {
      id: 'student-id',
      name: '  Ana  ',
    });
    await waitUntil(() => manager.getOnlineStudents().length === 1);

    const student = manager.getOnlineStudents()[0];
    assert(student !== undefined);
    const previousHeartbeat = student.lastHeartbeat;

    client.emit(STUDENT_PRESENCE_EVENTS.HEARTBEAT);
    await waitUntil(() => messages.includes('Aluno Ana heartbeat recebido'));

    const updatedStudent = manager.getOnlineStudents()[0];
    assert(updatedStudent !== undefined);
    assert.equal(updatedStudent.id, 'student-id');
    assert.equal(updatedStudent.name, 'Ana');
    assert(updatedStudent.lastHeartbeat.getTime() >= previousHeartbeat.getTime());
    assert(messages.includes('Aluno Ana conectado'));

    client.emit(STUDENT_PRESENCE_EVENTS.DISCONNECT);
    await waitUntil(() => manager.getOnlineStudents().length === 0);
    assert(messages.includes('Aluno Ana desconectado'));
  } finally {
    client.disconnect();
    gateway.dispose();
    await closeSocketServer(socketServer);
  }
});

test('remove automaticamente aluno sem heartbeat e registra o timeout', async () => {
  const httpServer = createServer();
  const socketServer = new SocketServer<ClientEvents>(httpServer, { serveClient: false });
  const manager = new StudentPresenceManager();
  const messages: string[] = [];
  const gateway = new StudentPresenceGateway(socketServer, manager, createLogger(messages), 30, 5);

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
    client.emit(STUDENT_PRESENCE_EVENTS.REGISTER, { id: 'student-id', name: 'Ana' });
    await waitUntil(() => manager.getOnlineStudents().length === 1);
    await waitUntil(() => messages.includes('Aluno Ana removido por timeout'));

    assert.deepEqual(manager.getOnlineStudents(), []);
  } finally {
    client.disconnect();
    gateway.dispose();
    await closeSocketServer(socketServer);
  }
});

function createLogger(messages: string[]): CommunicationLogger {
  return {
    info(message): void {
      messages.push(message);
    },
    error(_message, error): void {
      throw error;
    },
  };
}

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
