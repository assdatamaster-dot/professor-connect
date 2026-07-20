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
  CallStatus,
  ClientRole,
  EventType,
  PresenceStatus,
  RequestStatus,
  type CallPayload,
  type PresenceRegisterPayload,
  type PresenceUpdatePayload,
  type RequestCreatePayload,
  type RequestPayload,
  type RequestReferencePayload,
  type RequestRejectedPayload,
  type ServiceRequest,
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
const REQUEST_TIMEOUT_MS = 500;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

type TestClient = Socket<ServerToClientEvents, ClientToServerEvents>;

test('gerencia aceite, rejeições, cancelamento e expiração de requests', async () => {
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
    new RequestManager(new RequestStore(), { stateMachineLogger: logger }),
    presenceService,
    REQUEST_TIMEOUT_MS,
  );
  const callService = new CallService(
    new CallManager(new CallStore(), { stateMachineLogger: logger }),
    requestService,
    logger,
  );
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
  const clients: TestClient[] = Array.from({ length: 5 }, () =>
    io(serverUrl, { transports: ['websocket'] }),
  );
  const registrations: readonly PresenceRegisterPayload[] = [
    { clientId: randomUUID(), displayName: 'Professor 1', role: ClientRole.TEACHER },
    { clientId: randomUUID(), displayName: 'Professor 2', role: ClientRole.TEACHER },
    { clientId: randomUUID(), displayName: 'Professor 3', role: ClientRole.TEACHER },
    { clientId: randomUUID(), displayName: 'Aluno 1', role: ClientRole.STUDENT },
    { clientId: randomUUID(), displayName: 'Aluno 2', role: ClientRole.STUDENT },
  ];

  try {
    await Promise.all(clients.map(waitForConnection));
    registerClients(clients, registrations);
    await waitUntil(() => presenceService.listOnlineClients().length === 5);

    const teachers = clients.slice(0, 3);
    const firstStudent = clients[3];
    const secondStudent = clients[4];
    assert.equal(teachers.length, 3);
    assert(firstStudent !== undefined && secondStudent !== undefined);

    teachers.forEach((teacher) => {
      teacher.emit(
        EventType.PRESENCE_UPDATE,
        createMessage<PresenceUpdatePayload>(EventType.PRESENCE_UPDATE, {
          status: PresenceStatus.AVAILABLE,
        }),
      );
    });
    await waitUntil(() => presenceService.listAvailableTeachers().length === 3);

    const acceptedCandidate = await createRequest(firstStudent, teachers);
    assert.match(acceptedCandidate.requestId, UUID_PATTERN);
    assert.equal(acceptedCandidate.status, RequestStatus.PENDING);
    assert.equal(
      Date.parse(acceptedCandidate.expiresAt) - Date.parse(acceptedCandidate.createdAt),
      REQUEST_TIMEOUT_MS,
    );

    const acceptanceNotifications = [firstStudent, ...teachers].map((client) =>
      waitForRequestMessage(client, EventType.REQUEST_ACCEPTED),
    );
    const firstTeacher = teachers[0];
    const firstTeacherRegistration = registrations[0];
    assert(firstTeacher !== undefined && firstTeacherRegistration !== undefined);
    const callCreatedNotifications = [firstStudent, firstTeacher].map((client) =>
      waitForCallMessage(client, EventType.CALL_CREATED),
    );
    const callConnectingNotifications = [firstStudent, firstTeacher].map((client) =>
      waitForCallMessage(client, EventType.CALL_CONNECTING),
    );
    firstTeacher.emit(
      EventType.REQUEST_ACCEPT,
      createMessage<RequestReferencePayload>(EventType.REQUEST_ACCEPT, {
        requestId: acceptedCandidate.requestId,
      }),
    );

    const acceptedNotifications = await Promise.all(acceptanceNotifications);
    assert.equal(acceptedNotifications.length, 4);
    assert(
      acceptedNotifications.every(
        (message) => message.payload.request.status === RequestStatus.ACCEPTED,
      ),
    );
    assert.equal(
      acceptedNotifications[0]?.payload.request.teacherId,
      firstTeacherRegistration.clientId,
    );
    assert.equal(
      requestService.getStateHistory(acceptedCandidate.requestId)[0]?.nextState,
      RequestStatus.ACCEPTED,
    );
    const createdCallMessages = await Promise.all(callCreatedNotifications);
    const connectingCallMessages = await Promise.all(callConnectingNotifications);
    const createdCall = createdCallMessages[0]?.payload.call;
    assert(createdCall !== undefined);
    assert.equal(createdCall.requestId, acceptedCandidate.requestId);
    assert.equal(createdCall.studentId, acceptedCandidate.studentId);
    assert.equal(createdCall.teacherId, firstTeacherRegistration.clientId);
    assert.equal(createdCall.status, CallStatus.CREATED);
    assert(
      connectingCallMessages.every(
        (message) =>
          message.payload.call.callId === createdCall.callId &&
          message.payload.call.status === CallStatus.CONNECTING,
      ),
    );
    assert.equal(callService.listCalls().length, 1);
    assert.equal(
      callService.getStateHistory(createdCall.callId)[0]?.nextState,
      CallStatus.CONNECTING,
    );

    const cancelledCandidate = await createRequest(secondStudent, teachers);

    for (let index = 0; index < teachers.length; index += 1) {
      const teacher = teachers[index];
      const registration = registrations[index];
      assert(teacher !== undefined && registration !== undefined);

      const rejectionNotification = waitForRequestRejection(teacher);
      teacher.emit(
        EventType.REQUEST_REJECT,
        createMessage<RequestReferencePayload>(EventType.REQUEST_REJECT, {
          requestId: cancelledCandidate.requestId,
        }),
      );

      const rejection = await rejectionNotification;
      assert.equal(rejection.payload.request.status, RequestStatus.PENDING);
      assert.equal(rejection.payload.teacherId, registration.clientId);
    }

    assert.equal(requestService.getRejectedTeacherIds(cancelledCandidate.requestId).length, 3);
    assert.equal(
      requestService.findRequest(cancelledCandidate.requestId)?.status,
      RequestStatus.PENDING,
    );

    const cancellationNotifications = [secondStudent, ...teachers].map((client) =>
      waitForRequestMessage(client, EventType.REQUEST_CANCELLED),
    );
    secondStudent.emit(
      EventType.REQUEST_CANCEL,
      createMessage<RequestReferencePayload>(EventType.REQUEST_CANCEL, {
        requestId: cancelledCandidate.requestId,
      }),
    );

    const cancelledNotifications = await Promise.all(cancellationNotifications);
    assert(
      cancelledNotifications.every(
        (message) => message.payload.request.status === RequestStatus.CANCELLED,
      ),
    );
    assert.equal(
      requestService.getStateHistory(cancelledCandidate.requestId)[0]?.nextState,
      RequestStatus.CANCELLED,
    );

    const studentExpiration = waitForRequestMessage(firstStudent, EventType.REQUEST_EXPIRED);
    const teacherExpirations = teachers.map((teacher) =>
      waitForRequestMessage(teacher, EventType.REQUEST_EXPIRED),
    );
    const expiringCandidate = await createRequest(firstStudent, teachers);
    const expirationNotifications = await Promise.all([studentExpiration, ...teacherExpirations]);

    assert(
      expirationNotifications.every(
        (message) =>
          message.payload.request.requestId === expiringCandidate.requestId &&
          message.payload.request.status === RequestStatus.EXPIRED,
      ),
    );
    assert.equal(requestService.listRequests().length, 3);
    assert.equal(requestService.listActiveRequests().length, 0);
    assert.equal(
      requestService.getStateHistory(expiringCandidate.requestId)[0]?.nextState,
      RequestStatus.EXPIRED,
    );
    assert.equal(loggedErrors.length, 0);
    assert.equal(countMessage(loggedMessages, 'Request criada'), 3);
    assert.equal(countMessage(loggedMessages, 'Request enviada'), 3);
    assert.equal(countMessage(loggedMessages, 'Professor recebeu'), 9);
    assert.equal(countMessage(loggedMessages, 'Professor aceitou'), 1);
    assert.equal(countMessage(loggedMessages, 'Professor rejeitou'), 3);
    assert.equal(countMessage(loggedMessages, 'Request cancelada'), 1);
    assert.equal(countMessage(loggedMessages, 'Request expirada'), 1);
    assert.equal(countMessage(loggedMessages, 'Mudança de estado'), 4);
    assert.equal(countMessage(loggedMessages, 'Call criada'), 1);
    assert.equal(countMessage(loggedMessages, 'Call iniciada'), 1);
  } finally {
    clients.forEach((client) => client.disconnect());
    await new Promise<void>((resolve) => gateway.close(resolve));
  }
});

function registerClients(
  clients: readonly TestClient[],
  registrations: readonly PresenceRegisterPayload[],
): void {
  registrations.forEach((registration, index) => {
    const client = clients[index];
    assert(client !== undefined);
    client.emit(
      EventType.PRESENCE_REGISTER,
      createMessage(EventType.PRESENCE_REGISTER, registration),
    );
  });
}

async function createRequest(
  student: TestClient,
  teachers: readonly TestClient[],
): Promise<ServiceRequest> {
  const createdMessage = waitForRequestMessage(student, EventType.REQUEST_CREATED);
  const receivedMessages = teachers.map((teacher) =>
    waitForRequestMessage(teacher, EventType.REQUEST_RECEIVED),
  );

  student.emit(
    EventType.REQUEST_CREATE,
    createMessage<RequestCreatePayload>(EventType.REQUEST_CREATE, {}),
  );

  const request = (await createdMessage).payload.request;
  const teacherRequests = await Promise.all(receivedMessages);
  assert(
    teacherRequests.every((message) => message.payload.request.requestId === request.requestId),
  );

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

function waitForConnection(client: TestClient): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    client.once(EventType.CONNECT, () => resolve());
    client.once(EventType.CONNECT_ERROR, reject);
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
  return new Promise<SocketMessage<RequestPayload>>((resolve) => {
    switch (event) {
      case EventType.REQUEST_CREATED:
        client.once(EventType.REQUEST_CREATED, resolve);
        break;
      case EventType.REQUEST_RECEIVED:
        client.once(EventType.REQUEST_RECEIVED, resolve);
        break;
      case EventType.REQUEST_ACCEPTED:
        client.once(EventType.REQUEST_ACCEPTED, resolve);
        break;
      case EventType.REQUEST_CANCELLED:
        client.once(EventType.REQUEST_CANCELLED, resolve);
        break;
      case EventType.REQUEST_EXPIRED:
        client.once(EventType.REQUEST_EXPIRED, resolve);
        break;
    }
  });
}

function waitForRequestRejection(
  client: TestClient,
): Promise<SocketMessage<RequestRejectedPayload>> {
  return new Promise<SocketMessage<RequestRejectedPayload>>((resolve) => {
    client.once(EventType.REQUEST_REJECTED, resolve);
  });
}

function waitForCallMessage(
  client: TestClient,
  event: EventType.CALL_CREATED | EventType.CALL_CONNECTING,
): Promise<SocketMessage<CallPayload>> {
  return new Promise<SocketMessage<CallPayload>>((resolve) => {
    if (event === EventType.CALL_CREATED) {
      client.once(EventType.CALL_CREATED, resolve);
      return;
    }

    client.once(EventType.CALL_CONNECTING, resolve);
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
