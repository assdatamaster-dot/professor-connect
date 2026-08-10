import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  PresenceManager,
  SessionManager,
  SessionRequestManager,
  StudentPresenceManager,
} from '../src/index.js';

test('cria e aceita uma solicitação direcionada ao professor online', () => {
  const { manager, professors } = createScenario(1_000);
  const delivery = manager.createRequest('student-socket', 'teacher-id');

  assert.deepEqual(delivery.request, {
    requestId: 'request-1',
    studentId: 'student-id',
    studentName: 'Ana',
    teacherId: 'teacher-id',
    teacherName: 'Carlos',
    status: 'pending',
    createdAt: '2026-07-22T12:00:00.000Z',
  });
  assert.equal(delivery.teacherSocketId, 'teacher-socket');
  assert.equal(manager.listPendingRequests().length, 1);
  assert.equal(professors.findProfessorById('teacher-id')?.availability, 'busy');

  const accepted = manager.acceptRequest('request-1', 'teacher-socket');

  assert.equal(accepted.request.status, 'accepted');
  assert.deepEqual(manager.listPendingRequests(), []);
  assert.equal(manager.listHistory()[0]?.status, 'accepted');
  manager.close();
});

test('recusa a solicitação e impede resposta de outro professor', () => {
  const { manager, professors } = createScenario(1_000);
  professors.registerProfessor({ name: 'Outra pessoa', socketId: 'other-socket' });
  manager.createRequest('student-socket', 'teacher-id');

  assert.throws(
    () => manager.rejectRequest('request-1', 'other-socket'),
    /Somente o professor solicitado/,
  );

  const rejected = manager.rejectRequest('request-1', 'teacher-socket');
  assert.equal(rejected.request.status, 'rejected');
  assert.equal(manager.listHistory()[0]?.status, 'rejected');
  assert.equal(professors.findProfessorById('teacher-id')?.availability, 'available');
  manager.close();
});

test('aceita solicitações somente quando o professor está disponível', () => {
  const { manager, professors } = createScenario(1_000);
  professors.setAvailability('teacher-socket', 'unavailable');

  assert.throws(
    () => manager.createRequest('student-socket', 'teacher-id'),
    /Professor indisponível/,
  );
  assert.deepEqual(manager.listPendingRequests(), []);
  manager.close();
});

test('aluno cancela a própria solicitação e o evento permanece no histórico', () => {
  const { manager, professors } = createScenario(1_000);
  manager.createRequest('student-socket', 'teacher-id');

  const cancelled = manager.cancelRequest('request-1', 'student-socket');

  assert.equal(cancelled.request.status, 'cancelled');
  assert.equal(cancelled.request.respondedAt, '2026-07-22T12:00:00.000Z');
  assert.deepEqual(manager.listPendingRequests(), []);
  assert.equal(manager.listHistory()[0]?.status, 'cancelled');
  assert.equal(professors.findProfessorById('teacher-id')?.availability, 'available');
  manager.close();
});

test('não aceita a solicitação depois que o aluno fica offline', () => {
  const { manager, students } = createScenario(1_000);
  manager.createRequest('student-socket', 'teacher-id');
  students.removeStudent('student-socket');

  assert.throws(
    () => manager.acceptRequest('request-1', 'teacher-socket'),
    /Aluno solicitante não está mais online/,
  );
  assert.equal(manager.listPendingRequests()[0]?.status, 'pending');
  assert.equal(manager.listHistory()[0]?.status, 'pending');
  manager.close();
});

test('expira em 30 segundos, remove dos pendentes e preserva no histórico', async () => {
  const { manager, professors } = createScenario(30);
  const expired = new Promise<void>((resolve) => {
    manager.onExpired((delivery) => {
      assert.equal(delivery.request.status, 'expired');
      resolve();
    });
  });

  manager.createRequest('student-socket', 'teacher-id');
  await expired;

  assert.deepEqual(manager.listPendingRequests(), []);
  assert.equal(manager.listHistory()[0]?.status, 'expired');
  assert.equal(professors.findProfessorById('teacher-id')?.availability, 'available');
  manager.close();
});

test('mantém fila FIFO, recalcula posições e preserva solicitações em desconexões', () => {
  const clock = () => new Date('2026-08-10T12:00:00.000Z');
  const professors = new PresenceManager(clock, () => 'teacher-id');
  const students = new StudentPresenceManager(clock);
  professors.registerProfessor({ id: 'teacher-id', name: 'Carlos', socketId: 'teacher-socket' });
  for (const [id, name] of [
    ['student-a', 'Ana'],
    ['student-b', 'Bruno'],
    ['student-c', 'Carla'],
    ['student-d', 'Diego'],
  ] as const) {
    students.registerStudent({ id, name, socketId: `${id}-socket` });
  }
  let requestSequence = 0;
  const manager = new SessionRequestManager(professors, students, {
    clock,
    idFactory: () => `request-${++requestSequence}`,
    timeoutMs: 60_000,
  });
  const sessions = new SessionManager(professors, students, {
    clock,
    idFactory: () => 'session-a',
  });
  const queueSnapshots: number[][] = [];
  manager.onQueueChanged((_teacherId, queue) => {
    queueSnapshots.push(queue.map((entry) => entry.position));
  });

  const direct = manager.createRequest('student-a-socket', 'teacher-id');
  assert.equal(direct.queue?.mode, 'direct');
  const accepted = manager.acceptRequest(direct.request.requestId, 'teacher-socket');
  sessions.createSession(accepted.request);

  manager.createRequest('student-b-socket', 'teacher-id');
  manager.createRequest('student-c-socket', 'teacher-id');
  manager.createRequest('student-d-socket', 'teacher-id');
  assert.deepEqual(
    manager.getQueueForTeacher('teacher-id').map(({ studentId, position, studentsAhead }) => ({
      studentId,
      position,
      studentsAhead,
    })),
    [
      { studentId: 'student-b', position: 1, studentsAhead: 0 },
      { studentId: 'student-c', position: 2, studentsAhead: 1 },
      { studentId: 'student-d', position: 3, studentsAhead: 2 },
    ],
  );

  manager.cancelRequest('request-3', 'student-c-socket');
  assert.deepEqual(
    manager.getQueueForTeacher('teacher-id').map(({ studentId, position }) => ({
      studentId,
      position,
    })),
    [
      { studentId: 'student-b', position: 1 },
      { studentId: 'student-d', position: 2 },
    ],
  );

  professors.removeProfessor('teacher-socket');
  assert.equal(manager.getQueueForStudent('student-b')?.teacherOnline, false);
  professors.registerProfessor({
    id: 'teacher-id',
    name: 'Carlos',
    socketId: 'teacher-reconnected',
  });
  manager.synchronizeProfessorQueue('teacher-id');
  assert.equal(manager.getQueueForStudent('student-b')?.teacherOnline, true);
  assert.equal(professors.findProfessorById('teacher-id')?.availability, 'busy');
  assert(queueSnapshots.some((positions) => positions.join(',') === '1,2,3'));
  manager.close();
});

test('impede duas sessões simultâneas para o mesmo professor', () => {
  const { manager, professors, students } = createScenario(1_000);
  const accepted = manager.acceptRequest(
    manager.createRequest('student-socket', 'teacher-id').request.requestId,
    'teacher-socket',
  );
  const sessions = new SessionManager(professors, students, { idFactory: () => 'session-1' });
  sessions.createSession(accepted.request);

  assert.throws(
    () =>
      sessions.createSession({
        ...accepted.request,
        requestId: 'request-2',
        studentId: 'another-student',
        studentName: 'Outro aluno',
      }),
    /já possui um atendimento ativo/,
  );
  manager.close();
});

test('ordena solicitações concorrentes pelo ID quando timestamps coincidem', async () => {
  const clock = () => new Date('2026-08-10T12:00:00.000Z');
  const professors = new PresenceManager(clock, () => 'teacher-id');
  const students = new StudentPresenceManager(clock);
  professors.registerProfessor({ id: 'teacher-id', name: 'Carlos', socketId: 'teacher-socket' });
  students.registerStudent({ id: 'student-b', name: 'Bia', socketId: 'student-b-socket' });
  students.registerStudent({ id: 'student-a', name: 'Ana', socketId: 'student-a-socket' });
  const ids = ['request-b', 'request-a'];
  const manager = new SessionRequestManager(professors, students, {
    clock,
    idFactory: () => ids.shift() ?? 'request-z',
    timeoutMs: 60_000,
  });

  await Promise.all([
    Promise.resolve().then(() => manager.createRequest('student-b-socket', 'teacher-id')),
    Promise.resolve().then(() => manager.createRequest('student-a-socket', 'teacher-id')),
  ]);
  assert.deepEqual(
    manager.getQueueForTeacher('teacher-id').map((entry) => entry.requestId),
    ['request-a', 'request-b'],
  );
  manager.close();
});

function createScenario(timeoutMs: number): {
  readonly manager: SessionRequestManager;
  readonly professors: PresenceManager;
  readonly students: StudentPresenceManager;
} {
  let professorSequence = 0;
  const professors = new PresenceManager(
    () => new Date('2026-07-22T12:00:00.000Z'),
    () => (++professorSequence === 1 ? 'teacher-id' : `other-teacher-${professorSequence}`),
  );
  const students = new StudentPresenceManager(() => new Date('2026-07-22T12:00:00.000Z'));
  let requestSequence = 0;

  professors.registerProfessor({ name: 'Carlos', socketId: 'teacher-socket' });
  students.registerStudent({
    id: 'student-id',
    name: 'Ana',
    socketId: 'student-socket',
  });

  return {
    professors,
    students,
    manager: new SessionRequestManager(professors, students, {
      clock: () => new Date('2026-07-22T12:00:00.000Z'),
      idFactory: () => `request-${++requestSequence}`,
      timeoutMs,
    }),
  };
}
