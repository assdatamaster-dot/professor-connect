import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';

import { io, type Socket } from 'socket.io-client';

import {
  initializeWebSocket,
  PresenceManager,
  SessionManager,
  SessionRequestManager,
  StudentPresenceManager,
  type SessionRequestedPayload,
  type SessionResponsePayload,
  type SessionLifecyclePayload,
  type WebRtcDescriptionPayload,
  type WebRtcIceCandidatePayload,
} from '../src/index.js';

interface ServerEvents {
  'session:requested': (payload: SessionRequestedPayload) => void;
  'session:accepted': (payload: SessionResponsePayload) => void;
  'session:rejected': (payload: SessionResponsePayload) => void;
  'session:timeout': (payload: SessionResponsePayload) => void;
  'session:started': (payload: SessionLifecyclePayload) => void;
  'session:ended': (payload: SessionLifecyclePayload) => void;
  'webrtc:offer': (payload: WebRtcDescriptionPayload) => void;
  'webrtc:answer': (payload: WebRtcDescriptionPayload) => void;
  'webrtc:ice-candidate': (payload: WebRtcIceCandidatePayload) => void;
}

interface ClientEvents {
  'professor:online': (payload: { readonly name: string }) => void;
  'student:register': (payload: { readonly id: string; readonly name: string }) => void;
  'request:session': (payload: { readonly teacherId: string }) => void;
  'session:accept': (payload: { readonly requestId: string }) => void;
  'session:reject': (payload: { readonly requestId: string }) => void;
  'session:end': (payload: { readonly sessionId: string }) => void;
  'webrtc:offer': (payload: WebRtcDescriptionPayload) => void;
  'webrtc:answer': (payload: WebRtcDescriptionPayload) => void;
  'webrtc:ice-candidate': (payload: WebRtcIceCandidatePayload) => void;
}

type TestClient = Socket<ServerEvents, ClientEvents>;

test('entrega aceite, recusa e timeout em tempo real', async () => {
  const httpServer = createServer();
  const professors = new PresenceManager(undefined, () => 'teacher-id');
  const students = new StudentPresenceManager();
  let requestSequence = 0;
  const sessionRequests = new SessionRequestManager(professors, students, {
    idFactory: () => `request-${++requestSequence}`,
    timeoutMs: 500,
  });
  const activeSessions = new SessionManager(professors, students, {
    idFactory: () => 'session-1',
  });
  const messages: string[] = [];
  const gateway = initializeWebSocket(
    httpServer,
    {
      info(message): void {
        messages.push(message);
      },
      error(message, error): void {
        throw new Error(message, { cause: error });
      },
    },
    60_000,
    { intervalMs: 30_000, timeoutMs: 90_000, reconnectWindowMs: 90_000 },
    professors,
    students,
    sessionRequests,
    activeSessions,
  );

  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const address = httpServer.address();
  assert(address !== null && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}`;
  const teacher: TestClient = io(url, { transports: ['websocket'] });
  const student: TestClient = io(url, { transports: ['websocket'] });

  try {
    await Promise.all([waitForConnect(teacher), waitForConnect(student)]);
    teacher.emit('professor:online', { name: 'Carlos' });
    student.emit('student:register', { id: 'student-id', name: 'Ana' });
    await waitUntil(
      () =>
        professors.getOnlineProfessors().length === 1 && students.getOnlineStudents().length === 1,
    );

    const requestedForAccept = waitForRequested(teacher);
    student.emit('request:session', { teacherId: 'teacher-id' });
    const firstRequest = await requestedForAccept;
    assert.equal(firstRequest.studentName, 'Ana');
    const accepted = waitForAccepted(student);
    const teacherStarted = waitForStarted(teacher);
    const studentStarted = waitForStarted(student);
    teacher.emit('session:accept', { requestId: firstRequest.requestId });
    assert.equal((await accepted).requestId, firstRequest.requestId);
    const [teacherSession, studentSession] = await Promise.all([teacherStarted, studentStarted]);
    assert.equal(teacherSession.sessionId, 'session-1');
    assert.deepEqual(teacherSession, studentSession);
    assert.equal(activeSessions.listActiveSessions().length, 1);

    const offerPayload: WebRtcDescriptionPayload = {
      sessionId: teacherSession.sessionId,
      description: { type: 'offer', sdp: 'teacher-offer-sdp' },
    };
    const studentOffer = waitForWebRtcOffer(student);
    teacher.emit('webrtc:offer', offerPayload);
    assert.deepEqual(await studentOffer, offerPayload);

    const answerPayload: WebRtcDescriptionPayload = {
      sessionId: teacherSession.sessionId,
      description: { type: 'answer', sdp: 'student-answer-sdp' },
    };
    const teacherAnswer = waitForWebRtcAnswer(teacher);
    student.emit('webrtc:answer', answerPayload);
    assert.deepEqual(await teacherAnswer, answerPayload);

    const candidatePayload: WebRtcIceCandidatePayload = {
      sessionId: teacherSession.sessionId,
      candidate: {
        candidate: 'candidate:1 1 UDP 1 192.0.2.1 5000 typ host',
        sdpMid: '0',
        sdpMLineIndex: 0,
        usernameFragment: 'fragment',
      },
    };
    const studentCandidate = waitForWebRtcIceCandidate(student);
    teacher.emit('webrtc:ice-candidate', candidatePayload);
    assert.deepEqual(await studentCandidate, candidatePayload);

    const teacherEnded = waitForEnded(teacher);
    const studentEnded = waitForEnded(student);
    teacher.emit('session:end', { sessionId: teacherSession.sessionId });
    const [endedForTeacher, endedForStudent] = await Promise.all([teacherEnded, studentEnded]);
    assert.deepEqual(endedForTeacher, endedForStudent);
    assert.deepEqual(activeSessions.listActiveSessions(), []);
    assert.equal(activeSessions.listHistory()[0]?.status, 'finished');

    const requestedForReject = waitForRequested(teacher);
    student.emit('request:session', { teacherId: 'teacher-id' });
    const secondRequest = await requestedForReject;
    const rejected = waitForRejected(student);
    teacher.emit('session:reject', { requestId: secondRequest.requestId });
    assert.equal((await rejected).requestId, secondRequest.requestId);

    const requestedForTimeout = waitForRequested(teacher);
    student.emit('request:session', { teacherId: 'teacher-id' });
    const thirdRequest = await requestedForTimeout;
    const timedOut = await waitForTimeout(student);
    assert.equal(timedOut.requestId, thirdRequest.requestId);

    assert.deepEqual(
      sessionRequests.listHistory().map((request) => request.status),
      ['accepted', 'rejected', 'expired'],
    );
    assert(messages.includes('Nova solicitação'));
    assert(messages.includes('Professor notificado'));
    assert(messages.includes('Solicitação aceita'));
    assert(messages.includes('Solicitação recusada'));
    assert(messages.includes('Solicitação expirada'));
    assert(messages.includes('Sessão criada'));
    assert(messages.includes('Participantes conectados'));
    assert(messages.includes('Sessão encerrada'));
    assert(messages.includes('Sessão removida'));
    assert(messages.includes('Offer enviada'));
    assert(messages.includes('Answer enviada'));
    assert(messages.includes('ICE Candidate encaminhado'));
  } finally {
    teacher.disconnect();
    student.disconnect();
    await new Promise<void>((resolve) => gateway.close(resolve));
  }
});

async function waitForConnect(client: TestClient): Promise<void> {
  if (client.connected) {
    return;
  }
  await new Promise<void>((resolve) => client.once('connect', resolve));
}

function waitForRequested(client: TestClient): Promise<SessionRequestedPayload> {
  return new Promise((resolve) => client.once('session:requested', resolve));
}

function waitForAccepted(client: TestClient): Promise<SessionResponsePayload> {
  return new Promise((resolve) => client.once('session:accepted', resolve));
}

function waitForRejected(client: TestClient): Promise<SessionResponsePayload> {
  return new Promise((resolve) => client.once('session:rejected', resolve));
}

function waitForTimeout(client: TestClient): Promise<SessionResponsePayload> {
  return new Promise((resolve) => client.once('session:timeout', resolve));
}

function waitForStarted(client: TestClient): Promise<SessionLifecyclePayload> {
  return new Promise((resolve) => client.once('session:started', resolve));
}

function waitForEnded(client: TestClient): Promise<SessionLifecyclePayload> {
  return new Promise((resolve) => client.once('session:ended', resolve));
}

function waitForWebRtcOffer(client: TestClient): Promise<WebRtcDescriptionPayload> {
  return new Promise((resolve) => client.once('webrtc:offer', resolve));
}

function waitForWebRtcAnswer(client: TestClient): Promise<WebRtcDescriptionPayload> {
  return new Promise((resolve) => client.once('webrtc:answer', resolve));
}

function waitForWebRtcIceCandidate(client: TestClient): Promise<WebRtcIceCandidatePayload> {
  return new Promise((resolve) => client.once('webrtc:ice-candidate', resolve));
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
