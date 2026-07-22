import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PresenceManager, SessionRequestManager, StudentPresenceManager } from '../src/index.js';

test('cria e aceita uma solicitação direcionada ao professor online', () => {
  const { manager } = createScenario(1_000);
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
  manager.close();
});

test('expira em 30 segundos, remove dos pendentes e preserva no histórico', async () => {
  const { manager } = createScenario(30);
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
  manager.close();
});

function createScenario(timeoutMs: number): {
  readonly manager: SessionRequestManager;
  readonly professors: PresenceManager;
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
    manager: new SessionRequestManager(professors, students, {
      clock: () => new Date('2026-07-22T12:00:00.000Z'),
      idFactory: () => `request-${++requestSequence}`,
      timeoutMs,
    }),
  };
}
