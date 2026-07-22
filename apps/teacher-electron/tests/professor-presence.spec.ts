import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { Server as SocketServer } from 'socket.io';

import { ProfessorPresenceController } from '../main/professor-presence.controller.js';
import { ProfessorPresenceStatus } from '../shared/presence-contracts.js';
import type {
  WebRtcDescriptionPayload,
  WebRtcIceCandidatePayload,
} from '../shared/webrtc-contracts.js';

interface PresenceEvents {
  'professor:heartbeat': () => void;
  'professor:online': (payload: { readonly name: string }) => void;
  'session:accept': (payload: { readonly requestId: string }) => void;
  'session:reject': (payload: { readonly requestId: string }) => void;
  'session:end': (payload: { readonly sessionId: string }) => void;
  'webrtc:offer': (payload: WebRtcDescriptionPayload) => void;
  'webrtc:ice-candidate': (payload: WebRtcIceCandidatePayload) => void;
}

interface SessionEvents {
  'session:requested': (payload: {
    readonly requestId: string;
    readonly studentId: string;
    readonly studentName: string;
  }) => void;
  'session:started': (payload: SessionLifecyclePayload) => void;
  'session:ended': (payload: SessionLifecyclePayload) => void;
  'webrtc:answer': (payload: WebRtcDescriptionPayload) => void;
  'webrtc:ice-candidate': (payload: WebRtcIceCandidatePayload) => void;
}

interface SessionLifecyclePayload {
  readonly sessionId: string;
  readonly teacherId: string;
  readonly teacherName: string;
  readonly studentId: string;
  readonly studentName: string;
}

test('lê config.json, registra o professor e desconecta pelo Socket.IO', async () => {
  const httpServer = createServer();
  const socketServer = new SocketServer<PresenceEvents, SessionEvents>(httpServer, {
    serveClient: false,
  });
  const receivedNames: string[] = [];
  let disconnectCount = 0;
  const acceptedRequestIds: string[] = [];
  const rejectedRequestIds: string[] = [];
  const endedSessionIds: string[] = [];
  const offers: WebRtcDescriptionPayload[] = [];
  const localCandidates: WebRtcIceCandidatePayload[] = [];
  const answers: WebRtcDescriptionPayload[] = [];
  const remoteCandidates: WebRtcIceCandidatePayload[] = [];

  socketServer.on('connection', (socket) => {
    socket.on('professor:online', ({ name }) => {
      receivedNames.push(name);
      socket.emit('session:requested', {
        requestId: 'request-1',
        studentId: 'student-id',
        studentName: 'Ana',
      });
    });
    socket.on('session:accept', ({ requestId }) => {
      acceptedRequestIds.push(requestId);
      socket.emit('session:started', {
        sessionId: 'session-id',
        teacherId: 'teacher-id',
        teacherName: 'Carlos',
        studentId: 'student-id',
        studentName: 'Ana',
      });
    });
    socket.on('session:reject', ({ requestId }) => rejectedRequestIds.push(requestId));
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
    socket.on('webrtc:offer', (payload) => offers.push(payload));
    socket.on('webrtc:ice-candidate', (payload) => localCandidates.push(payload));
    socket.on('disconnect', () => {
      disconnectCount += 1;
    });
  });
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));

  const address = httpServer.address();
  assert(address !== null && typeof address === 'object');
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'professor-connect-'));
  const configPath = path.join(temporaryDirectory, 'config.json');
  await writeFile(
    configPath,
    JSON.stringify({ serverUrl: `http://127.0.0.1:${address.port}` }),
    'utf8',
  );
  const controller = new ProfessorPresenceController(configPath);
  controller.onWebRtcAnswer((payload) => answers.push(payload));
  controller.onWebRtcIceCandidate((payload) => remoteCandidates.push(payload));

  try {
    const initialSnapshot = await controller.connect('  Carlos  ');
    assert.equal(initialSnapshot.status, ProfessorPresenceStatus.CONNECTING);

    await waitUntil(
      () =>
        controller.getSnapshot().status === ProfessorPresenceStatus.CONNECTED &&
        receivedNames[0] === 'Carlos',
    );
    assert.equal(controller.getSnapshot().serverConnected, true);
    await waitUntil(() => controller.getSnapshot().sessionRequests.length === 1);
    assert.equal(controller.getSnapshot().sessionRequests[0]?.studentName, 'Ana');
    controller.acceptSession('request-1');
    await waitUntil(() => acceptedRequestIds.length === 1);
    assert.deepEqual(controller.getSnapshot().sessionRequests, []);
    await waitUntil(() => controller.getSnapshot().activeSession !== undefined);
    assert.equal(controller.getSnapshot().activeSession?.studentName, 'Ana');
    controller.sendWebRtcOffer({
      sessionId: 'session-id',
      description: { type: 'offer', sdp: 'offer-sdp' },
    });
    controller.sendWebRtcIceCandidate({
      sessionId: 'session-id',
      candidate: {
        candidate: 'candidate-value',
        sdpMid: '0',
        sdpMLineIndex: 0,
        usernameFragment: null,
      },
    });
    socketServer.emit('webrtc:answer', {
      sessionId: 'session-id',
      description: { type: 'answer', sdp: 'answer-sdp' },
    });
    socketServer.emit('webrtc:ice-candidate', {
      sessionId: 'session-id',
      candidate: {
        candidate: 'remote-candidate',
        sdpMid: '0',
        sdpMLineIndex: 0,
        usernameFragment: null,
      },
    });
    await waitUntil(
      () =>
        offers.length === 1 &&
        localCandidates.length === 1 &&
        answers.length === 1 &&
        remoteCandidates.length === 1,
    );
    controller.endSession();
    await waitUntil(() => controller.getSnapshot().activeSession === undefined);
    assert.deepEqual(endedSessionIds, ['session-id']);

    socketServer.emit('session:requested', {
      requestId: 'request-2',
      studentId: 'student-id',
      studentName: 'Ana',
    });
    await waitUntil(() => controller.getSnapshot().sessionRequests.length === 1);
    controller.rejectSession('request-2');
    await waitUntil(() => rejectedRequestIds.length === 1);

    const disconnectedSnapshot = controller.disconnect();
    await waitUntil(() => disconnectCount === 1);
    assert.equal(disconnectedSnapshot.status, ProfessorPresenceStatus.DISCONNECTED);
    assert.equal(disconnectedSnapshot.professorName, undefined);
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
