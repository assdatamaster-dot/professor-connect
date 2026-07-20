import { randomUUID } from 'node:crypto';

import { io, type Socket } from 'socket.io-client';

import { EventType } from '@professor-connect/shared-types';

import { COMMUNICATION_EVENTS } from '../src/modules/communication/communication.events.js';
import type {
  ClientToServerEvents,
  PingMessage,
  ServerToClientEvents,
} from '../src/modules/communication/communication.types.js';

const DEFAULT_SERVER_URL = 'http://localhost:3000';
const CONNECTION_TIMEOUT_MS = 5_000;
const serverUrl = process.argv[2] ?? DEFAULT_SERVER_URL;

const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(serverUrl, {
  autoConnect: false,
  transports: ['websocket'],
});

const connectionTimeout = setTimeout(() => {
  console.error('Tempo limite excedido ao aguardar o pong');
  process.exitCode = 1;
  socket.close();
}, CONNECTION_TIMEOUT_MS);

socket.once(EventType.CONNECT, () => {
  const pingMessage: PingMessage = {
    id: randomUUID(),
    event: EventType.COMMUNICATION_PING,
    timestamp: new Date().toISOString(),
    payload: { type: 'ping' },
  };

  console.info('Cliente de teste conectado');
  socket.emit(COMMUNICATION_EVENTS.ping, pingMessage);
  console.info('Ping enviado');
});

socket.once(COMMUNICATION_EVENTS.pong, (response) => {
  console.info(`Pong recebido: ${JSON.stringify(response)}`);
  socket.disconnect();
});

socket.once(EventType.DISCONNECT, () => {
  clearTimeout(connectionTimeout);
  console.info('Cliente de teste desconectado');
});

socket.once(EventType.CONNECT_ERROR, (error) => {
  clearTimeout(connectionTimeout);
  console.error(`Não foi possível conectar ao servidor: ${error.message}`);
  process.exitCode = 1;
  socket.close();
});

socket.connect();
