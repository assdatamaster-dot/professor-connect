import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PresenceManager, SessionManager, StudentPresenceManager } from '../src/index.js';

test('cria, localiza, lista e encerra uma sessão ativa', () => {
  const professors = new PresenceManager(
    () => new Date('2026-07-23T12:00:00.000Z'),
    () => 'teacher-id',
  );
  const students = new StudentPresenceManager(() => new Date('2026-07-23T12:00:00.000Z'));
  professors.registerProfessor({ name: 'Carlos', socketId: 'teacher-socket' });
  students.registerStudent({ id: 'student-id', name: 'Ana', socketId: 'student-socket' });
  const manager = new SessionManager(professors, students, {
    clock: () => new Date('2026-07-23T12:00:00.000Z'),
    idFactory: () => 'session-id',
  });

  const created = manager.createSession({
    requestId: 'request-id',
    teacherId: 'teacher-id',
    teacherName: 'Carlos',
    studentId: 'student-id',
    studentName: 'Ana',
    createdAt: '2026-07-23T11:59:00.000Z',
    status: 'accepted',
  });

  assert.deepEqual(created.session, {
    sessionId: 'session-id',
    requestId: 'request-id',
    teacherId: 'teacher-id',
    teacherName: 'Carlos',
    studentId: 'student-id',
    studentName: 'Ana',
    createdAt: '2026-07-23T12:00:00.000Z',
    status: 'active',
  });
  assert.equal(manager.findSession('session-id')?.status, 'active');
  assert.equal(manager.listActiveSessions().length, 1);

  const finished = manager.endSession('session-id', 'student-socket');

  assert.equal(finished.session.status, 'finished');
  assert.deepEqual(manager.listActiveSessions(), []);
  assert.equal(manager.listHistory()[0]?.status, 'finished');
  assert.equal(manager.findSession('session-id')?.status, 'finished');
});

test('somente professor ou aluno participantes podem encerrar', () => {
  const professors = new PresenceManager(undefined, () => 'teacher-id');
  const students = new StudentPresenceManager();
  professors.registerProfessor({ name: 'Carlos', socketId: 'teacher-socket' });
  students.registerStudent({ id: 'student-id', name: 'Ana', socketId: 'student-socket' });
  const manager = new SessionManager(professors, students, { idFactory: () => 'session-id' });
  manager.createSession({
    requestId: 'request-id',
    teacherId: 'teacher-id',
    teacherName: 'Carlos',
    studentId: 'student-id',
    studentName: 'Ana',
    createdAt: new Date().toISOString(),
    status: 'accepted',
  });

  assert.throws(
    () => manager.endSession('session-id', 'unknown-socket'),
    /Somente um participante/,
  );
  assert.equal(manager.listActiveSessions().length, 1);
});
