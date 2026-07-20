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
  EventType,
  SessionStatus,
  type SessionClosePayload,
  type SessionClosedPayload,
  type SessionCreatedPayload,
  type SessionCreatePayload,
  type SessionJoinPayload,
  type SocketMessage,
} from '@professor-connect/shared-types';

import { CommunicationGateway } from '../src/modules/communication/communication.gateway.js';
import { CommunicationService } from '../src/modules/communication/communication.service.js';
import type {
  ClientToServerEvents,
  CommunicationLogger,
  CommunicationServer,
  ServerToClientEvents,
} from '../src/modules/communication/communication.types.js';

const CONDITION_TIMEOUT_MS = 2_000;

test('conecta dois clientes, cria, ativa, encerra e remove uma sessão', async () => {
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
  const heartbeatSettings = {
    intervalMs: 30_000,
    timeoutMs: 90_000,
    reconnectWindowMs: 90_000,
  };
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
  const clientA: Socket<ServerToClientEvents, ClientToServerEvents> = io(serverUrl, {
    transports: ['websocket'],
  });
  const clientB: Socket<ServerToClientEvents, ClientToServerEvents> = io(serverUrl, {
    transports: ['websocket'],
  });

  try {
    await Promise.all([waitForConnection(clientA), waitForConnection(clientB)]);
    assert.equal(connectionService.listClients().length, 2);

    const sessionCreated = new Promise<SocketMessage<SessionCreatedPayload>>((resolve) => {
      clientA.once(EventType.SESSION_CREATED, resolve);
    });

    clientA.emit(
      EventType.SESSION_CREATE,
      createMessage<SessionCreatePayload>(EventType.SESSION_CREATE, {}),
    );

    const createdMessage = await sessionCreated;
    const sessionId = createdMessage.payload.session.id;

    assert.match(
      sessionId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    assert.equal(createdMessage.event, EventType.SESSION_CREATED);
    assert.equal(createdMessage.sessionId, sessionId);

    clientA.emit(
      EventType.SESSION_JOIN,
      createMessage<SessionJoinPayload>(EventType.SESSION_JOIN, {}, sessionId),
    );
    clientB.emit(
      EventType.SESSION_JOIN,
      createMessage<SessionJoinPayload>(EventType.SESSION_JOIN, {}, sessionId),
    );

    await waitUntil(() => sessionService.findSession(sessionId)?.clientIds.length === 2);

    const activeSession = sessionService.findSession(sessionId);
    assert(activeSession !== undefined);
    assert.equal(activeSession.status, SessionStatus.ACTIVE);
    assert.deepEqual(new Set(activeSession.clientIds), new Set([clientA.id, clientB.id]));

    const closedForClientA = waitForClosedSession(clientA);
    const closedForClientB = waitForClosedSession(clientB);

    clientA.emit(
      EventType.SESSION_CLOSE,
      createMessage<SessionClosePayload>(EventType.SESSION_CLOSE, {}, sessionId),
    );

    const [closedMessageA, closedMessageB] = await Promise.all([
      closedForClientA,
      closedForClientB,
    ]);

    assert.equal(closedMessageA.payload.session.status, SessionStatus.FINISHED);
    assert.equal(closedMessageB.payload.session.id, sessionId);
    assert.equal(sessionService.findSession(sessionId), undefined);
    assert.equal(sessionService.listSessions().length, 0);
    assert.equal(loggedErrors.length, 0);

    clientA.disconnect();
    clientB.disconnect();

    await waitUntil(() => connectionService.listClients().length === 0);

    assert.equal(countMessage(loggedMessages, 'Cliente conectado'), 2);
    assert.equal(countMessage(loggedMessages, 'Sessão criada'), 1);
    assert.equal(countMessage(loggedMessages, 'Cliente entrou na sessão'), 2);
    assert.equal(countMessage(loggedMessages, 'Sessão encerrada'), 1);
    assert.equal(countMessage(loggedMessages, 'Cliente desconectado'), 2);
  } finally {
    clientA.close();
    clientB.close();
    await new Promise<void>((resolve) => gateway.close(resolve));
  }
});

function createMessage<T>(event: EventType, payload: T, sessionId?: string): SocketMessage<T> {
  return {
    id: randomUUID(),
    event,
    timestamp: new Date().toISOString(),
    ...(sessionId === undefined ? {} : { sessionId }),
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

function waitForClosedSession(
  client: Socket<ServerToClientEvents, ClientToServerEvents>,
): Promise<SocketMessage<SessionClosedPayload>> {
  return new Promise<SocketMessage<SessionClosedPayload>>((resolve) => {
    client.once(EventType.SESSION_CLOSED, resolve);
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
