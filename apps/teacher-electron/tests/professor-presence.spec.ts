import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { Server as SocketServer } from 'socket.io';
import type {
  RemoteControlApproved,
  RemoteControlDenied,
  RemoteControlKeyboardPayload,
  RemoteControlMousePayload,
  RemoteControlRequest,
  RemoteControlStopPayload,
} from '@professor-connect/protocol';

import { ProfessorPresenceController } from '../main/professor-presence.controller.js';
import { ProfessorPresenceStatus } from '../shared/presence-contracts.js';
import type {
  ScreenSharePayload,
  WebRtcDescriptionPayload,
  WebRtcIceCandidatePayload,
} from '../shared/webrtc-contracts.js';

interface PresenceEvents {
  'professor:heartbeat': () => void;
  'professor:online': (payload: { readonly name: string }) => void;
  'students:presence:get': () => void;
  'session:accept': (payload: { readonly requestId: string }) => void;
  'session:reject': (payload: { readonly requestId: string }) => void;
  'session:end': (payload: { readonly sessionId: string }) => void;
  'webrtc:offer': (payload: WebRtcDescriptionPayload) => void;
  'webrtc:answer': (payload: WebRtcDescriptionPayload) => void;
  'webrtc:ice-candidate': (payload: WebRtcIceCandidatePayload) => void;
  'remote-control:request': (payload: RemoteControlRequest) => void;
  'remote-control:mouse': (payload: RemoteControlMousePayload) => void;
  'remote-control:keyboard': (payload: RemoteControlKeyboardPayload) => void;
  'remote-control:stop': (payload: RemoteControlStopPayload) => void;
}

interface SessionEvents {
  'students:presence:changed': (
    payload: readonly [
      {
        readonly id: string;
        readonly name: string;
        readonly connectionStatus: 'online';
        readonly attendanceStatus: 'available';
        readonly onlineSince: string;
        readonly lastHeartbeat: string;
      },
    ],
  ) => void;
  'session:requested': (payload: {
    readonly requestId: string;
    readonly studentId: string;
    readonly studentName: string;
  }) => void;
  'session:timeout': (payload: { readonly requestId: string }) => void;
  'session:started': (payload: SessionLifecyclePayload) => void;
  'session:ended': (payload: SessionLifecyclePayload) => void;
  'webrtc:answer': (payload: WebRtcDescriptionPayload) => void;
  'webrtc:offer': (payload: WebRtcDescriptionPayload) => void;
  'webrtc:ice-candidate': (payload: WebRtcIceCandidatePayload) => void;
  'screen-share:start': (payload: ScreenSharePayload) => void;
  'screen-share:stop': (payload: ScreenSharePayload) => void;
  'remote-control:approved': (payload: RemoteControlApproved) => void;
  'remote-control:denied': (payload: RemoteControlDenied) => void;
  'remote-control:stop': (payload: RemoteControlStopPayload) => void;
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
  const sentAnswers: WebRtcDescriptionPayload[] = [];
  const renegotiationOffers: WebRtcDescriptionPayload[] = [];
  const remoteCandidates: WebRtcIceCandidatePayload[] = [];
  const screenShareStarts: ScreenSharePayload[] = [];
  const screenShareStops: ScreenSharePayload[] = [];
  const remoteControlRequests: RemoteControlRequest[] = [];
  const remoteControlMouseEvents: RemoteControlMousePayload[] = [];
  const remoteControlKeyboardEvents: RemoteControlKeyboardPayload[] = [];
  const remoteControlStops: RemoteControlStopPayload[] = [];

  socketServer.on('connection', (socket) => {
    socket.on('professor:online', ({ name }) => {
      receivedNames.push(name);
      socket.emit('students:presence:changed', [
        {
          id: 'student-id',
          name: 'Ana',
          connectionStatus: 'online',
          attendanceStatus: 'available',
          onlineSince: '2026-08-10T10:00:00.000Z',
          lastHeartbeat: '2026-08-10T10:00:00.000Z',
        },
      ]);
      socket.emit('session:requested', {
        requestId: 'request-1',
        studentId: 'student-id',
        studentName: 'Ana',
      });
    });
    socket.on('session:accept', ({ requestId }) => {
      acceptedRequestIds.push(requestId);
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
    socket.on('webrtc:answer', (payload) => sentAnswers.push(payload));
    socket.on('webrtc:ice-candidate', (payload) => localCandidates.push(payload));
    socket.on('remote-control:request', (payload) => remoteControlRequests.push(payload));
    socket.on('remote-control:mouse', (payload) => remoteControlMouseEvents.push(payload));
    socket.on('remote-control:keyboard', (payload) => remoteControlKeyboardEvents.push(payload));
    socket.on('remote-control:stop', (payload) => remoteControlStops.push(payload));
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
  const controller = new ProfessorPresenceController(configPath, 1_000);
  controller.onWebRtcAnswer((payload) => answers.push(payload));
  controller.onWebRtcOffer((payload) => renegotiationOffers.push(payload));
  controller.onWebRtcIceCandidate((payload) => remoteCandidates.push(payload));
  controller.onScreenShareStarted((payload) => screenShareStarts.push(payload));
  controller.onScreenShareStopped((payload) => screenShareStops.push(payload));

  try {
    const initialSnapshot = await controller.connect('  Carlos  ');
    assert.equal(initialSnapshot.status, ProfessorPresenceStatus.CONNECTING);

    await waitUntil(
      () =>
        controller.getSnapshot().status === ProfessorPresenceStatus.CONNECTED &&
        receivedNames[0] === 'Carlos',
    );
    assert.equal(controller.getSnapshot().serverConnected, true);
    await waitUntil(() => controller.getSnapshot().onlineStudents.length === 1);
    assert.equal(controller.getSnapshot().onlineStudents[0]?.attendanceStatus, 'available');
    await waitUntil(() => controller.getSnapshot().sessionRequests.length === 1);
    assert.equal(controller.getSnapshot().sessionRequests[0]?.studentName, 'Ana');
    controller.acceptSession('request-1');
    await waitUntil(() => acceptedRequestIds.length === 1);
    assert.equal(controller.getSnapshot().sessionRequests.length, 1);
    assert.equal(controller.getSnapshot().activeSession, undefined);
    socketServer.emit('session:started', {
      sessionId: 'session-id',
      teacherId: 'teacher-id',
      teacherName: 'Carlos',
      studentId: 'student-id',
      studentName: 'Ana',
    });
    await waitUntil(() => controller.getSnapshot().activeSession !== undefined);
    assert.deepEqual(controller.getSnapshot().sessionRequests, []);
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
    socketServer.emit('screen-share:start', {
      sessionId: 'session-id',
      streamId: 'screen-stream',
      trackId: 'screen-track',
    });
    socketServer.emit('webrtc:offer', {
      sessionId: 'session-id',
      description: { type: 'offer', sdp: 'renegotiation-offer-sdp' },
    });
    controller.sendWebRtcAnswer({
      sessionId: 'session-id',
      description: { type: 'answer', sdp: 'renegotiation-answer-sdp' },
    });
    socketServer.emit('screen-share:stop', { sessionId: 'session-id' });
    await waitUntil(
      () =>
        offers.length === 1 &&
        localCandidates.length === 1 &&
        answers.length === 1 &&
        remoteCandidates.length === 1 &&
        sentAnswers.length === 1 &&
        renegotiationOffers.length === 1 &&
        screenShareStarts.length === 1 &&
        screenShareStops.length === 1,
    );
    assert.equal(screenShareStarts[0]?.streamId, 'screen-stream');
    const requestedControl = controller.requestRemoteControl().remoteControl;
    assert.equal(requestedControl.status, 'pending');
    await waitUntil(() => remoteControlRequests.length === 1);
    const remoteReference = remoteControlRequests[0];
    assert(remoteReference !== undefined);
    socketServer.emit('remote-control:approved', remoteReference);
    await waitUntil(() => controller.getSnapshot().remoteControl.status === 'active');
    controller.sendRemoteControlMouse({
      type: 'mousemove',
      x: 0.5,
      y: 0.5,
      button: 0,
      buttons: 0,
    });
    controller.sendRemoteControlKeyboard({
      type: 'keydown',
      key: 'a',
      code: 'KeyA',
      repeat: false,
      altKey: false,
      ctrlKey: false,
      shiftKey: false,
      metaKey: false,
    });
    await waitUntil(
      () => remoteControlMouseEvents.length === 1 && remoteControlKeyboardEvents.length === 1,
    );
    assert.equal(remoteControlMouseEvents[0]?.requestId, remoteReference.requestId);
    assert.equal(remoteControlKeyboardEvents[0]?.event.type, 'keydown');

    const engine = requireControllerEngine(controller);
    const bufferedPacketsBeforeCongestion = engine.writeBuffer.length;
    engine.transport.writable = false;
    for (let index = 0; index < 1_000; index += 1) {
      controller.sendRemoteControlMouse({
        type: 'mousemove',
        x: (index % 100) / 99,
        y: ((index * 7) % 100) / 99,
        button: 0,
        buttons: 0,
      });
    }
    assert.equal(
      engine.writeBuffer.length,
      bufferedPacketsBeforeCongestion,
      'mousemove congestionado não deve ocupar a fila confiável do Engine.IO',
    );
    engine.transport.writable = true;

    controller.stopRemoteControl();
    await waitUntil(() => remoteControlStops.length === 1);
    assert.equal(controller.getSnapshot().remoteControl.status, 'inactive');

    controller.requestRemoteControl();
    await waitUntil(() => remoteControlRequests.length === 2);
    const deniedReference = remoteControlRequests[1];
    assert(deniedReference !== undefined);
    socketServer.emit('remote-control:denied', deniedReference);
    await waitUntil(() =>
      controller
        .getSnapshot()
        .remoteControl.logs.some(({ message }) => message === 'Solicitação negada'),
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

    socketServer.emit('session:requested', {
      requestId: 'request-3',
      studentId: 'student-id',
      studentName: 'Ana',
    });
    await waitUntil(() => controller.getSnapshot().sessionRequests.length === 1);
    socketServer.emit('session:timeout', { requestId: 'request-3' });
    await waitUntil(() => controller.getSnapshot().sessionRequests.length === 0);
    assert.equal(
      controller.getSnapshot().sessionNotice,
      'A solicitação expirou. Peça ao aluno para enviar novamente.',
    );

    socketServer.emit('session:requested', {
      requestId: 'request-4',
      studentId: 'student-id',
      studentName: 'Ana',
    });
    await waitUntil(() => controller.getSnapshot().sessionRequests.length === 1);
    socketServer.emit('session:timeout', { requestId: 'request-4' });
    await waitUntil(() => controller.getSnapshot().sessionRequests.length === 0);
    assert.equal(
      controller.getSnapshot().sessionNotice,
      'A solicitação expirou. Peça ao aluno para enviar novamente.',
    );

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

interface InspectableEngine {
  readonly writeBuffer: unknown[];
  readonly transport: {
    writable: boolean;
  };
}

function requireControllerEngine(controller: ProfessorPresenceController): InspectableEngine {
  const inspectable = controller as unknown as {
    readonly socket?: {
      readonly io: {
        readonly engine: InspectableEngine;
      };
    };
  };
  const engine = inspectable.socket?.io.engine;
  assert(engine !== undefined);
  return engine;
}
