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

import { StudentPresenceController } from '../main/student-presence.controller.js';
import { RemoteControlReceiver } from '../main/remote-control.receiver.js';
import type {
  WebRtcDescriptionPayload,
  WebRtcIceCandidatePayload,
  ScreenSharePayload,
} from '../shared/webrtc-contracts.js';

interface PresenceEvents {
  'student:disconnect': (acknowledge: () => void) => void;
  'student:heartbeat': () => void;
  'student:register': (payload: { readonly id: string; readonly name: string }) => void;
  'request:session': (payload: { readonly teacherId: string }) => void;
  'session:end': (payload: { readonly sessionId: string }) => void;
  'webrtc:answer': (payload: WebRtcDescriptionPayload) => void;
  'webrtc:offer': (payload: WebRtcDescriptionPayload) => void;
  'webrtc:ice-candidate': (payload: WebRtcIceCandidatePayload) => void;
  'screen-share:start': (payload: ScreenSharePayload) => void;
  'screen-share:stop': (payload: ScreenSharePayload) => void;
  'remote-control:approved': (payload: RemoteControlApproved) => void;
  'remote-control:denied': (payload: RemoteControlDenied) => void;
  'remote-control:stop': (payload: RemoteControlStopPayload) => void;
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
  'webrtc:offer': (payload: WebRtcDescriptionPayload) => void;
  'webrtc:answer': (payload: WebRtcDescriptionPayload) => void;
  'webrtc:ice-candidate': (payload: WebRtcIceCandidatePayload) => void;
  'remote-control:request': (payload: RemoteControlRequest) => void;
  'remote-control:mouse': (payload: RemoteControlMousePayload) => void;
  'remote-control:keyboard': (payload: RemoteControlKeyboardPayload) => void;
  'remote-control:stop': (payload: RemoteControlStopPayload) => void;
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
  const answers: WebRtcDescriptionPayload[] = [];
  const localCandidates: WebRtcIceCandidatePayload[] = [];
  const offers: WebRtcDescriptionPayload[] = [];
  const renegotiationOffers: WebRtcDescriptionPayload[] = [];
  const renegotiationAnswers: WebRtcDescriptionPayload[] = [];
  const remoteCandidates: WebRtcIceCandidatePayload[] = [];
  const screenShareStarts: ScreenSharePayload[] = [];
  const screenShareStops: ScreenSharePayload[] = [];
  const remoteControlApprovals: RemoteControlApproved[] = [];
  const remoteControlDenials: RemoteControlDenied[] = [];
  const remoteControlStops: RemoteControlStopPayload[] = [];

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
      socket.emit('webrtc:offer', {
        sessionId: 'session-id',
        description: { type: 'offer', sdp: 'offer-sdp' },
      });
    });
    socket.on('webrtc:answer', (payload) => answers.push(payload));
    socket.on('webrtc:offer', (payload) => {
      renegotiationOffers.push(payload);
      socket.emit('webrtc:answer', {
        sessionId: payload.sessionId,
        description: { type: 'answer', sdp: 'renegotiation-answer-sdp' },
      });
    });
    socket.on('webrtc:ice-candidate', (payload) => localCandidates.push(payload));
    socket.on('screen-share:start', (payload) => screenShareStarts.push(payload));
    socket.on('screen-share:stop', (payload) => screenShareStops.push(payload));
    socket.on('remote-control:approved', (payload) => remoteControlApprovals.push(payload));
    socket.on('remote-control:denied', (payload) => remoteControlDenials.push(payload));
    socket.on('remote-control:stop', (payload) => remoteControlStops.push(payload));
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
    new RemoteControlReceiver({
      mouseController: {
        start(): void {
          return;
        },
        receive(event) {
          if (event.type === 'mousemove') {
            return 'MouseMove';
          }
          if (event.type === 'wheel') {
            return 'Wheel';
          }
          if (event.type === 'dblclick') {
            return 'DoubleClick';
          }
          return event.type === 'mouseup'
            ? event.button === 2
              ? 'ClickRight'
              : 'ClickLeft'
            : undefined;
        },
        stop(): void {
          return;
        },
        isActive(): boolean {
          return true;
        },
      },
    }),
  );
  controller.onWebRtcOffer((payload) => offers.push(payload));
  controller.onWebRtcIceCandidate((payload) => remoteCandidates.push(payload));
  controller.onWebRtcAnswer((payload) => renegotiationAnswers.push(payload));

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
    await waitUntil(() => offers.length === 1);
    assert.equal(offers[0]?.description.sdp, 'offer-sdp');

    controller.sendWebRtcAnswer({
      sessionId: 'session-id',
      description: { type: 'answer', sdp: 'answer-sdp' },
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
    controller.sendScreenShareStart({
      sessionId: 'session-id',
      streamId: 'screen-stream',
      trackId: 'screen-track',
    });
    controller.sendWebRtcOffer({
      sessionId: 'session-id',
      description: { type: 'offer', sdp: 'renegotiation-offer-sdp' },
    });
    controller.sendScreenShareStop({ sessionId: 'session-id' });
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
        answers.length === 1 &&
        localCandidates.length === 1 &&
        remoteCandidates.length === 1 &&
        renegotiationOffers.length === 1 &&
        renegotiationAnswers.length === 1 &&
        screenShareStarts.length === 1 &&
        screenShareStops.length === 1,
    );
    assert.equal(renegotiationAnswers[0]?.description.sdp, 'renegotiation-answer-sdp');
    assert.equal(screenShareStarts[0]?.trackId, 'screen-track');

    const remoteReference = { sessionId: 'session-id', requestId: 'remote-request-1' };
    socketServer.emit('remote-control:request', remoteReference);
    await waitUntil(() => controller.getSessionSnapshot().remoteControl.status === 'pending');
    controller.approveRemoteControl();
    await waitUntil(() => remoteControlApprovals.length === 1);
    assert.equal(controller.getSessionSnapshot().remoteControl.status, 'active');
    socketServer.emit('remote-control:mouse', {
      ...remoteReference,
      event: { type: 'mousemove', x: 0.5, y: 0.5, button: 0, buttons: 0 },
    });
    socketServer.emit('remote-control:keyboard', {
      ...remoteReference,
      event: {
        type: 'keyup',
        key: 'a',
        code: 'KeyA',
        repeat: false,
        altKey: false,
        ctrlKey: false,
        shiftKey: false,
        metaKey: false,
      },
    });
    await waitUntil(() => {
      const messages = controller
        .getSessionSnapshot()
        .remoteControl.logs.map(({ message }) => message);
      return (
        messages.includes('Evento recebido: MouseMove') &&
        messages.includes('Evento recebido: KeyUp (somente log, não executado)')
      );
    });
    controller.stopRemoteControl();
    await waitUntil(() => remoteControlStops.length === 1);
    assert.equal(controller.getSessionSnapshot().remoteControl.status, 'inactive');

    const deniedReference = { sessionId: 'session-id', requestId: 'remote-request-2' };
    socketServer.emit('remote-control:request', deniedReference);
    await waitUntil(() => controller.getSessionSnapshot().remoteControl.status === 'pending');
    controller.denyRemoteControl();
    await waitUntil(() => remoteControlDenials.length === 1);
    assert.equal(controller.getSessionSnapshot().remoteControl.status, 'inactive');

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
