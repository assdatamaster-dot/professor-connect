import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { test } from 'node:test';

import { io, type Socket } from 'socket.io-client';

import {
  CallStatus,
  ClientRole,
  EventType,
  PresenceStatus,
  SessionStatus,
  SignalErrorCode,
  type Call,
  type CallPayload,
  type ClientPresence,
  type PresenceListPayload,
  type PresenceRegisterPayload,
  type PresenceUpdatePayload,
  type RequestCreatePayload,
  type RequestPayload,
  type RequestReferencePayload,
  type RemoteControlAuthorizationPayload,
  type RemoteControlReferencePayload,
  type RemoteControlRequestPayload,
  type ScreenShareReferencePayload,
  type ScreenShareRequestPayload,
  type Session,
  type SessionCreatedPayload,
  type SessionCreatePayload,
  type SessionJoinPayload,
  type SignalAnswerPayload,
  type SignalErrorPayload,
  type SignalIceCandidatePayload,
  type SignalOfferPayload,
  type SocketMessage,
} from '@professor-connect/shared-types';

import type {
  ClientToServerEvents,
  CommunicationLogger,
  ServerToClientEvents,
} from '../src/modules/communication/communication.types.js';
import { SignalingManager } from '../src/modules/signaling/signaling.manager.js';
import { SignalingError } from '../src/modules/signaling/signaling.types.js';
import { initializeWebSocket } from '../src/socket-server.js';

const STUDENT_ID = 'student-signaling';
const TEACHER_ID = 'teacher-signaling';
const EVENT_TIMEOUT_MS = 2_000;
type TestClient = Socket<ServerToClientEvents, ClientToServerEvents>;

test('encaminha Offer, Answer e ICE Candidates entre dois clientes', async () => {
  const loggedMessages: string[] = [];
  const loggedErrorMessages: string[] = [];
  const loggedErrors: unknown[] = [];
  const logger: CommunicationLogger = {
    info(message): void {
      loggedMessages.push(message);
    },
    error(message, error): void {
      loggedErrorMessages.push(message);
      loggedErrors.push(error);
    },
  };
  const httpServer = createServer();
  const gateway = initializeWebSocket(httpServer, logger);

  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const address = httpServer.address();
  assert(address !== null && typeof address === 'object');

  const serverUrl = `http://127.0.0.1:${address.port}`;
  const clientA: TestClient = io(serverUrl, { transports: ['websocket'], reconnection: false });
  const clientB: TestClient = io(serverUrl, { transports: ['websocket'], reconnection: false });

  try {
    await Promise.all([waitForConnection(clientA), waitForConnection(clientB)]);
    await registerParticipants(clientA, clientB);
    const sessionId = await createActiveSession(clientA, clientB);
    const callId = await createActiveCall(clientA, clientB);

    const offerPayload: SignalOfferPayload = { callId, sdp: 'offer-sdp' };
    const offerForClientB = waitForEvent(clientB, EventType.SIGNAL_OFFER);

    clientA.emit(
      EventType.SIGNAL_OFFER,
      createMessage(EventType.SIGNAL_OFFER, offerPayload, sessionId),
    );

    const forwardedOffer = await offerForClientB;
    assert.equal(forwardedOffer.event, EventType.SIGNAL_OFFER);
    assert.equal(forwardedOffer.sessionId, sessionId);
    assert.deepEqual(forwardedOffer.payload, offerPayload);

    const answerPayload: SignalAnswerPayload = { callId, sdp: 'answer-sdp' };
    const answerForClientA = waitForEvent(clientA, EventType.SIGNAL_ANSWER);

    clientB.emit(
      EventType.SIGNAL_ANSWER,
      createMessage(EventType.SIGNAL_ANSWER, answerPayload, sessionId),
    );

    const forwardedAnswer = await answerForClientA;
    assert.equal(forwardedAnswer.event, EventType.SIGNAL_ANSWER);
    assert.equal(forwardedAnswer.sessionId, sessionId);
    assert.deepEqual(forwardedAnswer.payload, answerPayload);

    const firstCandidate: SignalIceCandidatePayload = {
      callId,
      candidate: 'candidate-a',
      sdpMid: '0',
      sdpMLineIndex: 0,
    };
    const secondCandidate: SignalIceCandidatePayload = {
      callId,
      candidate: 'candidate-b',
      sdpMid: '0',
      sdpMLineIndex: 0,
    };
    const candidateForClientB = waitForEvent(clientB, EventType.SIGNAL_ICE_CANDIDATE);

    clientA.emit(
      EventType.SIGNAL_ICE_CANDIDATE,
      createMessage(EventType.SIGNAL_ICE_CANDIDATE, firstCandidate, sessionId),
    );
    assert.deepEqual((await candidateForClientB).payload, firstCandidate);

    const candidateForClientA = waitForEvent(clientA, EventType.SIGNAL_ICE_CANDIDATE);

    clientB.emit(
      EventType.SIGNAL_ICE_CANDIDATE,
      createMessage(EventType.SIGNAL_ICE_CANDIDATE, secondCandidate, sessionId),
    );
    assert.deepEqual((await candidateForClientA).payload, secondCandidate);

    const screenSharePayload: ScreenShareRequestPayload = {
      callId,
      requestId: 'screen-share-request-1',
    };
    const screenShareRequestForStudent = waitForEvent(clientA, EventType.SCREEN_SHARE_REQUEST);

    clientB.emit(
      EventType.SCREEN_SHARE_REQUEST,
      createMessage(EventType.SCREEN_SHARE_REQUEST, screenSharePayload, sessionId),
    );
    assert.deepEqual((await screenShareRequestForStudent).payload, screenSharePayload);

    const screenShareAcceptForTeacher = waitForEvent(clientB, EventType.SCREEN_SHARE_ACCEPT);

    clientA.emit(
      EventType.SCREEN_SHARE_ACCEPT,
      createMessage(EventType.SCREEN_SHARE_ACCEPT, screenSharePayload, sessionId),
    );
    assert.deepEqual((await screenShareAcceptForTeacher).payload, screenSharePayload);

    const remoteRequestPayload: RemoteControlRequestPayload = {
      callId,
      authorizationId: 'remote-authorization-1',
      durationMs: 300_000,
    };
    const remoteRequestForStudent = waitForEvent(clientA, EventType.REMOTE_REQUEST);

    clientB.emit(
      EventType.REMOTE_REQUEST,
      createMessage(EventType.REMOTE_REQUEST, remoteRequestPayload, sessionId),
    );
    assert.deepEqual((await remoteRequestForStudent).payload, remoteRequestPayload);

    const remoteAcceptPayload: RemoteControlAuthorizationPayload = {
      callId,
      authorizationId: remoteRequestPayload.authorizationId,
      expiresAt: new Date(Date.now() + remoteRequestPayload.durationMs).toISOString(),
    };
    const remoteAcceptForTeacher = waitForEvent(clientB, EventType.REMOTE_ACCEPT);

    clientA.emit(
      EventType.REMOTE_ACCEPT,
      createMessage(EventType.REMOTE_ACCEPT, remoteAcceptPayload, sessionId),
    );
    assert.deepEqual((await remoteAcceptForTeacher).payload, remoteAcceptPayload);

    const remoteReference: RemoteControlReferencePayload = {
      callId,
      authorizationId: remoteRequestPayload.authorizationId,
    };
    const remoteStartedForStudent = waitForEvent(clientA, EventType.REMOTE_STARTED);

    clientB.emit(
      EventType.REMOTE_STARTED,
      createMessage(EventType.REMOTE_STARTED, remoteReference, sessionId),
    );
    assert.deepEqual((await remoteStartedForStudent).payload, remoteReference);

    const remoteStoppedForTeacher = waitForEvent(clientB, EventType.REMOTE_STOPPED);

    clientA.emit(
      EventType.REMOTE_STOPPED,
      createMessage(EventType.REMOTE_STOPPED, remoteReference, sessionId),
    );
    assert.deepEqual((await remoteStoppedForTeacher).payload, remoteReference);

    assert.equal(countMessage(loggedMessages, 'Offer recebida'), 1);
    assert.equal(countMessage(loggedMessages, 'Offer enviada'), 1);
    assert.equal(countMessage(loggedMessages, 'Answer recebida'), 1);
    assert.equal(countMessage(loggedMessages, 'Answer enviada'), 1);
    assert.equal(countMessage(loggedMessages, 'ICE recebido'), 2);
    assert.equal(countMessage(loggedMessages, 'ICE enviado'), 2);
    assert.equal(countMessage(loggedMessages, 'Evento de compartilhamento recebido'), 2);
    assert.equal(countMessage(loggedMessages, 'Evento de compartilhamento enviado'), 2);
    assert.equal(countMessage(loggedMessages, 'Evento de controle remoto recebido'), 4);
    assert.equal(countMessage(loggedMessages, 'Evento de controle remoto enviado'), 4);

    const signalingErrorForClientA = waitForEvent(clientA, EventType.SIGNAL_ERROR);

    clientA.emit(
      EventType.SIGNAL_OFFER,
      createMessage(
        EventType.SIGNAL_OFFER,
        { callId: 'call-inexistente', sdp: 'offer-sdp' },
        sessionId,
      ),
    );
    const signalingError = await signalingErrorForClientA;

    assert.equal(signalingError.event, EventType.SIGNAL_ERROR);
    assert.equal(signalingError.sessionId, sessionId);
    assert.equal(signalingError.payload.code, SignalErrorCode.CALL_NOT_FOUND);
    assert.equal(signalingError.payload.relatedEvent, EventType.SIGNAL_OFFER);
    assert.equal(countMessage(loggedErrorMessages, 'Erro de sinalização'), 1);
    assert.equal(loggedErrors.length, 1);
  } finally {
    clientA.close();
    clientB.close();
    await new Promise<void>((resolve) => gateway.close(resolve));
  }
});

test('valida sessão, Call, conexões, associação e participantes antes de encaminhar', () => {
  const activeSession: Session = {
    id: 'session-1',
    clientIds: ['connection-a', 'connection-b'],
    status: SessionStatus.ACTIVE,
    createdAt: '2026-07-20T12:00:00.000Z',
    updatedAt: '2026-07-20T12:00:00.000Z',
  };
  const activeCall: Call = {
    callId: 'call-1',
    requestId: 'request-1',
    studentId: STUDENT_ID,
    teacherId: TEACHER_ID,
    status: CallStatus.CONNECTING,
    createdAt: '2026-07-20T12:00:00.000Z',
  };
  const presences = new Map<string, ClientPresence>([
    ['connection-a', createPresence(STUDENT_ID, 'connection-a', ClientRole.STUDENT)],
    ['connection-b', createPresence(TEACHER_ID, 'connection-b', ClientRole.TEACHER)],
  ]);
  let session: Session | undefined = activeSession;
  let call: Call | undefined = activeCall;
  const disconnectedConnections = new Set<string>();
  const manager = new SignalingManager(
    { findSession: () => session },
    { findCall: () => call },
    { isConnected: (connectionId) => !disconnectedConnections.has(connectionId) },
    { findByConnectionId: (connectionId) => presences.get(connectionId) },
  );
  const routeRequest = {
    sessionId: activeSession.id,
    callId: activeCall.callId,
    senderConnectionId: 'connection-a',
  };

  assert.deepEqual(manager.resolveRoute(routeRequest), {
    recipientConnectionId: 'connection-b',
  });

  session = undefined;
  assertSignalingError(() => manager.resolveRoute(routeRequest), SignalErrorCode.SESSION_NOT_FOUND);

  session = { ...activeSession, status: SessionStatus.WAITING };
  assertSignalingError(
    () => manager.resolveRoute(routeRequest),
    SignalErrorCode.SESSION_NOT_ACTIVE,
  );

  session = activeSession;
  disconnectedConnections.add('connection-b');
  assertSignalingError(
    () => manager.resolveRoute(routeRequest),
    SignalErrorCode.CLIENT_NOT_CONNECTED,
  );

  disconnectedConnections.clear();
  assertSignalingError(
    () => manager.resolveRoute({ ...routeRequest, senderConnectionId: 'connection-outside' }),
    SignalErrorCode.CLIENT_NOT_IN_SESSION,
  );

  call = { ...activeCall, status: CallStatus.FINISHED };
  assertSignalingError(() => manager.resolveRoute(routeRequest), SignalErrorCode.CALL_NOT_ACTIVE);

  call = { ...activeCall, sessionId: 'another-session' };
  assertSignalingError(
    () => manager.resolveRoute(routeRequest),
    SignalErrorCode.CALL_SESSION_MISMATCH,
  );

  call = { ...activeCall, teacherId: 'another-teacher' };
  assertSignalingError(
    () => manager.resolveRoute(routeRequest),
    SignalErrorCode.CALL_PARTICIPANT_MISMATCH,
  );
});

async function registerParticipants(clientA: TestClient, clientB: TestClient): Promise<void> {
  const bothOnline = waitForMatchingEvent(
    clientA,
    EventType.PRESENCE_ONLINE,
    (message) => message.payload.clients.length === 2,
  );

  clientA.emit(
    EventType.PRESENCE_REGISTER,
    createMessage<PresenceRegisterPayload>(EventType.PRESENCE_REGISTER, {
      clientId: STUDENT_ID,
      displayName: 'Aluno',
      role: ClientRole.STUDENT,
    }),
  );
  clientB.emit(
    EventType.PRESENCE_REGISTER,
    createMessage<PresenceRegisterPayload>(EventType.PRESENCE_REGISTER, {
      clientId: TEACHER_ID,
      displayName: 'Professor',
      role: ClientRole.TEACHER,
    }),
  );
  await bothOnline;

  const teacherAvailable = waitForMatchingEvent(clientA, EventType.PRESENCE_AVAILABLE, (message) =>
    message.payload.clients.some((client) => client.clientId === TEACHER_ID),
  );

  clientB.emit(
    EventType.PRESENCE_UPDATE,
    createMessage<PresenceUpdatePayload>(EventType.PRESENCE_UPDATE, {
      status: PresenceStatus.AVAILABLE,
    }),
  );
  await teacherAvailable;
}

async function createActiveSession(clientA: TestClient, clientB: TestClient): Promise<string> {
  const createdSession = waitForEvent(clientA, EventType.SESSION_CREATED);

  clientA.emit(
    EventType.SESSION_CREATE,
    createMessage<SessionCreatePayload>(EventType.SESSION_CREATE, {}),
  );
  const sessionId = (await createdSession).payload.session.id;

  clientA.emit(
    EventType.SESSION_JOIN,
    createMessage<SessionJoinPayload>(EventType.SESSION_JOIN, {}, sessionId),
  );
  clientB.emit(
    EventType.SESSION_JOIN,
    createMessage<SessionJoinPayload>(EventType.SESSION_JOIN, {}, sessionId),
  );

  return sessionId;
}

async function createActiveCall(clientA: TestClient, clientB: TestClient): Promise<string> {
  const requestCreated = waitForEvent(clientA, EventType.REQUEST_CREATED);
  const requestReceived = waitForEvent(clientB, EventType.REQUEST_RECEIVED);

  clientA.emit(
    EventType.REQUEST_CREATE,
    createMessage<RequestCreatePayload>(EventType.REQUEST_CREATE, {}),
  );
  const request = (await requestCreated).payload.request;
  assert.equal((await requestReceived).payload.request.requestId, request.requestId);

  const callConnectingForA = waitForEvent(clientA, EventType.CALL_CONNECTING);
  const callConnectingForB = waitForEvent(clientB, EventType.CALL_CONNECTING);

  clientB.emit(
    EventType.REQUEST_ACCEPT,
    createMessage<RequestReferencePayload>(EventType.REQUEST_ACCEPT, {
      requestId: request.requestId,
    }),
  );

  const [callForA, callForB] = await Promise.all([callConnectingForA, callConnectingForB]);

  assert.equal(callForA.payload.call.callId, callForB.payload.call.callId);
  assert.equal(callForA.payload.call.status, CallStatus.CONNECTING);

  return callForA.payload.call.callId;
}

function createPresence(clientId: string, connectionId: string, role: ClientRole): ClientPresence {
  return {
    clientId,
    connectionId,
    displayName: clientId,
    role,
    status: PresenceStatus.ONLINE,
    lastSeen: '2026-07-20T12:00:00.000Z',
  };
}

function createMessage<T>(event: EventType, payload: T, sessionId?: string): SocketMessage<T> {
  return {
    id: randomUUID(),
    event,
    timestamp: new Date().toISOString(),
    ...(sessionId === undefined ? {} : { sessionId }),
    payload,
  };
}

function waitForConnection(client: TestClient): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    client.once(EventType.CONNECT, () => resolve());
    client.once(EventType.CONNECT_ERROR, reject);
  });
}

function waitForEvent(
  client: TestClient,
  event: EventType.SIGNAL_OFFER,
): Promise<SocketMessage<SignalOfferPayload>>;
function waitForEvent(
  client: TestClient,
  event: EventType.SIGNAL_ANSWER,
): Promise<SocketMessage<SignalAnswerPayload>>;
function waitForEvent(
  client: TestClient,
  event: EventType.SIGNAL_ICE_CANDIDATE,
): Promise<SocketMessage<SignalIceCandidatePayload>>;
function waitForEvent(
  client: TestClient,
  event: EventType.SIGNAL_ERROR,
): Promise<SocketMessage<SignalErrorPayload>>;
function waitForEvent(
  client: TestClient,
  event: EventType.SCREEN_SHARE_REQUEST,
): Promise<SocketMessage<ScreenShareRequestPayload>>;
function waitForEvent(
  client: TestClient,
  event: EventType.SCREEN_SHARE_ACCEPT,
): Promise<SocketMessage<ScreenShareReferencePayload>>;
function waitForEvent(
  client: TestClient,
  event: EventType.REMOTE_REQUEST,
): Promise<SocketMessage<RemoteControlRequestPayload>>;
function waitForEvent(
  client: TestClient,
  event: EventType.REMOTE_ACCEPT,
): Promise<SocketMessage<RemoteControlAuthorizationPayload>>;
function waitForEvent(
  client: TestClient,
  event: EventType.REMOTE_STARTED | EventType.REMOTE_STOPPED,
): Promise<SocketMessage<RemoteControlReferencePayload>>;
function waitForEvent(
  client: TestClient,
  event: EventType.SESSION_CREATED,
): Promise<SocketMessage<SessionCreatedPayload>>;
function waitForEvent(
  client: TestClient,
  event: EventType.REQUEST_CREATED | EventType.REQUEST_RECEIVED,
): Promise<SocketMessage<RequestPayload>>;
function waitForEvent(
  client: TestClient,
  event: EventType.CALL_CONNECTING,
): Promise<SocketMessage<CallPayload>>;
function waitForEvent(
  client: TestClient,
  event:
    | EventType.SIGNAL_OFFER
    | EventType.SIGNAL_ANSWER
    | EventType.SIGNAL_ICE_CANDIDATE
    | EventType.SIGNAL_ERROR
    | EventType.SCREEN_SHARE_REQUEST
    | EventType.SCREEN_SHARE_ACCEPT
    | EventType.REMOTE_REQUEST
    | EventType.REMOTE_ACCEPT
    | EventType.REMOTE_STARTED
    | EventType.REMOTE_STOPPED
    | EventType.SESSION_CREATED
    | EventType.REQUEST_CREATED
    | EventType.REQUEST_RECEIVED
    | EventType.CALL_CONNECTING,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Tempo limite excedido ao aguardar ${event}`));
    }, EVENT_TIMEOUT_MS);

    client.once(event, (message: unknown) => {
      clearTimeout(timeout);
      resolve(message);
    });
  });
}

function waitForMatchingEvent(
  client: TestClient,
  event: EventType.PRESENCE_ONLINE | EventType.PRESENCE_AVAILABLE,
  predicate: (message: SocketMessage<PresenceListPayload>) => boolean,
): Promise<SocketMessage<PresenceListPayload>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      client.off(event, listener);
      reject(new Error(`Tempo limite excedido ao aguardar ${event}`));
    }, EVENT_TIMEOUT_MS);
    const listener = (message: SocketMessage<PresenceListPayload>): void => {
      if (!predicate(message)) {
        return;
      }

      clearTimeout(timeout);
      client.off(event, listener);
      resolve(message);
    };

    client.on(event, listener);
  });
}

function assertSignalingError(action: () => void, code: SignalErrorCode): void {
  assert.throws(action, (error: unknown) => error instanceof SignalingError && error.code === code);
}

function countMessage(messages: readonly string[], expectedMessage: string): number {
  return messages.filter((message) => message === expectedMessage).length;
}
