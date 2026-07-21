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
  type RequestCreatePayload,
  type RequestPayload,
  type RequestReferencePayload,
  type RequestRejectedPayload,
  type ServiceRequest,
  type SocketMessage,
} from '@professor-connect/protocol';

import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '../src/modules/communication/communication.types.js';

const DEFAULT_SERVER_URL = 'http://localhost:3000';
const RESPONSE_TIMEOUT_MS = 70_000;
const serverUrl = process.argv[2] ?? DEFAULT_SERVER_URL;

type TestClient = Socket<ServerToClientEvents, ClientToServerEvents>;

const registrations: readonly PresenceRegisterPayload[] = [
  { clientId: randomUUID(), displayName: 'Professor 1', role: ClientRole.TEACHER },
  { clientId: randomUUID(), displayName: 'Professor 2', role: ClientRole.TEACHER },
  { clientId: randomUUID(), displayName: 'Professor 3', role: ClientRole.TEACHER },
  { clientId: randomUUID(), displayName: 'Aluno 1', role: ClientRole.STUDENT },
  { clientId: randomUUID(), displayName: 'Aluno 2', role: ClientRole.STUDENT },
];
const clients: TestClient[] = registrations.map(() =>
  io(serverUrl, { autoConnect: false, transports: ['websocket'] }),
);

try {
  await Promise.all(clients.map(connectClient));
  registerClients();

  const teachers = clients.slice(0, 3);
  const firstStudent = clients[3];
  const secondStudent = clients[4];

  if (teachers.length !== 3 || firstStudent === undefined || secondStudent === undefined) {
    throw new Error('Não foi possível criar os clientes da simulação');
  }

  await waitForOnlineClients(firstStudent, registrations.length);
  teachers.forEach((teacher) => {
    teacher.emit(
      EventType.PRESENCE_UPDATE,
      createMessage<PresenceUpdatePayload>(EventType.PRESENCE_UPDATE, {
        status: PresenceStatus.AVAILABLE,
      }),
    );
  });
  await waitForAvailableTeachers(firstStudent, teachers.length);

  const acceptedCandidate = await createRequest(firstStudent, teachers[0]);
  const acceptedMessage = waitForRequestMessage(firstStudent, EventType.REQUEST_ACCEPTED);
  teachers[0]?.emit(
    EventType.REQUEST_ACCEPT,
    createMessage<RequestReferencePayload>(EventType.REQUEST_ACCEPT, {
      requestId: acceptedCandidate.requestId,
    }),
  );
  const acceptedRequest = (await acceptedMessage).payload.request;
  console.info(`Request aceita: ${acceptedRequest.requestId}`);

  const cancelledCandidate = await createRequest(secondStudent, teachers[0]);

  for (const teacher of teachers) {
    const rejectedMessage = waitForRequestRejection(teacher);
    teacher.emit(
      EventType.REQUEST_REJECT,
      createMessage<RequestReferencePayload>(EventType.REQUEST_REJECT, {
        requestId: cancelledCandidate.requestId,
      }),
    );
    await rejectedMessage;
  }

  console.info(
    `Request rejeitada pelos 3 professores e ainda pendente: ${cancelledCandidate.requestId}`,
  );

  const cancelledMessage = waitForRequestMessage(secondStudent, EventType.REQUEST_CANCELLED);
  secondStudent.emit(
    EventType.REQUEST_CANCEL,
    createMessage<RequestReferencePayload>(EventType.REQUEST_CANCEL, {
      requestId: cancelledCandidate.requestId,
    }),
  );
  const cancelledRequest = (await cancelledMessage).payload.request;
  console.info(`Request cancelada: ${cancelledRequest.requestId}`);

  const expiredMessage = waitForRequestMessage(firstStudent, EventType.REQUEST_EXPIRED);
  const expiringCandidate = await createRequest(firstStudent, teachers[0]);
  const expiredRequest = (await expiredMessage).payload.request;

  if (expiredRequest.requestId !== expiringCandidate.requestId) {
    throw new Error('A notificação de expiração não corresponde à Request criada');
  }

  console.info(`Request expirada: ${expiredRequest.requestId}`);
} catch (error) {
  const message = error instanceof Error ? error.message : 'Erro desconhecido';
  console.error(`Falha no cliente de requests: ${message}`);
  process.exitCode = 1;
} finally {
  clients.forEach((client) => client.disconnect());
}

function registerClients(): void {
  registrations.forEach((registration, index) => {
    clients[index]?.emit(
      EventType.PRESENCE_REGISTER,
      createMessage(EventType.PRESENCE_REGISTER, registration),
    );
  });
}

async function createRequest(
  student: TestClient,
  teacher: TestClient | undefined,
): Promise<ServiceRequest> {
  if (teacher === undefined) {
    throw new Error('Professor não disponível na simulação');
  }

  const createdMessage = waitForRequestMessage(student, EventType.REQUEST_CREATED);
  const receivedMessage = waitForRequestMessage(teacher, EventType.REQUEST_RECEIVED);

  student.emit(
    EventType.REQUEST_CREATE,
    createMessage<RequestCreatePayload>(EventType.REQUEST_CREATE, {}),
  );

  const request = (await createdMessage).payload.request;
  const receivedRequest = (await receivedMessage).payload.request;

  if (receivedRequest.requestId !== request.requestId) {
    throw new Error('Professor recebeu uma Request diferente da criada');
  }

  console.info(`Request criada e recebida: ${request.requestId}`);

  return request;
}

function createMessage<T>(event: EventType, payload: T): SocketMessage<T> {
  return {
    id: randomUUID(),
    event,
    timestamp: new Date().toISOString(),
    payload,
  };
}

function connectClient(client: TestClient): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    client.once(EventType.CONNECT, () => resolve());
    client.once(EventType.CONNECT_ERROR, reject);
    client.connect();
  });
}

async function waitForOnlineClients(client: TestClient, expectedCount: number): Promise<void> {
  await waitForPresenceCount(client, EventType.PRESENCE_ONLINE, expectedCount);
}

async function waitForAvailableTeachers(client: TestClient, expectedCount: number): Promise<void> {
  await waitForPresenceCount(client, EventType.PRESENCE_AVAILABLE, expectedCount);
}

async function waitForPresenceCount(
  client: TestClient,
  event: EventType.PRESENCE_ONLINE | EventType.PRESENCE_AVAILABLE,
  expectedCount: number,
): Promise<void> {
  const deadline = Date.now() + RESPONSE_TIMEOUT_MS;

  while (true) {
    const response = await queryPresence(client, event);

    if (response.length === expectedCount) {
      return;
    }

    if (Date.now() >= deadline) {
      throw new Error(`Tempo limite excedido ao consultar ${event}`);
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
}

function queryPresence(
  client: TestClient,
  event: EventType.PRESENCE_ONLINE | EventType.PRESENCE_AVAILABLE,
): Promise<PresenceListPayload['clients']> {
  return new Promise<PresenceListPayload['clients']>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Tempo limite excedido ao aguardar ${event}`)),
      RESPONSE_TIMEOUT_MS,
    );
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

function waitForRequestMessage(
  client: TestClient,
  event:
    | EventType.REQUEST_CREATED
    | EventType.REQUEST_RECEIVED
    | EventType.REQUEST_ACCEPTED
    | EventType.REQUEST_CANCELLED
    | EventType.REQUEST_EXPIRED,
): Promise<SocketMessage<RequestPayload>> {
  return new Promise<SocketMessage<RequestPayload>>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Tempo limite excedido ao aguardar ${event}`)),
      RESPONSE_TIMEOUT_MS,
    );
    const handleMessage = (message: SocketMessage<RequestPayload>): void => {
      clearTimeout(timeout);
      resolve(message);
    };

    switch (event) {
      case EventType.REQUEST_CREATED:
        client.once(EventType.REQUEST_CREATED, handleMessage);
        break;
      case EventType.REQUEST_RECEIVED:
        client.once(EventType.REQUEST_RECEIVED, handleMessage);
        break;
      case EventType.REQUEST_ACCEPTED:
        client.once(EventType.REQUEST_ACCEPTED, handleMessage);
        break;
      case EventType.REQUEST_CANCELLED:
        client.once(EventType.REQUEST_CANCELLED, handleMessage);
        break;
      case EventType.REQUEST_EXPIRED:
        client.once(EventType.REQUEST_EXPIRED, handleMessage);
        break;
    }
  });
}

function waitForRequestRejection(
  client: TestClient,
): Promise<SocketMessage<RequestRejectedPayload>> {
  return new Promise<SocketMessage<RequestRejectedPayload>>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Tempo limite excedido ao aguardar ${EventType.REQUEST_REJECTED}`)),
      RESPONSE_TIMEOUT_MS,
    );

    client.once(EventType.REQUEST_REJECTED, (message) => {
      clearTimeout(timeout);
      resolve(message);
    });
  });
}
