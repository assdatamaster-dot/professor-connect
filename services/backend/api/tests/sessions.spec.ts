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

  const server = createServer(createApp(professors, students, manager, activeSessions));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const address = server.address();
    assert(address !== null && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const pending = (await (await fetch(`${baseUrl}/api/sessions/pending`)).json()) as unknown[];
    assert.equal(pending.length, 1);
    assert.equal((pending[0] as { status: string }).status, 'pending');

    const acceptedRequest = manager.acceptRequest('request-id', 'teacher-socket');
    activeSessions.createSession(acceptedRequest.request);

    assert.deepEqual(await (await fetch(`${baseUrl}/api/sessions/pending`)).json(), []);
    const history = (await (await fetch(`${baseUrl}/api/sessions/history`)).json()) as unknown[];
    assert.equal(history.length, 1);
    assert.equal((history[0] as { status: string }).status, 'accepted');

    assert.deepEqual(await (await fetch(`${baseUrl}/api/sessions/active`)).json(), [
      {
        sessionId: 'session-id',
        teacherName: 'Carlos',
        studentName: 'Ana',
        createdAt: '2026-07-23T12:00:00.000Z',
        status: 'active',
      },
    ]);
    const details = (await (await fetch(`${baseUrl}/api/sessions/session-id`)).json()) as Record<
      string,
      unknown
    >;
    assert.equal(details.requestId, 'request-id');
    assert.equal(details.teacherId, 'teacher-id');
    assert.equal(details.studentId, 'student-id');

    activeSessions.endSession('session-id', 'student-socket');
    assert.deepEqual(await (await fetch(`${baseUrl}/api/sessions/active`)).json(), []);
    const finishedDetails = (await (
      await fetch(`${baseUrl}/api/sessions/session-id`)
    ).json()) as Record<string, unknown>;
    assert.equal(finishedDetails.status, 'finished');
  } finally {
    manager.close();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error === undefined ? resolve() : reject(error)));
    });
  }
});
