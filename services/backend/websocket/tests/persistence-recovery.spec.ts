import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  PresenceManager,
  SessionManager,
  SessionRequestManager,
  StudentPresenceManager,
  type AttendanceSession,
  type Professor,
  type SessionRequest,
  type OnlineStudent,
} from '../src/index.js';

test('persiste o fluxo e recupera históricos depois de recriar os managers', () => {
  const savedProfessors: Professor[] = [];
  const savedStudents: OnlineStudent[] = [];
  const savedRequests: SessionRequest[] = [];
  const savedSessions: AttendanceSession[] = [];
  const featureUsage: string[] = [];
  const auditActions: string[] = [];
  const audit = {
    record: (record: { readonly action: string }) => auditActions.push(record.action),
  };
  const clock = () => new Date('2026-07-31T12:00:00.000Z');

  const professors = new PresenceManager(clock, () => 'teacher-id', {
    saveProfessor: (professor) => savedProfessors.push(professor),
    updateHeartbeat: () => undefined,
    markOffline: () => undefined,
  });
  const students = new StudentPresenceManager(clock, {
    saveStudent: (student) => savedStudents.push(student),
    updateHeartbeat: () => undefined,
    markOffline: () => undefined,
  });
  professors.registerProfessor({ name: 'Carlos', socketId: 'teacher-socket' });
  students.registerStudent({ id: 'student-id', name: 'Ana', socketId: 'student-socket' });

  const requests = new SessionRequestManager(professors, students, {
    clock,
    idFactory: () => 'request-id',
    timeoutMs: 30_000,
    persistence: { saveRequest: (request) => savedRequests.push(request) },
    audit,
  });
  requests.createRequest('student-socket', 'teacher-id');
  const accepted = requests.acceptRequest('request-id', 'teacher-socket');

  const sessions = new SessionManager(professors, students, {
    clock,
    idFactory: () => 'session-id',
    persistence: {
      saveSession: (session) => savedSessions.push(session),
      markFeatureUsed: (sessionId, feature) => featureUsage.push(`${sessionId}:${feature}`),
    },
    audit,
  });
  sessions.createSession(accepted.request);
  sessions.markFeatureUsed('session-id', 'screen-share');
  sessions.endSession('session-id', 'student-socket');
  requests.close();

  assert.equal(savedProfessors.length, 1);
  assert.equal(savedStudents.length, 1);
  assert.deepEqual(
    savedRequests.map((request) => request.status),
    ['pending', 'accepted'],
  );
  assert.deepEqual(
    savedSessions.map((session) => session.status),
    ['active', 'finished'],
  );
  assert.deepEqual(featureUsage, ['session-id:screen-share']);
  assert.deepEqual(auditActions, [
    'session-request.created',
    'session-request.accepted',
    'session.started',
    'session.finished',
  ]);

  const recoveredRequests = new SessionRequestManager(undefined, undefined, {
    initialHistory: [savedRequests.at(-1)!],
  });
  const recoveredSessions = new SessionManager(undefined, undefined, {
    initialHistory: [savedSessions.at(-1)!],
  });
  assert.equal(recoveredRequests.listHistory()[0]?.status, 'accepted');
  assert.equal(recoveredSessions.findSession('session-id')?.status, 'finished');
  recoveredRequests.close();
});
