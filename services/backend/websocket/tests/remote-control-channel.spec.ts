import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';

import {
  REMOTE_CONTROL_CHANNEL_EVENTS,
  type RemoteControlApproved,
  type RemoteControlDenied,
  type RemoteControlKeyboardPayload,
  type RemoteControlMousePayload,
  type RemoteControlRequest,
  type RemoteControlStopPayload,
} from '@professor-connect/protocol';
import { io, type Socket } from 'socket.io-client';

import {
  initializeWebSocket,
  PresenceManager,
  SessionManager,
  SessionRequestManager,
  StudentPresenceManager,
} from '../src/index.js';

interface ServerEvents {
  [REMOTE_CONTROL_CHANNEL_EVENTS.REQUEST]: (payload: RemoteControlRequest) => void;
  [REMOTE_CONTROL_CHANNEL_EVENTS.APPROVED]: (payload: RemoteControlApproved) => void;
  [REMOTE_CONTROL_CHANNEL_EVENTS.DENIED]: (payload: RemoteControlDenied) => void;
  [REMOTE_CONTROL_CHANNEL_EVENTS.MOUSE]: (payload: RemoteControlMousePayload) => void;
  [REMOTE_CONTROL_CHANNEL_EVENTS.KEYBOARD]: (payload: RemoteControlKeyboardPayload) => void;
  [REMOTE_CONTROL_CHANNEL_EVENTS.STOP]: (payload: RemoteControlStopPayload) => void;
}

interface ClientEvents extends ServerEvents {
  'professor:online': (payload: { readonly name: string }) => void;
  'student:register': (payload: { readonly id: string; readonly name: string }) => void;
  'session:end': (payload: { readonly sessionId: string }) => void;
}

type TestClient = Socket<ServerEvents, ClientEvents>;

test('autoriza, isola e transporta eventos sem executá-los', async () => {
  const httpServer = createServer();
  const professors = new PresenceManager(undefined, () => 'teacher-id');
  const students = new StudentPresenceManager();
  const sessionRequests = new SessionRequestManager(professors, students);
  const activeSessions = new SessionManager(professors, students, {
    idFactory: () => 'session-id',
  });
  const logs: string[] = [];
  const errors: string[] = [];
  const gateway = initializeWebSocket(
    httpServer,
    {
      info(message): void {
        logs.push(message);
      },
      error(message): void {
        errors.push(message);
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
  const outsider: TestClient = io(url, { transports: ['websocket'] });

  const requests: RemoteControlRequest[] = [];
  const approvals: RemoteControlApproved[] = [];
  const denials: RemoteControlDenied[] = [];
  const mouseEvents: RemoteControlMousePayload[] = [];
  const keyboardEvents: RemoteControlKeyboardPayload[] = [];
  const teacherStops: RemoteControlStopPayload[] = [];
  const studentStops: RemoteControlStopPayload[] = [];
  student.on(REMOTE_CONTROL_CHANNEL_EVENTS.REQUEST, (payload) => requests.push(payload));
  teacher.on(REMOTE_CONTROL_CHANNEL_EVENTS.APPROVED, (payload) => approvals.push(payload));
  teacher.on(REMOTE_CONTROL_CHANNEL_EVENTS.DENIED, (payload) => denials.push(payload));
  student.on(REMOTE_CONTROL_CHANNEL_EVENTS.MOUSE, (payload) => mouseEvents.push(payload));
  student.on(REMOTE_CONTROL_CHANNEL_EVENTS.KEYBOARD, (payload) => keyboardEvents.push(payload));
  teacher.on(REMOTE_CONTROL_CHANNEL_EVENTS.STOP, (payload) => teacherStops.push(payload));
  student.on(REMOTE_CONTROL_CHANNEL_EVENTS.STOP, (payload) => studentStops.push(payload));

  try {
    await Promise.all([waitForConnect(teacher), waitForConnect(student), waitForConnect(outsider)]);
    teacher.emit('professor:online', { name: 'Carlos' });
    student.emit('student:register', { id: 'student-id', name: 'Ana' });
    await waitUntil(
      () =>
        professors.getOnlineProfessors().length === 1 && students.getOnlineStudents().length === 1,
    );
    activeSessions.createSession({
      requestId: 'attendance-request',
      teacherId: 'teacher-id',
      teacherName: 'Carlos',
      studentId: 'student-id',
      studentName: 'Ana',
      createdAt: new Date().toISOString(),
      status: 'accepted',
    });

    outsider.emit(REMOTE_CONTROL_CHANNEL_EVENTS.REQUEST, {
      sessionId: 'session-id',
      requestId: 'outsider-request',
    });
    await waitForDelay();
    assert.equal(requests.length, 0);

    const firstRequest = { sessionId: 'session-id', requestId: 'remote-request-1' };
    teacher.emit(REMOTE_CONTROL_CHANNEL_EVENTS.REQUEST, firstRequest);
    await waitUntil(() => requests.length === 1);
    assert.deepEqual(requests[0], firstRequest);

    const mousePayload: RemoteControlMousePayload = {
      ...firstRequest,
      event: { type: 'mousemove', x: 0.4, y: 0.6, button: 0, buttons: 0 },
    };
    teacher.emit(REMOTE_CONTROL_CHANNEL_EVENTS.MOUSE, mousePayload);
    await waitForDelay();
    assert.equal(mouseEvents.length, 0);

    student.emit(REMOTE_CONTROL_CHANNEL_EVENTS.APPROVED, firstRequest);
    await waitUntil(() => approvals.length === 1);
    teacher.emit(REMOTE_CONTROL_CHANNEL_EVENTS.MOUSE, mousePayload);
    const keyboardPayload: RemoteControlKeyboardPayload = {
      ...firstRequest,
      event: {
        type: 'keydown',
        key: 'a',
        code: 'KeyA',
        repeat: false,
        altKey: false,
        ctrlKey: false,
        shiftKey: false,
        metaKey: false,
      },
    };
    teacher.emit(REMOTE_CONTROL_CHANNEL_EVENTS.KEYBOARD, keyboardPayload);
    teacher.emit(REMOTE_CONTROL_CHANNEL_EVENTS.KEYBOARD, {
      ...firstRequest,
      event: {
        type: 'keypress',
        key: ' ',
        code: 'Space',
        repeat: false,
        altKey: false,
        ctrlKey: false,
        shiftKey: false,
        metaKey: false,
      },
    });
    await waitUntil(() => mouseEvents.length === 1 && keyboardEvents.length === 2);
    assert.deepEqual(mouseEvents[0], mousePayload);
    assert.deepEqual(keyboardEvents[0], keyboardPayload);
    assert.equal(keyboardEvents[1]?.event.key, ' ');
    teacher.emit(REMOTE_CONTROL_CHANNEL_EVENTS.MOUSE, {
      ...firstRequest,
      event: { type: 'dblclick', x: 0.4, y: 0.6, button: 0, buttons: 0 },
    });
    await waitUntil(() => mouseEvents.length === 2);
    assert.equal(mouseEvents[1]?.event.type, 'dblclick');

    student.emit(REMOTE_CONTROL_CHANNEL_EVENTS.MOUSE, mousePayload);
    await waitForDelay();
    assert.equal(mouseEvents.length, 2);

    student.emit(REMOTE_CONTROL_CHANNEL_EVENTS.STOP, {
      ...firstRequest,
      reason: 'participant',
    });
    await waitUntil(() => teacherStops.length === 1);
    assert.equal(teacherStops[0]?.reason, 'participant');
    teacher.emit(REMOTE_CONTROL_CHANNEL_EVENTS.MOUSE, mousePayload);
    await waitForDelay();
    assert.equal(mouseEvents.length, 2);

    const deniedRequest = { sessionId: 'session-id', requestId: 'remote-request-2' };
    teacher.emit(REMOTE_CONTROL_CHANNEL_EVENTS.REQUEST, deniedRequest);
    await waitUntil(() => requests.length === 2);
    student.emit(REMOTE_CONTROL_CHANNEL_EVENTS.DENIED, deniedRequest);
    await waitUntil(() => denials.length === 1);
    assert.deepEqual(denials[0], deniedRequest);

    const sessionEndRequest = { sessionId: 'session-id', requestId: 'remote-request-3' };
    teacher.emit(REMOTE_CONTROL_CHANNEL_EVENTS.REQUEST, sessionEndRequest);
    await waitUntil(() => requests.length === 3);
    student.emit(REMOTE_CONTROL_CHANNEL_EVENTS.APPROVED, sessionEndRequest);
    await waitUntil(() => approvals.length === 2);
    teacher.emit('session:end', { sessionId: 'session-id' });
    await waitUntil(() => teacherStops.length === 2 && studentStops.length === 1);
    assert.equal(teacherStops.at(-1)?.reason, 'session-ended');
    assert.equal(studentStops.at(-1)?.reason, 'session-ended');

    activeSessions.createSession({
      requestId: 'attendance-request-2',
      teacherId: 'teacher-id',
      teacherName: 'Carlos',
      studentId: 'student-id',
      studentName: 'Ana',
      createdAt: new Date().toISOString(),
      status: 'accepted',
    });
    const disconnectRequest = {
      sessionId: 'session-id',
      requestId: 'remote-request-disconnect',
    };
    teacher.emit(REMOTE_CONTROL_CHANNEL_EVENTS.REQUEST, disconnectRequest);
    await waitUntil(() => requests.length === 4);
    student.emit(REMOTE_CONTROL_CHANNEL_EVENTS.APPROVED, disconnectRequest);
    await waitUntil(() => approvals.length === 3);
    student.disconnect();
    await waitUntil(() => teacherStops.length === 3);
    assert.equal(teacherStops.at(-1)?.reason, 'disconnect');

    assert(logs.includes('Solicitação enviada'));
    assert(logs.includes('Solicitação aceita'));
    assert(logs.includes('Solicitação negada'));
    assert(logs.includes('Evento recebido'));
    assert(logs.includes('Controle encerrado'));
    assert(errors.includes('Solicitação de controle remoto inválida'));
    assert(errors.includes('Evento de mouse inválido'));
  } finally {
    teacher.disconnect();
    student.disconnect();
    outsider.disconnect();
    await new Promise<void>((resolve) => gateway.close(resolve));
  }
});

async function waitForConnect(client: TestClient): Promise<void> {
  if (client.connected) {
    return;
  }
  await new Promise<void>((resolve) => client.once('connect', resolve));
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

async function waitForDelay(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 50));
}
