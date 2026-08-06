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

  assert.equal(created.session.sessionId, 'session-id');
  assert.equal(created.session.connectionState, 'CONNECTED');
  assert.equal(created.session.disconnectCount, 0);
  assert.equal(created.teacherRecoveryToken?.length, 43);
  assert.equal(created.studentRecoveryToken?.length, 43);
  assert.notEqual(created.teacherRecoveryToken, created.studentRecoveryToken);
  assert.equal(manager.findSession('session-id')?.status, 'active');
  assert.equal(professors.findProfessorById('teacher-id')?.availability, 'busy');
  assert.equal(manager.listActiveSessions().length, 1);
  assert.equal(
    manager.resolveSignalingRoute('session-id', 'teacher-socket').recipientSocketId,
    'student-socket',
  );
  assert.equal(
    manager.resolveSignalingRoute('session-id', 'student-socket').recipientSocketId,
    'teacher-socket',
  );

  const finished = manager.endSession('session-id', 'student-socket');

  assert.equal(finished.session.status, 'finished');
  assert.equal(finished.session.endedAt, '2026-07-23T12:00:00.000Z');
  assert.equal(finished.session.durationSeconds, 0);
  assert.equal(professors.findProfessorById('teacher-id')?.availability, 'available');
  assert.deepEqual(manager.listActiveSessions(), []);
  assert.equal(manager.listHistory()[0]?.status, 'finished');
  assert.equal(manager.findSession('session-id')?.status, 'finished');
  assert.throws(
    () => manager.resolveSignalingRoute('session-id', 'teacher-socket'),
    /Sessão ativa não encontrada/,
  );
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
  assert.throws(
    () => manager.resolveSignalingRoute('session-id', 'unknown-socket'),
    /Remetente não pertence/,
  );
  assert.equal(manager.listActiveSessions().length, 1);
});

test('preserva e recupera a mesma sessão após queda transitória', () => {
  const professors = new PresenceManager(undefined, () => 'teacher-id');
  const students = new StudentPresenceManager();
  professors.registerProfessor({ name: 'Carlos', socketId: 'teacher-socket' });
  students.registerStudent({ id: 'student-id', name: 'Ana', socketId: 'student-socket' });
  const manager = new SessionManager(professors, students, { idFactory: () => 'session-id' });
  const created = manager.createSession({
    requestId: 'request-id',
    teacherId: 'teacher-id',
    teacherName: 'Carlos',
    studentId: 'student-id',
    studentName: 'Ana',
    createdAt: new Date().toISOString(),
    status: 'accepted',
  });

  students.removeStudent('student-socket');
  const [recovering] = manager.markParticipantDisconnected('student-socket');

  assert.equal(recovering?.session.status, 'active');
  assert.equal(recovering?.session.connectionState, 'RECONNECTING');
  assert.equal(recovering?.teacherSocketId, 'teacher-socket');
  assert.equal(recovering?.studentSocketId, undefined);
  assert.equal(manager.listActiveSessions().length, 1);
  assert.throws(
    () =>
      manager.recoverSession(
        'session-id',
        'invalid-token-that-cannot-authorize-a-session',
        'attacker-socket',
        socketIdentity('STUDENT', 'student-id', 'Ana'),
      ),
    /Token de recuperação inválido/,
  );
  assert.throws(
    () =>
      manager.recoverSession(
        'session-id',
        created.studentRecoveryToken ?? '',
        'attacker-socket',
        socketIdentity('STUDENT', 'another-student', 'Intruso'),
      ),
    /Identidade não pertence/,
  );
  const recovered = manager.recoverSession(
    'session-id',
    created.studentRecoveryToken ?? '',
    'student-socket-reconnected',
    {
      userId: 'student-user',
      organizationId: 'organization-id',
      displayName: 'Ana',
      roles: ['STUDENT'],
      permissions: ['socket.connect'],
      profileId: 'student-id',
      sessionFamilyId: 'family-id',
    },
  );
  assert.equal(recovered.session.sessionId, 'session-id');
  assert.equal(recovered.session.connectionState, 'CONNECTED');
  assert.equal(recovered.studentSocketId, 'student-socket-reconnected');
  assert.equal(recovered.fullyRecovered, true);
  manager.markParticipantDisconnected('student-socket-reconnected');
  const recoveredAgain = manager.recoverSession(
    'session-id',
    recovered.recoveryToken,
    'student-socket-third',
    socketIdentity('STUDENT', 'student-id', 'Ana'),
  );
  assert.equal(recoveredAgain.session.disconnectCount, 2);
  assert.equal(recoveredAgain.session.connectionState, 'CONNECTED');
  assert.deepEqual(manager.endSessionsForParticipant('unknown-socket'), []);
});

test('recupera a mesma sessão depois de reiniciar o backend', () => {
  const firstProfessors = new PresenceManager(undefined, () => 'teacher-id');
  const firstStudents = new StudentPresenceManager();
  firstProfessors.registerProfessor({ name: 'Carlos', socketId: 'teacher-old' });
  firstStudents.registerStudent({ id: 'student-id', name: 'Ana', socketId: 'student-old' });
  const firstManager = new SessionManager(firstProfessors, firstStudents, {
    idFactory: () => 'stable-session-id',
  });
  const created = firstManager.createSession({
    requestId: 'request-restart',
    teacherId: 'teacher-id',
    teacherName: 'Carlos',
    studentId: 'student-id',
    studentName: 'Ana',
    createdAt: new Date().toISOString(),
    status: 'accepted',
  });

  const restoredProfessors = new PresenceManager(undefined, () => 'teacher-id');
  const restoredStudents = new StudentPresenceManager();
  restoredProfessors.registerProfessor({ name: 'Carlos', socketId: 'teacher-new' });
  restoredStudents.registerStudent({ id: 'student-id', name: 'Ana', socketId: 'student-new' });
  const restoredManager = new SessionManager(restoredProfessors, restoredStudents, {
    initialHistory: [created.session],
  });

  assert.equal(restoredManager.findSession('stable-session-id')?.connectionState, 'RECOVERING');
  const teacherRecovery = restoredManager.recoverSession(
    'stable-session-id',
    created.teacherRecoveryToken ?? '',
    'teacher-new',
    socketIdentity('TEACHER', 'teacher-id', 'Carlos'),
  );
  assert.equal(teacherRecovery.fullyRecovered, false);
  const studentRecovery = restoredManager.recoverSession(
    'stable-session-id',
    created.studentRecoveryToken ?? '',
    'student-new',
    socketIdentity('STUDENT', 'student-id', 'Ana'),
  );
  assert.equal(studentRecovery.fullyRecovered, true);
  assert.equal(studentRecovery.session.sessionId, 'stable-session-id');
});

function socketIdentity(role: 'TEACHER' | 'STUDENT', profileId: string, displayName: string) {
  return {
    userId: `${profileId}-user`,
    organizationId: 'organization-id',
    displayName,
    roles: [role],
    permissions: ['socket.connect'],
    profileId,
    sessionFamilyId: `${profileId}-family`,
  } as const;
}
