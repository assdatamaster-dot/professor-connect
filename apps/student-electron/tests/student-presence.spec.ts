import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { Server as SocketServer } from 'socket.io';

import { StudentPresenceController } from '../main/student-presence.controller.js';

interface PresenceEvents {
  'student:disconnect': (acknowledge: () => void) => void;
  'student:heartbeat': () => void;
  'student:register': (payload: { readonly id: string; readonly name: string }) => void;
  'request:session': (payload: { readonly teacherId: string }) => void;
  'session:end': (payload: { readonly sessionId: string }) => void;
}

interface SessionEvents {
  'session:accepted': (payload: {
    readonly requestId: string;
    readonly teacherId: string;
    readonly teacherName: string;
  }) => void;
  'session:rejected': () => void;
  'session:timeout': () => void;
  'session:started': (payload: SessionLifecyclePayload) => void;
  'session:ended': (payload: SessionLifecyclePayload) => void;
}

interface SessionLifecyclePayload {
  readonly sessionId: string;
  readonly teacherId: string;
  readonly teacherName: string;
  readonly studentId: string;
  readonly studentName: string;
}

test('conecta, registra, mantém heartbeat e desconecta o aluno automaticamente', async () => {
  const httpServer = createServer((request, response) => {
    if (request.url === '/api/professors/online') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ professors: [{ id: 'teacher-id', name: 'Carlos' }] }));
    }
  });
  const socketServer = new SocketServer<PresenceEvents, SessionEvents>(httpServer, {
    serveClient: false,
  });
  const registrations: Array<{ readonly id: string; readonly name: string }> = [];
  let heartbeatCount = 0;
  let studentDisconnectCount = 0;
  const requestedTeacherIds: string[] = [];
  const endedSessionIds: string[] = [];

  socketServer.on('connection', (socket) => {
    socket.on('student:register', (payload) => registrations.push(payload));
    socket.on('student:heartbeat', () => {
      heartbeatCount += 1;
    });
    socket.on('student:disconnect', (acknowledge) => {
      studentDisconnectCount += 1;
      acknowledge();
    });
    socket.on('request:session', ({ teacherId }) => {
      requestedTeacherIds.push(teacherId);
      socket.emit('session:accepted', {
        requestId: 'request-id',
        teacherId,
        teacherName: 'Carlos',
      });
      socket.emit('session:started', {
        sessionId: 'session-id',
        teacherId,
        teacherName: 'Carlos',
        studentId: 'student-id',
        studentName: 'Ana',
      });
    });
    socket.on('session:end', ({ sessionId }) => {
      endedSessionIds.push(sessionId);
      socket.emit('session:ended', {
        sessionId,
        teacherId: 'teacher-id',
        teacherName: 'Carlos',
        studentId: 'student-id',
        studentName: 'Ana',
      });
    });
  });
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));

  const address = httpServer.address();
  assert(address !== null && typeof address === 'object');
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'student-presence-'));
  const configPath = path.join(temporaryDirectory, 'config.json');
  await writeFile(
    configPath,
    JSON.stringify({ serverUrl: `http://127.0.0.1:${address.port}` }),
    'utf8',
  );
  const controller = new StudentPresenceController(
    configPath,
    { id: 'student-id', name: 'Ana' },
    20,
  );

  try {
    await controller.connect();
    await waitUntil(() => registrations.length === 1 && heartbeatCount > 0);

    assert.deepEqual(registrations[0], { id: 'student-id', name: 'Ana' });
    assert.deepEqual(await controller.getOnlineTeachers(), [{ id: 'teacher-id', name: 'Carlos' }]);

    const waiting = controller.requestSession('teacher-id');
    assert.equal(waiting.message, 'Aguardando resposta...');
    await waitUntil(() => controller.getSessionSnapshot().status === 'connected');
    assert.deepEqual(requestedTeacherIds, ['teacher-id']);
    assert.equal(controller.getSessionSnapshot().message, 'Conectado ao professor');
    assert.equal(controller.getSessionSnapshot().activeSessionId, 'session-id');

    controller.endSession();
    await waitUntil(() => controller.getSessionSnapshot().status === 'ended');
    assert.deepEqual(endedSessionIds, ['session-id']);
    assert.equal(controller.getSessionSnapshot().message, 'Atendimento encerrado');

    controller.dispose();
    await waitUntil(() => studentDisconnectCount === 1);
  } finally {
    controller.dispose();
    await new Promise<void>((resolve, reject) => {
      socketServer.close((error) => (error === undefined ? resolve() : reject(error)));
    });
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

async function waitUntil(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;

  while (!condition()) {
    if (Date.now() >= deadline) {
      throw new Error('Tempo limite excedido');
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}
