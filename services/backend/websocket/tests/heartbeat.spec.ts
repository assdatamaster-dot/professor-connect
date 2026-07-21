import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { test } from 'node:test';

import { io, type Socket } from 'socket.io-client';

import {
  ClientRole,
  EventType,
  type ConnectionLifecyclePayload,
  type ConnectionRecoveryPayload,
  type PresenceRegisterPayload,
  type SessionCreatedPayload,
  type SessionCreatePayload,
  type SessionJoinPayload,
  type SocketMessage,
} from '@professor-connect/protocol';

import { initializeWebSocket } from '../src/socket-server.js';
import type {
  ClientToServerEvents,
  CommunicationLogger,
  ServerToClientEvents,
} from '../src/modules/communication/communication.types.js';

const CLIENT_ID = 'student-recovery';
const CONDITION_TIMEOUT_MS = 2_000;
type TestClient = Socket<ServerToClientEvents, ClientToServerEvents>;

test('recupera o cliente e a Session pelo protocolo oficial antes do timeout', async () => {
  const errors: unknown[] = [];
  const logger: CommunicationLogger = {
    info(): void {},
    error(_message, error): void {
      errors.push(error);
    },
  };
  const httpServer = createServer();
  const gateway = initializeWebSocket(httpServer, logger, 60_000, {
    intervalMs: 50,
    timeoutMs: 1_000,
    reconnectWindowMs: 800,
  });

  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const address = httpServer.address();
  assert(address !== null && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}`;
  const observer: TestClient = io(url, { transports: ['websocket'], reconnection: false });
  const firstClient: TestClient = io(url, { transports: ['websocket'], reconnection: false });
  let recoveredClient: TestClient | undefined;

  try {
    await Promise.all([waitForConnection(observer), waitForConnection(firstClient)]);
    registerPresence(firstClient);

    const createdSessionMessage = waitForEvent(firstClient, EventType.SESSION_CREATED);
    firstClient.emit(
      EventType.SESSION_CREATE,
      createMessage<SessionCreatePayload>(EventType.SESSION_CREATE, {}),
    );
    const createdSession = (await createdSessionMessage).payload.session;

    firstClient.emit(
      EventType.SESSION_JOIN,
      createSessionMessage<SessionJoinPayload>(EventType.SESSION_JOIN, createdSession.id, {}),
    );
    await delay(25);

    const connectionLost = waitForEvent(observer, EventType.CONNECTION_LOST);
    const previousConnectionId = firstClient.id;
    assert(previousConnectionId !== undefined);
    firstClient.disconnect();

    const lostPayload = (await connectionLost).payload;
    assert.equal(lostPayload.clientId, CLIENT_ID);
    assert.equal(lostPayload.connectionId, previousConnectionId);

    recoveredClient = io(url, { transports: ['websocket'], reconnection: false });
    await waitForConnection(recoveredClient);
    const connectionRecovered = waitForEvent(recoveredClient, EventType.CONNECTION_RECOVERED);
    registerPresence(recoveredClient);
    const recovery = (await connectionRecovered).payload;

    assert.equal(recovery.clientId, CLIENT_ID);
    assert.equal(recovery.previousConnectionId, previousConnectionId);
    assert.equal(recovery.connectionId, recoveredClient.id);
    assert.equal(recovery.presence.clientId, CLIENT_ID);
    assert.deepEqual(
      recovery.sessions.map((session) => session.id),
      [createdSession.id],
    );
    assert.deepEqual(recovery.sessions[0]?.clientIds, [recoveredClient.id]);
    assert.equal(errors.length, 0);

    const connectionTimeout = waitForEvent(observer, EventType.CONNECTION_TIMEOUT);
    recoveredClient.disconnect();
    const timeout = (await connectionTimeout).payload;

    assert.equal(timeout.clientId, CLIENT_ID);
    assert.equal(timeout.connectionId, recovery.connectionId);
  } finally {
    firstClient.close();
    recoveredClient?.close();
    observer.close();
    await new Promise<void>((resolve) => gateway.close(resolve));
  }
});

function registerPresence(client: TestClient): void {
  const payload: PresenceRegisterPayload = {
    clientId: CLIENT_ID,
    displayName: 'Aluno Recovery',
    role: ClientRole.STUDENT,
  };

  client.emit(EventType.PRESENCE_REGISTER, createMessage(EventType.PRESENCE_REGISTER, payload));
}

function createMessage<T>(event: EventType, payload: T): SocketMessage<T> {
  return {
    id: randomUUID(),
    event,
    timestamp: new Date().toISOString(),
    payload,
  };
}

function createSessionMessage<T>(
  event: EventType,
  sessionId: string,
  payload: T,
): SocketMessage<T> {
  return { ...createMessage(event, payload), sessionId };
}

function waitForConnection(client: TestClient): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    client.once(EventType.CONNECT, () => resolve());
    client.once(EventType.CONNECT_ERROR, reject);
  });
}

function waitForEvent(
  client: TestClient,
  event: EventType.SESSION_CREATED,
): Promise<SocketMessage<SessionCreatedPayload>>;
function waitForEvent(
  client: TestClient,
  event: EventType.CONNECTION_LOST | EventType.CONNECTION_TIMEOUT,
): Promise<SocketMessage<ConnectionLifecyclePayload>>;
function waitForEvent(
  client: TestClient,
  event: EventType.CONNECTION_RECOVERED,
): Promise<SocketMessage<ConnectionRecoveryPayload>>;
function waitForEvent(
  client: TestClient,
  event:
    | EventType.SESSION_CREATED
    | EventType.CONNECTION_LOST
    | EventType.CONNECTION_TIMEOUT
    | EventType.CONNECTION_RECOVERED,
): Promise<
  SocketMessage<SessionCreatedPayload | ConnectionLifecyclePayload | ConnectionRecoveryPayload>
> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Evento não recebido: ${event}`)),
      CONDITION_TIMEOUT_MS,
    );

    client.once(
      event,
      (
        message: SocketMessage<
          SessionCreatedPayload | ConnectionLifecyclePayload | ConnectionRecoveryPayload
        >,
      ) => {
        clearTimeout(timeout);
        resolve(message);
      },
    );
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
