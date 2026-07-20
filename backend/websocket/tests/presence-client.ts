import { randomUUID } from 'node:crypto';

import { io, type Socket } from 'socket.io-client';

import {
  ClientRole,
  EventType,
  PresenceStatus,
  type PresenceListPayload,
  type PresenceQueryPayload,
  type PresenceRegisterPayload,
  type PresenceUpdatePayload,
  type SocketMessage,
} from '@professor-connect/shared-types';

import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '../src/modules/communication/communication.types.js';

const DEFAULT_SERVER_URL = 'http://localhost:3000';
const PRESENCE_WAIT_TIMEOUT_MS = 5_000;
const serverUrl = process.argv[2] ?? DEFAULT_SERVER_URL;

const registrations: readonly PresenceRegisterPayload[] = [
  { clientId: randomUUID(), displayName: 'Professor 1', role: ClientRole.TEACHER },
  { clientId: randomUUID(), displayName: 'Professor 2', role: ClientRole.TEACHER },
  { clientId: randomUUID(), displayName: 'Aluno 1', role: ClientRole.STUDENT },
  { clientId: randomUUID(), displayName: 'Aluno 2', role: ClientRole.STUDENT },
  { clientId: randomUUID(), displayName: 'Aluno 3', role: ClientRole.STUDENT },
];

const clients: Array<Socket<ServerToClientEvents, ClientToServerEvents>> = registrations.map(() =>
  io(serverUrl, {
    autoConnect: false,
    transports: ['websocket'],
  }),
);

try {
  await Promise.all(clients.map(connectClient));

  registrations.forEach((registration, index) => {
    const client = clients[index];

    if (client !== undefined) {
      client.emit(
        EventType.PRESENCE_REGISTER,
        createMessage(EventType.PRESENCE_REGISTER, registration),
      );
    }
  });

  const firstTeacher = clients[0];
  const secondTeacher = clients[1];

  if (firstTeacher === undefined || secondTeacher === undefined) {
    throw new Error('Clientes professores não foram criados');
  }

  await waitForOnlineClients(firstTeacher, registrations.length);

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

  const availableTeachers = await waitForAvailableTeachers(firstTeacher, 1);
  const onlineClients = await queryPresence(firstTeacher, EventType.PRESENCE_ONLINE);
  const connectedStudents = onlineClients.filter((client) => client.role === ClientRole.STUDENT);

  console.info(`Clientes online: ${onlineClients.length}`);
  console.info(`Alunos conectados: ${connectedStudents.length}`);
  console.info(
    `Professores disponíveis: ${availableTeachers.map((client) => client.displayName).join(', ')}`,
  );
} catch (error) {
  const message = error instanceof Error ? error.message : 'Erro desconhecido';
  console.error(`Falha no cliente de presença: ${message}`);
  process.exitCode = 1;
} finally {
  clients.forEach((client) => client.disconnect());
}

function createMessage<T>(event: EventType, payload: T): SocketMessage<T> {
  return {
    id: randomUUID(),
    event,
    timestamp: new Date().toISOString(),
    payload,
  };
}

function connectClient(client: Socket<ServerToClientEvents, ClientToServerEvents>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    client.once(EventType.CONNECT, () => resolve());
    client.once(EventType.CONNECT_ERROR, reject);
    client.connect();
  });
}

async function waitForOnlineClients(
  client: Socket<ServerToClientEvents, ClientToServerEvents>,
  expectedCount: number,
): Promise<void> {
  const deadline = Date.now() + PRESENCE_WAIT_TIMEOUT_MS;

  while (true) {
    const clientsOnline = await queryPresence(client, EventType.PRESENCE_ONLINE);

    if (clientsOnline.length === expectedCount) {
      return;
    }

    if (Date.now() >= deadline) {
      throw new Error('Tempo limite excedido ao consultar clientes online');
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
}

async function waitForAvailableTeachers(
  client: Socket<ServerToClientEvents, ClientToServerEvents>,
  expectedCount: number,
): Promise<PresenceListPayload['clients']> {
  const deadline = Date.now() + PRESENCE_WAIT_TIMEOUT_MS;

  while (true) {
    const availableTeachers = await queryPresence(client, EventType.PRESENCE_AVAILABLE);

    if (availableTeachers.length === expectedCount) {
      return availableTeachers;
    }

    if (Date.now() >= deadline) {
      throw new Error('Tempo limite excedido ao consultar professores disponíveis');
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
}

function queryPresence(
  client: Socket<ServerToClientEvents, ClientToServerEvents>,
  event: EventType.PRESENCE_ONLINE | EventType.PRESENCE_AVAILABLE,
): Promise<PresenceListPayload['clients']> {
  return new Promise<PresenceListPayload['clients']>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Tempo limite excedido ao aguardar ${event}`));
    }, PRESENCE_WAIT_TIMEOUT_MS);
    const handleResponse = (message: SocketMessage<PresenceListPayload>): void => {
      clearTimeout(timeout);
      resolve(message.payload.clients);
    };

    if (event === EventType.PRESENCE_ONLINE) {
      client.once(EventType.PRESENCE_ONLINE, handleResponse);
      client.emit(
        EventType.PRESENCE_ONLINE,
        createMessage<PresenceQueryPayload>(EventType.PRESENCE_ONLINE, {}),
      );
      return;
    }

    client.once(EventType.PRESENCE_AVAILABLE, handleResponse);
    client.emit(
      EventType.PRESENCE_AVAILABLE,
      createMessage<PresenceQueryPayload>(EventType.PRESENCE_AVAILABLE, {}),
    );
  });
}
