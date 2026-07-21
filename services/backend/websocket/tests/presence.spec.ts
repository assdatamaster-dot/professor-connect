import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { test } from 'node:test';

import { Server as SocketServer } from 'socket.io';
import { io, type Socket } from 'socket.io-client';

import {
  CallManager,
  CallService,
  CallStore,
  ConnectionManager,
  ConnectionService,
  HeartbeatManager,
  HeartbeatService,
  PresenceManager,
  PresenceService,
  RequestManager,
  RequestService,
  RequestStore,
  SessionManager,
  SessionService,
  SessionStore,
} from '@professor-connect/services';
import {
  ClientRole,
  EventType,
  PresenceStatus,
  type PresenceListPayload,
  type HeartbeatPongPayload,
  type PresenceQueryPayload,
  type PresenceRegisterPayload,
  type PresenceUpdatePayload,
  type SocketMessage,
} from '@professor-connect/protocol';

import { CommunicationGateway } from '../src/modules/communication/communication.gateway.js';
import { CommunicationService } from '../src/modules/communication/communication.service.js';
import type {
  ClientToServerEvents,
  CommunicationLogger,
  CommunicationServer,
  ServerToClientEvents,
} from '../src/modules/communication/communication.types.js';

const CONDITION_TIMEOUT_MS = 2_000;

test('registra dois professores e três alunos e consulta presença', async () => {
  const loggedMessages: string[] = [];
  const loggedErrors: unknown[] = [];
  const logger: CommunicationLogger = {
    info(message): void {
      loggedMessages.push(message);
    },
    error(_message, error): void {
      loggedErrors.push(error);
    },
  };

  const httpServer = createServer();
  const socketServer: CommunicationServer = new SocketServer<
    ClientToServerEvents,
    ServerToClientEvents
  >(httpServer, { serveClient: false });
  const connectionService = new ConnectionService(new ConnectionManager());
  const presenceService = new PresenceService(new PresenceManager(), connectionService);
  const requestService = new RequestService(
    new RequestManager(new RequestStore()),
    presenceService,
  );
  const callService = new CallService(new CallManager(new CallStore()), requestService);
  const sessionService = new SessionService(
    new SessionManager(new SessionStore()),
    connectionService,
  );
  const heartbeatSettings = { intervalMs: 100, timeoutMs: 1_000, reconnectWindowMs: 1_000 };
  const heartbeatService = new HeartbeatService(
    new HeartbeatManager(heartbeatSettings),
    connectionService,
    presenceService,
    {
      replaceSessionConnection: (previousConnectionId, connectionId) =>
        sessionService.replaceClientConnection(previousConnectionId, connectionId),
      releaseSessions: (connectionId) =>
        sessionService.leaveAllSessions(connectionId).map((change) => change.session),
      listPendingRequests: (clientId) => requestService.listPendingRequestsForClient(clientId),
      listActiveCalls: (clientId) => callService.listActiveCallsForClient(clientId),
    },
    heartbeatSettings,
    logger,
  );
  const gateway = new CommunicationGateway(
    socketServer,
    new CommunicationService(),
    connectionService,
    presenceService,
    requestService,
    callService,
    sessionService,
    heartbeatService,
    logger,
  );

  gateway.registerEvents();

  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', resolve);
  });

  const address = httpServer.address();
  assert(address !== null && typeof address === 'object');

  const serverUrl = `http://127.0.0.1:${address.port}`;
  const clients: Array<Socket<ServerToClientEvents, ClientToServerEvents>> = Array.from(
    { length: 5 },
    () => io(serverUrl, { transports: ['websocket'] }),
  );
  clients.forEach((client) => {
    client.on(EventType.HEARTBEAT_PING, () => {
      client.emit(
        EventType.HEARTBEAT_PONG,
        createMessage<HeartbeatPongPayload>(EventType.HEARTBEAT_PONG, { type: 'pong' }),
      );
    });
  });
  const registrations: readonly PresenceRegisterPayload[] = [
    { clientId: randomUUID(), displayName: 'Professor 1', role: ClientRole.TEACHER },
    { clientId: randomUUID(), displayName: 'Professor 2', role: ClientRole.TEACHER },
    { clientId: randomUUID(), displayName: 'Aluno 1', role: ClientRole.STUDENT },
    { clientId: randomUUID(), displayName: 'Aluno 2', role: ClientRole.STUDENT },
    { clientId: randomUUID(), displayName: 'Aluno 3', role: ClientRole.STUDENT },
  ];

  try {
    await Promise.all(clients.map(waitForConnection));

    registrations.forEach((registration, index) => {
      const client = clients[index];
      assert(client !== undefined);
      client.emit(
        EventType.PRESENCE_REGISTER,
        createMessage(EventType.PRESENCE_REGISTER, registration),
      );
    });

    await waitUntil(() => presenceService.listOnlineClients().length === 5);

    const firstTeacher = clients[0];
    const secondTeacher = clients[1];
    assert(firstTeacher !== undefined && secondTeacher !== undefined);

    firstTeacher.emit(
      EventType.PRESENCE_UPDATE,
      createMessage<PresenceUpdatePayload>(EventType.PRESENCE_UPDATE, {
        status: PresenceStatus.AVAILABLE,
      }),
    );
    secondTeacher.emit(
      EventType.PRESENCE_UPDATE,
      createMessage<PresenceUpdatePayload>(EventType.PRESENCE_UPDATE, {
        status: PresenceStatus.BUSY,
      }),
    );

    await waitUntil(
      () =>
        presenceService.listAvailableTeachers().length === 1 &&
        presenceService.listConnectedStudents().length === 3,
    );

    const onlineMessage = queryPresence(firstTeacher, EventType.PRESENCE_ONLINE);
    firstTeacher.emit(
      EventType.PRESENCE_ONLINE,
      createMessage<PresenceQueryPayload>(EventType.PRESENCE_ONLINE, {}),
    );

    const availableMessage = queryPresence(firstTeacher, EventType.PRESENCE_AVAILABLE);
    firstTeacher.emit(
      EventType.PRESENCE_AVAILABLE,
      createMessage<PresenceQueryPayload>(EventType.PRESENCE_AVAILABLE, {}),
    );

    assert.equal((await onlineMessage).payload.clients.length, 5);

    const availableTeachers = (await availableMessage).payload.clients;
    assert.equal(availableTeachers.length, 1);
    assert.equal(availableTeachers[0]?.displayName, 'Professor 1');
    assert.equal(availableTeachers[0]?.status, PresenceStatus.AVAILABLE);
    assert.equal(presenceService.listConnectedStudents().length, 3);
    assert.equal(loggedErrors.length, 0);

    clients.forEach((client) => client.disconnect());

    await waitUntil(
      () =>
        presenceService.listOnlineClients().length === 0 &&
        connectionService.listClients().length === 0,
    );

    assert.equal(countMessage(loggedMessages, 'Cliente conectado'), 5);
    assert.equal(countMessage(loggedMessages, 'Cliente registrado'), 5);
    assert.equal(countMessage(loggedMessages, 'Status alterado'), 2);
    assert.equal(countMessage(loggedMessages, 'Cliente desconectado'), 5);
  } finally {
    clients.forEach((client) => client.close());
    await new Promise<void>((resolve) => gateway.close(resolve));
  }
});

function createMessage<T>(event: EventType, payload: T): SocketMessage<T> {
  return {
    id: randomUUID(),
    event,
    timestamp: new Date().toISOString(),
    payload,
  };
}

function waitForConnection(
  client: Socket<ServerToClientEvents, ClientToServerEvents>,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    client.once(EventType.CONNECT, () => resolve());
    client.once(EventType.CONNECT_ERROR, reject);
  });
}

function queryPresence(
  client: Socket<ServerToClientEvents, ClientToServerEvents>,
  event: EventType.PRESENCE_ONLINE | EventType.PRESENCE_AVAILABLE,
): Promise<SocketMessage<PresenceListPayload>> {
  return new Promise<SocketMessage<PresenceListPayload>>((resolve) => {
    if (event === EventType.PRESENCE_ONLINE) {
      client.once(EventType.PRESENCE_ONLINE, resolve);
      return;
    }

    client.once(EventType.PRESENCE_AVAILABLE, resolve);
  });
}

async function waitUntil(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + CONDITION_TIMEOUT_MS;

  while (!condition()) {
    if (Date.now() >= deadline) {
      throw new Error('Tempo limite excedido ao aguardar a condição do teste');
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

function countMessage(messages: readonly string[], expectedMessage: string): number {
  return messages.filter((message) => message === expectedMessage).length;
}
