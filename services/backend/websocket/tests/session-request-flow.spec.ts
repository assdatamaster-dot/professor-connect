import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';

import { io, type Socket } from 'socket.io-client';

import {
  PresenceManager,
  type AvailableProfessorPayload,
  type ProfessorAvailabilitySnapshot,
  SessionManager,
  SessionRequestManager,
  StudentPresenceManager,
  type SessionRequestedPayload,
  type SessionResponsePayload,
  type StudentQueuePayload,
  type TeacherQueuePayload,
  type SessionLifecyclePayload,
  type ScreenSharePayload,
  type WebRtcDescriptionPayload,
  type WebRtcIceCandidatePayload,
  type OperationalStudentPresencePayload,
} from '../src/index.js';
import {
  authenticatedSocketOptions,
  initializeTestWebSocket,
} from './authenticated-socket-fixture.js';

interface ServerEvents {
  'professor:availability:changed': (payload: {
    readonly available: boolean;
    readonly availableSince?: string;
  }) => void;
  'professors:available:list': (payload: readonly AvailableProfessorPayload[]) => void;
  'professors:availability:changed': (payload: ProfessorAvailabilitySnapshot) => void;
  'session:requested': (payload: SessionRequestedPayload) => void;
  'session:accepted': (payload: SessionResponsePayload) => void;
  'session:rejected': (payload: SessionResponsePayload) => void;
  'session:timeout': (payload: SessionResponsePayload) => void;
  'session:cancelled': (payload: SessionResponsePayload) => void;
  'session:queue:updated': (payload: StudentQueuePayload) => void;
  'session:queue:changed': (payload: TeacherQueuePayload) => void;
  'session:queue:cleared': () => void;
  'session:started': (payload: SessionLifecyclePayload) => void;
  'session:reconnecting': (payload: SessionLifecyclePayload) => void;
  'session:recovered': (payload: SessionLifecyclePayload) => void;
  'session:ended': (payload: SessionLifecyclePayload) => void;
  'webrtc:offer': (payload: WebRtcDescriptionPayload) => void;
  'webrtc:answer': (payload: WebRtcDescriptionPayload) => void;
  'webrtc:ice-candidate': (payload: WebRtcIceCandidatePayload) => void;
  'screen-share:start': (payload: ScreenSharePayload) => void;
  'screen-share:stop': (payload: ScreenSharePayload) => void;
  'students:presence:changed': (payload: readonly OperationalStudentPresencePayload[]) => void;
  'session:request:error': (payload: { readonly code: string; readonly message: string }) => void;
}

interface ClientEvents {
  'professor:online': (payload: { readonly name: string }) => void;
  'professor:availability:set': (
    payload: { readonly available: boolean },
    acknowledge?: (result: { readonly ok: boolean; readonly message?: string }) => void,
  ) => void;
  'student:register': (payload: { readonly id: string; readonly name: string }) => void;
  'request:session': (payload: { readonly teacherId: string }) => void;
  'session:accept': (payload: { readonly requestId: string }) => void;
  'session:reject': (payload: { readonly requestId: string }) => void;
  'session:cancel': (payload: { readonly requestId: string }) => void;
  'session:queue:get': () => void;
  'students:presence:get': () => void;
  'session:end': (payload: { readonly sessionId: string }) => void;
  'session:recover': (
    payload: { readonly sessionId: string; readonly recoveryToken: string },
    acknowledge?: (result: { readonly ok: boolean; readonly message?: string }) => void,
  ) => void;
  'webrtc:offer': (payload: WebRtcDescriptionPayload) => void;
  'webrtc:answer': (payload: WebRtcDescriptionPayload) => void;
  'webrtc:ice-candidate': (payload: WebRtcIceCandidatePayload) => void;
  'screen-share:start': (payload: ScreenSharePayload) => void;
  'screen-share:stop': (payload: ScreenSharePayload) => void;
}

type TestClient = Socket<ServerEvents, ClientEvents>;

test('atualiza posições e chama automaticamente o próximo aluno em tempo real', async () => {
  const httpServer = createServer();
  const professors = new PresenceManager(undefined, () => 'teacher-id');
  const students = new StudentPresenceManager();
  let requestSequence = 0;
  const requests = new SessionRequestManager(professors, students, {
    idFactory: () => `queue-request-${++requestSequence}`,
    timeoutMs: 5_000,
  });
  let sessionSequence = 0;
  const sessions = new SessionManager(professors, students, {
    idFactory: () => `queue-session-${++sessionSequence}`,
  });
  const gateway = initializeTestWebSocket(
    httpServer,
    {
      info(): void {},
      error(message, error): void {
        throw new Error(message, { cause: error });
      },
    },
    {
      requestTimeout: 60_000,
      heartbeat: { intervalMs: 30_000, timeoutMs: 90_000, reconnectWindowMs: 90_000 },
      professors,
      students,
      requests,
      sessions,
    },
  );
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const address = httpServer.address();
  assert(address !== null && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}`;
  const teacher: TestClient = io(
    url,
    authenticatedSocketOptions('TEACHER', 'teacher-id', 'Carlos'),
  );
  const ana: TestClient = io(url, authenticatedSocketOptions('STUDENT', 'student-a', 'Ana'));
  const bia: TestClient = io(url, authenticatedSocketOptions('STUDENT', 'student-b', 'Bia'));
  const caio: TestClient = io(url, authenticatedSocketOptions('STUDENT', 'student-c', 'Caio'));

  try {
    await Promise.all([teacher, ana, bia, caio].map(waitForConnect));
    teacher.emit('professor:online', { name: 'Carlos' });
    const allStudentsAvailable = waitForOperationalStudents(
      teacher,
      (items) => items.length === 3 && items.every((item) => item.attendanceStatus === 'available'),
    );
    ana.emit('student:register', { id: 'student-a', name: 'Ana' });
    bia.emit('student:register', { id: 'student-b', name: 'Bia' });
    caio.emit('student:register', { id: 'student-c', name: 'Caio' });
    await waitUntil(
      () =>
        students.getOnlineStudents().length === 3 && professors.getOnlineProfessors().length === 1,
    );
    assert.equal((await allStudentsAvailable).length, 3);

    const firstRequested = waitForRequested(teacher);
    ana.emit('request:session', { teacherId: 'teacher-id' });
    const first = await firstRequested;
    const anaStarted = waitForStarted(ana);
    const anaInAttendance = waitForOperationalStudents(teacher, (items) =>
      items.some((item) => item.id === 'student-a' && item.attendanceStatus === 'in_attendance'),
    );
    teacher.emit('session:accept', { requestId: first.requestId });
    const firstSession = await anaStarted;
    assert.equal(
      (await anaInAttendance).find((item) => item.id === 'student-a')?.sessionId,
      firstSession.sessionId,
    );

    const biaPosition = waitForQueueUpdate(bia);
    const biaWaiting = waitForOperationalStudents(teacher, (items) =>
      items.some((item) => item.id === 'student-b' && item.attendanceStatus === 'waiting'),
    );
    bia.emit('request:session', { teacherId: 'teacher-id' });
    const biaQueue = await biaPosition;
    assert.equal(biaQueue.position, 1);
    assert.equal(biaQueue.estimatedWaitMinutes, 3);
    assert.equal((await biaWaiting).find((item) => item.id === 'student-b')?.position, 1);
    const caioPosition = waitForQueueUpdate(caio);
    const teacherQueue = waitForTeacherQueue(teacher, 2);
    caio.emit('request:session', { teacherId: 'teacher-id' });
    const caioQueue = await caioPosition;
    assert.equal(caioQueue.position, 2);
    assert.equal(caioQueue.estimatedWaitMinutes, 6);
    assert.deepEqual(
      (await teacherQueue).requests.map(({ studentName, position }) => ({ studentName, position })),
      [
        { studentName: 'Bia', position: 1 },
        { studentName: 'Caio', position: 2 },
      ],
    );

    const caioPromoted = waitForQueueUpdate(caio);
    const biaCancelled = new Promise<SessionResponsePayload>((resolve) =>
      bia.once('session:cancelled', resolve),
    );
    bia.emit('session:cancel', { requestId: 'queue-request-2' });
    assert.equal((await biaCancelled).requestId, 'queue-request-2');
    const promotedQueue = await caioPromoted;
    assert.equal(promotedQueue.position, 1);
    assert.equal(promotedQueue.estimatedWaitMinutes, 3);

    const caioAccepted = waitForAccepted(caio);
    const caioStarted = waitForStarted(caio);
    const availabilityTransitions: ProfessorAvailabilitySnapshot['status'][] = [];
    caio.on('professors:availability:changed', ({ status }) => {
      availabilityTransitions.push(status);
    });
    teacher.emit('session:end', { sessionId: firstSession.sessionId });
    assert.equal((await caioAccepted).requestId, 'queue-request-3');
    const nextSession = await caioStarted;
    assert.equal(nextSession.studentId, 'student-c');
    assert.equal(sessions.listActiveSessions()[0]?.studentId, 'student-c');
    assert(availabilityTransitions.includes('AVAILABLE'));
    assert(availabilityTransitions.includes('BUSY'));
  } finally {
    teacher.disconnect();
    ana.disconnect();
    bia.disconnect();
    caio.disconnect();
    await new Promise<void>((resolve) => gateway.close(resolve));
  }
});

test('isola a presença operacional por organização e diferencia ausência de professor', async () => {
  const httpServer = createServer();
  const professors = new PresenceManager();
  const students = new StudentPresenceManager();
  const requests = new SessionRequestManager(professors, students);
  const sessions = new SessionManager(professors, students);
  const gateway = initializeTestWebSocket(
    httpServer,
    { info(): void {}, error(): void {} },
    { professors, students, requests, sessions },
  );
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const address = httpServer.address();
  assert(address !== null && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}`;
  const teacher = io(
    url,
    authenticatedSocketOptions('TEACHER', 'teacher-a', 'Carlos'),
  ) as TestClient;
  const foreignTeacher = io(
    url,
    authenticatedSocketOptions('TEACHER', 'teacher-b', 'Beatriz', 'organization-other'),
  ) as TestClient;
  const student = io(url, authenticatedSocketOptions('STUDENT', 'student-a', 'Ana')) as TestClient;

  try {
    await Promise.all([teacher, foreignTeacher, student].map(waitForConnect));
    teacher.emit('professor:online', { name: 'Carlos' });
    foreignTeacher.emit('professor:online', { name: 'Beatriz' });
    await waitUntil(() => professors.getOnlineProfessors().length === 2);
    const visible = waitForOperationalStudents(teacher, (items) => items.length === 1);
    const isolated = waitForOperationalStudents(foreignTeacher, (items) => items.length === 0);
    student.emit('student:register', { id: 'student-a', name: 'Ana' });
    assert.equal((await visible)[0]?.name, 'Ana');
    assert.deepEqual(await isolated, []);

    const noProfessor = waitForRequestError(student);
    student.emit('request:session', { teacherId: 'teacher-inexistente' });
    assert.deepEqual(await noProfessor, {
      code: 'NO_PROFESSOR_ONLINE',
      message: 'Nenhum professor está online no momento.',
    });
  } finally {
    teacher.disconnect();
    foreignTeacher.disconnect();
    student.disconnect();
    await new Promise<void>((resolve) => gateway.close(resolve));
  }
});

test('entrega aceite, recusa e timeout em tempo real', async () => {
  const httpServer = createServer();
  const professors = new PresenceManager(undefined, () => 'teacher-id');
  const students = new StudentPresenceManager();
  let requestSequence = 0;
  const sessionRequests = new SessionRequestManager(professors, students, {
    idFactory: () => `request-${++requestSequence}`,
    timeoutMs: 500,
  });
  let sessionSequence = 0;
  const activeSessions = new SessionManager(professors, students, {
    idFactory: () => `session-${++sessionSequence}`,
  });
  const messages: string[] = [];
  const gateway = initializeTestWebSocket(
    httpServer,
    {
      info(message): void {
        messages.push(message);
      },
      error(message, error): void {
        throw new Error(message, { cause: error });
      },
    },
    {
      requestTimeout: 60_000,
      heartbeat: { intervalMs: 30_000, timeoutMs: 90_000, reconnectWindowMs: 90_000 },
      professors,
      students,
      requests: sessionRequests,
      sessions: activeSessions,
    },
  );

  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const address = httpServer.address();
  assert(address !== null && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}`;
  const teacher: TestClient = io(
    url,
    authenticatedSocketOptions('TEACHER', 'teacher-id', 'Carlos'),
  );
  const student: TestClient = io(url, authenticatedSocketOptions('STUDENT', 'student-id', 'Ana'));

  try {
    await Promise.all([waitForConnect(teacher), waitForConnect(student)]);
    const initialAvailableList = waitForAvailableProfessors(student);
    teacher.emit('professor:online', { name: 'Carlos' });
    student.emit('student:register', { id: 'student-id', name: 'Ana' });
    await waitUntil(
      () =>
        professors.getOnlineProfessors().length === 1 && students.getOnlineStudents().length === 1,
    );
    assert.deepEqual(await initialAvailableList, [
      {
        id: 'teacher-id',
        name: 'Carlos',
        status: 'available',
        availableSince: professors.getOnlineProfessors()[0]?.availableSince?.toISOString(),
      },
    ]);

    const teacherUnavailable = waitForAvailabilityChanged(teacher);
    const emptyAvailableList = waitForAvailableProfessors(student);
    assert.deepEqual(await setTeacherAvailability(teacher, false), { ok: true });
    assert.equal((await teacherUnavailable).available, false);
    assert.deepEqual(await emptyAvailableList, []);

    const teacherAvailable = waitForAvailabilityChanged(teacher);
    const restoredAvailableList = waitForAvailableProfessors(student);
    assert.deepEqual(await setTeacherAvailability(teacher, true), { ok: true });
    assert.equal((await teacherAvailable).available, true);
    assert.equal((await restoredAvailableList)[0]?.id, 'teacher-id');

    const requestedForAccept = waitForRequested(teacher);
    const reservedAvailableList = waitForAvailableProfessors(student);
    student.emit('request:session', { teacherId: 'teacher-id' });
    const firstRequest = await requestedForAccept;
    assert.equal(firstRequest.studentName, 'Ana');
    assert.deepEqual(await reservedAvailableList, [
      {
        id: 'teacher-id',
        name: 'Carlos',
        status: 'busy',
        availableSince: professors.getOnlineProfessors()[0]?.onlineSince.toISOString(),
      },
    ]);
    const accepted = waitForAccepted(student);
    const teacherStarted = waitForStarted(teacher);
    const studentStarted = waitForStarted(student);
    teacher.emit('session:accept', { requestId: firstRequest.requestId });
    assert.equal((await accepted).requestId, firstRequest.requestId);
    const [teacherSession, studentSession] = await Promise.all([teacherStarted, studentStarted]);
    assert.equal(teacherSession.sessionId, 'session-1');
    assert.deepEqual(
      { ...teacherSession, recoveryToken: undefined },
      { ...studentSession, recoveryToken: undefined },
    );
    assert.notEqual(teacherSession.recoveryToken, studentSession.recoveryToken);
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

    const screenSharePayload: ScreenSharePayload = {
      sessionId: teacherSession.sessionId,
      streamId: 'screen-stream',
      trackId: 'screen-track',
    };
    const teacherScreenShareStarted = waitForScreenShare(teacher, 'screen-share:start');
    student.emit('screen-share:start', screenSharePayload);
    assert.deepEqual(await teacherScreenShareStarted, screenSharePayload);
    const teacherScreenShareStopped = waitForScreenShare(teacher, 'screen-share:stop');
    student.emit('screen-share:stop', { sessionId: teacherSession.sessionId });
    assert.deepEqual(await teacherScreenShareStopped, { sessionId: teacherSession.sessionId });

    const teacherEnded = waitForEnded(teacher);
    const studentEnded = waitForEnded(student);
    const availableAfterSession = waitForAvailableProfessors(student);
    teacher.emit('session:end', { sessionId: teacherSession.sessionId });
    const [endedForTeacher, endedForStudent] = await Promise.all([teacherEnded, studentEnded]);
    assert.deepEqual(endedForTeacher, endedForStudent);
    assert.deepEqual(activeSessions.listActiveSessions(), []);
    assert.equal(activeSessions.listHistory()[0]?.status, 'finished');
    assert.equal((await availableAfterSession)[0]?.id, 'teacher-id');

    const requestedForReject = waitForRequested(teacher);
    student.emit('request:session', { teacherId: 'teacher-id' });
    const secondRequest = await requestedForReject;
    const rejected = waitForRejected(student);
    teacher.emit('session:reject', { requestId: secondRequest.requestId });
    assert.equal((await rejected).requestId, secondRequest.requestId);

    const requestedForTimeout = waitForRequested(teacher);
    student.emit('request:session', { teacherId: 'teacher-id' });
    const thirdRequest = await requestedForTimeout;
    const [studentTimedOut, teacherTimedOut] = await Promise.all([
      waitForTimeout(student),
      waitForTimeout(teacher),
    ]);
    assert.equal(studentTimedOut.requestId, thirdRequest.requestId);
    assert.equal(teacherTimedOut.requestId, thirdRequest.requestId);

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

    const requestedBeforeDisconnect = waitForRequested(teacher);
    student.emit('request:session', { teacherId: 'teacher-id' });
    const disconnectRequest = await requestedBeforeDisconnect;
    const teacherStartedBeforeDisconnect = waitForStarted(teacher);
    const studentStartedBeforeDisconnect = waitForStarted(student);
    teacher.emit('session:accept', { requestId: disconnectRequest.requestId });
    const [, studentRecoverySession] = await Promise.all([
      teacherStartedBeforeDisconnect,
      studentStartedBeforeDisconnect,
    ]);
    student.disconnect();
    await waitUntil(
      () => activeSessions.findSession('session-2')?.connectionState === 'RECONNECTING',
    );
    assert.equal(activeSessions.listActiveSessions()[0]?.sessionId, 'session-2');
    assert.equal(activeSessions.listHistory().length, 1);
    const teacherRecovered = waitForRecovered(teacher);
    student.connect();
    await waitForConnect(student);
    student.emit('student:register', { id: 'student-id', name: 'Ana' });
    const studentRecovered = waitForRecovered(student);
    const recoveryResult = await recoverSession(student, {
      sessionId: studentRecoverySession.sessionId,
      recoveryToken: studentRecoverySession.recoveryToken ?? '',
    });
    assert.deepEqual(recoveryResult, { ok: true });
    const [recoveredForTeacher, recoveredForStudent] = await Promise.all([
      teacherRecovered,
      studentRecovered,
    ]);
    assert.equal(recoveredForTeacher.sessionId, 'session-2');
    assert.equal(recoveredForStudent.sessionId, 'session-2');
    assert.equal(recoveredForStudent.state, 'CONNECTED');
    assert.equal(activeSessions.findSession('session-2')?.connectionState, 'CONNECTED');
    const teacherEndedRecovered = waitForEnded(teacher);
    student.emit('session:end', { sessionId: 'session-2' });
    assert.equal((await teacherEndedRecovered).sessionId, 'session-2');
    assert.equal(activeSessions.listHistory().length, 2);
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

function waitForAvailableProfessors(
  client: TestClient,
): Promise<readonly AvailableProfessorPayload[]> {
  return new Promise((resolve) => client.once('professors:available:list', resolve));
}

function waitForAvailabilityChanged(
  client: TestClient,
): Promise<{ readonly available: boolean; readonly availableSince?: string }> {
  return new Promise((resolve) => client.once('professor:availability:changed', resolve));
}

function setTeacherAvailability(
  client: TestClient,
  available: boolean,
): Promise<{ readonly ok: boolean; readonly message?: string }> {
  return new Promise((resolve) => {
    client.emit('professor:availability:set', { available }, resolve);
  });
}

function waitForAccepted(client: TestClient): Promise<SessionResponsePayload> {
  return new Promise((resolve) => client.once('session:accepted', resolve));
}

function waitForQueueUpdate(client: TestClient): Promise<StudentQueuePayload> {
  return new Promise((resolve) => client.once('session:queue:updated', resolve));
}

function waitForTeacherQueue(
  client: TestClient,
  totalWaiting: number,
): Promise<TeacherQueuePayload> {
  return new Promise((resolve) => {
    const listener = (payload: TeacherQueuePayload): void => {
      if (payload.totalWaiting !== totalWaiting) return;
      client.off('session:queue:changed', listener);
      resolve(payload);
    };
    client.on('session:queue:changed', listener);
  });
}

function waitForOperationalStudents(
  client: TestClient,
  predicate: (payload: readonly OperationalStudentPresencePayload[]) => boolean,
): Promise<readonly OperationalStudentPresencePayload[]> {
  return new Promise((resolve) => {
    const listener = (payload: readonly OperationalStudentPresencePayload[]): void => {
      if (!predicate(payload)) return;
      client.off('students:presence:changed', listener);
      resolve(payload);
    };
    client.on('students:presence:changed', listener);
  });
}

function waitForRequestError(
  client: TestClient,
): Promise<{ readonly code: string; readonly message: string }> {
  return new Promise((resolve) => client.once('session:request:error', resolve));
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

function waitForRecovered(client: TestClient): Promise<SessionLifecyclePayload> {
  return new Promise((resolve) => client.once('session:recovered', resolve));
}

function recoverSession(
  client: TestClient,
  payload: { readonly sessionId: string; readonly recoveryToken: string },
): Promise<{ readonly ok: boolean; readonly message?: string }> {
  return new Promise((resolve) => client.emit('session:recover', payload, resolve));
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

function waitForScreenShare(
  client: TestClient,
  event: 'screen-share:start' | 'screen-share:stop',
): Promise<ScreenSharePayload> {
  return new Promise((resolve) => client.once(event, resolve));
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
