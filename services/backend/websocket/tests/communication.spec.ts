import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { test } from 'node:test';

import { io, type Socket } from 'socket.io-client';

import { EventType } from '@professor-connect/protocol';

import { COMMUNICATION_EVENTS } from '../src/modules/communication/communication.events.js';
import type {
  ClientToServerEvents,
  CommunicationLogger,
  PingMessage,
  PongResponse,
  ServerToClientEvents,
} from '../src/modules/communication/communication.types.js';
import {
  authenticatedSocketOptions,
  initializeTestWebSocket,
} from './authenticated-socket-fixture.js';

test('responde ping com SocketMessage e registra o ciclo da conexão', async () => {
  const messages: string[] = [];
  const errors: unknown[] = [];
  let confirmServerDisconnection: (() => void) | undefined;
  const serverDisconnected = new Promise<void>((resolve) => {
    confirmServerDisconnection = resolve;
  });
  const logger: CommunicationLogger = {
    info(message): void {
      messages.push(message);

      if (message === 'Cliente desconectado') {
        confirmServerDisconnection?.();
      }
    },
    error(_message, error): void {
      errors.push(error);
    },
  };
  const httpServer = createServer();
  const gateway = initializeTestWebSocket(httpServer, logger);

  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', resolve);
  });

  const address = httpServer.address();
  assert(address !== null && typeof address === 'object');

  const client: Socket<ServerToClientEvents, ClientToServerEvents> = io(
    `http://127.0.0.1:${address.port}`,
    authenticatedSocketOptions('STUDENT', 'communication-client'),
  );

  try {
    const response = await receivePong(client);

    assert.equal(response.event, EventType.COMMUNICATION_PONG);
    assert.equal(response.payload.type, 'pong');
    assert.equal(Number.isNaN(Date.parse(response.timestamp)), false);
    assert.equal(errors.length, 0);

    const disconnected = new Promise<void>((resolve) => {
      client.once(EventType.DISCONNECT, () => resolve());
    });

    client.disconnect();
    await disconnected;
    await serverDisconnected;

    assert.deepEqual(messages, [
      'Cliente conectado',
      'Ping recebido',
      'Pong enviado',
      'Cliente desconectado',
    ]);
  } finally {
    client.close();
    await new Promise<void>((resolve) => gateway.close(resolve));
  }
});

test('rejeita handshake Socket.IO sem access token', async () => {
  const httpServer = createServer();
  const gateway = initializeTestWebSocket(httpServer, { info(): void {}, error(): void {} });
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const address = httpServer.address();
  assert(address !== null && typeof address === 'object');
  const client = io(`http://127.0.0.1:${address.port}`, {
    transports: ['websocket'],
    reconnection: false,
  });
  try {
    const error = await new Promise<Error>((resolve) => client.once('connect_error', resolve));
    assert.equal(error.message, 'unauthorized');
    assert.equal(client.connected, false);
  } finally {
    client.disconnect();
    await new Promise<void>((resolve) => gateway.close(resolve));
  }
});

async function receivePong(
  client: Socket<ServerToClientEvents, ClientToServerEvents>,
): Promise<PongResponse> {
  return new Promise<PongResponse>((resolve, reject) => {
    client.once(EventType.CONNECT, () => {
      const request: PingMessage = {
        id: randomUUID(),
        event: EventType.COMMUNICATION_PING,
        timestamp: new Date().toISOString(),
        payload: { type: 'ping' },
      };

      client.emit(COMMUNICATION_EVENTS.ping, request);
    });
    client.once(COMMUNICATION_EVENTS.pong, resolve);
    client.once(EventType.CONNECT_ERROR, reject);
  });
}
