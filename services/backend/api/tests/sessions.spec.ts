import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';

import {
  PresenceManager,
  SessionManager,
  SessionRequestManager,
  StudentPresenceManager,
} from '@professor-connect/websocket';

import { createApp } from '../src/app.js';
import { AUTHORIZATION_HEADERS, TestAuthService } from './auth-fixture.js';
import type { AuthenticatedIdentity } from '../src/auth/auth.types.js';
import { TEST_IDENTITY } from './auth-fixture.js';

test('expõe solicitações pendentes e o histórico completo', async () => {
  const professors = new PresenceManager(
    () => new Date('2026-07-22T12:00:00.000Z'),
    () => 'teacher-id',
  );
  const students = new StudentPresenceManager(() => new Date('2026-07-22T12:00:00.000Z'));
  const manager = new SessionRequestManager(professors, students, {
    idFactory: () => 'request-id',
    timeoutMs: 30_000,
  });
  const activeSessions = new SessionManager(professors, students, {
    clock: () => new Date('2026-07-23T12:00:00.000Z'),
    idFactory: () => 'session-id',
  });
  professors.registerProfessor({ name: 'Carlos', socketId: 'teacher-socket' });
  students.registerStudent({ id: 'student-id', name: 'Ana', socketId: 'student-socket' });
  manager.createRequest('student-socket', 'teacher-id');

  const server = createServer(
    createApp(professors, students, manager, activeSessions, new TestAuthService()),
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const address = server.address();
    assert(address !== null && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const authenticatedFetch = (path: string) =>
      fetch(`${baseUrl}${path}`, { headers: AUTHORIZATION_HEADERS });
    const pending = (await (await authenticatedFetch('/api/sessions/pending')).json()) as unknown[];
    assert.equal(pending.length, 1);
    assert.equal((pending[0] as { status: string }).status, 'pending');

    const acceptedRequest = manager.acceptRequest('request-id', 'teacher-socket');
    activeSessions.createSession(acceptedRequest.request);

    assert.deepEqual(await (await authenticatedFetch('/api/sessions/pending')).json(), []);
    const history = (await (await authenticatedFetch('/api/sessions/history')).json()) as unknown[];
    assert.equal(history.length, 1);
    assert.equal((history[0] as { status: string }).status, 'IN_PROGRESS');

    assert.deepEqual(await (await authenticatedFetch('/api/sessions/active')).json(), [
      {
        sessionId: 'session-id',
        teacherName: 'Carlos',
        studentName: 'Ana',
        createdAt: '2026-07-23T12:00:00.000Z',
        status: 'active',
      },
    ]);
    const details = (await (await authenticatedFetch('/api/sessions/session-id')).json()) as Record<
      string,
      unknown
    >;
    assert.equal(details.requestId, 'request-id');
    assert.equal(details.teacherId, 'teacher-id');
    assert.equal(details.studentId, 'student-id');

    activeSessions.endSession('session-id', 'student-socket');
    assert.deepEqual(await (await authenticatedFetch('/api/sessions/active')).json(), []);
    const finishedDetails = (await (
      await authenticatedFetch('/api/sessions/session-id')
    ).json()) as Record<string, unknown>;
    assert.equal(finishedDetails.status, 'finished');
    const completedHistory = (await (
      await authenticatedFetch('/api/sessions/history')
    ).json()) as Array<{ status: string; durationSeconds: number }>;
    assert.equal(completedHistory[0]?.status, 'FINALIZED');
    assert.equal(completedHistory[0]?.durationSeconds, 0);
  } finally {
    manager.close();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error === undefined ? resolve() : reject(error)));
    });
  }
});

test('fila expõe somente a posição do aluno e a fila do professor autenticado', async () => {
  const professors = new PresenceManager(undefined, () => 'teacher-id');
  const students = new StudentPresenceManager();
  professors.registerProfessor({ id: 'teacher-id', name: 'Carlos', socketId: 'teacher-socket' });
  students.registerStudent({ id: 'student-a', name: 'Ana', socketId: 'student-a-socket' });
  students.registerStudent({ id: 'student-b', name: 'Bia', socketId: 'student-b-socket' });
  let sequence = 0;
  const manager = new SessionRequestManager(professors, students, {
    idFactory: () => `request-${++sequence}`,
    timeoutMs: 30_000,
  });
  manager.createRequest('student-a-socket', 'teacher-id');
  manager.createRequest('student-b-socket', 'teacher-id');
  const auth = new MutableIdentityAuthService({
    ...TEST_IDENTITY,
    roles: ['STUDENT'],
    profileId: 'student-b',
  });
  const server = createServer(
    createApp(professors, students, manager, new SessionManager(professors, students), auth),
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const address = server.address();
    assert(address !== null && typeof address === 'object');
    const url = `http://127.0.0.1:${address.port}/api/sessions/queue`;
    const studentPayload = (await (
      await fetch(url, { headers: AUTHORIZATION_HEADERS })
    ).json()) as Record<string, unknown>;
    assert.equal(JSON.stringify(studentPayload).includes('Ana'), false);
    const ownRequest = studentPayload.request as Record<string, unknown>;
    assert.equal(ownRequest.requestId, 'request-2');
    assert.deepEqual(ownRequest.teacher, { id: 'teacher-id', name: 'Carlos' });
    assert.equal(ownRequest.status, 'WAITING');
    assert.equal(ownRequest.position, 2);
    assert.equal(ownRequest.studentsAhead, 1);
    assert.equal(ownRequest.totalWaiting, 2);
    assert.equal(ownRequest.estimatedWaitMinutes, 6);
    assert.equal(ownRequest.teacherOnline, true);
    assert.equal(ownRequest.nextExpected, 'AUTOMATIC_CALL');
    assert.equal(typeof ownRequest.waitingSeconds, 'number');

    auth.identity = { ...TEST_IDENTITY, roles: ['TEACHER'], profileId: 'teacher-id' };
    const teacherPayload = (await (
      await fetch(url, { headers: AUTHORIZATION_HEADERS })
    ).json()) as { totalWaiting: number; requests: readonly unknown[] };
    assert.equal(teacherPayload.totalWaiting, 2);
    assert.equal(teacherPayload.requests.length, 2);

    auth.identity = { ...TEST_IDENTITY, roles: ['TEACHER'], profileId: 'other-teacher' };
    assert.deepEqual(
      await (await fetch(`${url}?teacherId=teacher-id`, { headers: AUTHORIZATION_HEADERS })).json(),
      { totalWaiting: 0, requests: [] },
    );
  } finally {
    manager.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error === undefined ? resolve() : reject(error))),
    );
  }
});

class MutableIdentityAuthService extends TestAuthService {
  public constructor(public identity: AuthenticatedIdentity) {
    super();
  }

  public override verifyAccessToken(): Promise<AuthenticatedIdentity> {
    return Promise.resolve(this.identity);
  }
}
