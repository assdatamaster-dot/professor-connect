import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  EventType,
  ScreenShareFailureCode,
  WebRtcNegotiationState,
  type ScreenShareFailedPayload,
  type SocketMessage,
} from '@professor-connect/protocol';

import { MediaManager } from '../src/client/core/rtc/media-manager.js';
import { RtcEngine } from '../src/client/core/rtc/rtc-engine.js';
import { ScreenSharingManager } from '../src/client/core/rtc/screen-sharing.manager.js';
import { ScreenSharingService } from '../src/client/core/rtc/screen-sharing.service.js';
import {
  ScreenSharingState,
  type ScreenCaptureDevicesPort,
  type ScreenSharingSignalingPort,
} from '../src/client/core/rtc/screen-sharing.types.js';
import type {
  RtcConnection,
  RtcMediaDevice,
  RtcMediaDevicesPort,
  RtcMediaRendererPort,
  RtcPeerManagerPort,
  RtcVideoTrackControllerPort,
} from '../src/client/core/rtc/rtc-types.js';
import type {
  MediaKind,
  MediaStreamPort,
  MediaTrackPort,
  WebRtcLogger,
} from '../src/modules/webrtc/webrtc.types.js';

const CALL_ID = 'call-screen-share';
const SESSION_ID = 'session-screen-share';
const WAIT_TIMEOUT_MS = 2_000;

interface EngineHolder {
  engine?: RtcEngine;
}

interface ScreenSharingFixture {
  readonly engine: RtcEngine;
  readonly manager: ScreenSharingManager;
  readonly screenTrack: TestTrack;
  readonly cameraStream: TestStream;
  readonly localRenderer: TestRenderer;
  readonly remoteRenderer: TestRenderer;
  readonly trackController: TestTrackController;
}

test('professor solicita, aluno aceita, compartilha e encerra com retorno à câmera', async () => {
  const logs: string[] = [];
  const errors: unknown[] = [];
  const messages: SocketMessage<unknown>[] = [];
  const logger = createLogger(logs, errors);
  const professorHolder: EngineHolder = {};
  const studentHolder: EngineHolder = {};
  const professor = await createFixture(createScreenRelay(studentHolder, messages), logger);
  const student = await createFixture(
    createScreenRelay(professorHolder, messages),
    logger,
    professor.remoteRenderer,
  );

  professorHolder.engine = professor.engine;
  studentHolder.engine = student.engine;

  await professor.engine.requestScreenShare();
  assert.equal(professor.engine.getScreenSharingState(), ScreenSharingState.REQUESTED);
  assert.equal(student.engine.getScreenSharingState(), ScreenSharingState.REQUESTED);

  await student.engine.acceptScreenShare();

  assert.equal(professor.engine.getScreenSharingState(), ScreenSharingState.SHARING);
  assert.equal(student.engine.getScreenSharingState(), ScreenSharingState.SHARING);
  assert.equal(student.trackController.currentTrack, student.screenTrack);
  assert.equal(student.localRenderer.currentStream?.source, 'screen-stream');
  assert.equal(professor.remoteRenderer.currentStream?.source, 'screen-stream');
  assert.deepEqual(statesOf(student.manager), [
    ScreenSharingState.REQUESTED,
    ScreenSharingState.STARTING,
    ScreenSharingState.SHARING,
  ]);

  student.screenTrack.endByUser();
  await waitUntil(
    () =>
      professor.engine.getScreenSharingState() === ScreenSharingState.STOPPED &&
      student.engine.getScreenSharingState() === ScreenSharingState.STOPPED,
  );

  assert.equal(student.trackController.currentTrack.kind, 'video');
  assert.equal(student.trackController.currentTrack.source, 'camera-video');
  assert.equal(student.localRenderer.currentStream?.source, student.cameraStream.source);
  assert.equal(professor.remoteRenderer.currentStream?.source, student.cameraStream.source);
  assert.deepEqual(statesOf(student.manager), [
    ScreenSharingState.REQUESTED,
    ScreenSharingState.STARTING,
    ScreenSharingState.SHARING,
    ScreenSharingState.STOPPING,
    ScreenSharingState.STOPPED,
  ]);
  assert.deepEqual(
    messages.map((message) => message.event),
    [
      EventType.SCREEN_SHARE_REQUEST,
      EventType.SCREEN_SHARE_ACCEPT,
      EventType.SCREEN_SHARE_STARTED,
      EventType.SCREEN_SHARE_STOPPED,
    ],
  );
  assert(messages.every(hasValidEnvelope));
  assert.equal(countMessage(logs, 'Solicitação enviada'), 1);
  assert.equal(countMessage(logs, 'Solicitação aceita'), 2);
  assert.equal(countMessage(logs, 'Captura iniciada'), 1);
  assert.equal(countMessage(logs, 'Captura encerrada'), 1);
  assert.equal(countMessage(logs, 'Troca de track'), 2);
  assert.equal(errors.length, 0);
});

test('propaga falha de captura e mantém a câmera', async () => {
  const logs: string[] = [];
  const errors: unknown[] = [];
  const messages: SocketMessage<unknown>[] = [];
  const logger = createLogger(logs, errors);
  const professorHolder: EngineHolder = {};
  const studentHolder: EngineHolder = {};
  const professor = await createFixture(createScreenRelay(studentHolder, messages), logger);
  const captureError = new Error('display capture failed');
  const student = await createFixture(
    createScreenRelay(professorHolder, messages),
    logger,
    professor.remoteRenderer,
    captureError,
  );

  professorHolder.engine = professor.engine;
  studentHolder.engine = student.engine;

  await professor.engine.requestScreenShare();
  await assert.rejects(student.engine.acceptScreenShare(), captureError);
  await waitUntil(() => professor.engine.getScreenSharingState() === ScreenSharingState.FAILED);

  assert.equal(student.engine.getScreenSharingState(), ScreenSharingState.FAILED);
  assert.equal(student.trackController.currentTrack.source, 'camera-video');
  assert.deepEqual(
    messages.map((message) => message.event),
    [EventType.SCREEN_SHARE_REQUEST, EventType.SCREEN_SHARE_ACCEPT, EventType.SCREEN_SHARE_FAILED],
  );
  const failure = messages[2] as SocketMessage<ScreenShareFailedPayload> | undefined;

  assert.equal(failure?.payload.code, ScreenShareFailureCode.CAPTURE_FAILED);
  assert(countMessage(logs, 'Falhas') === 0);
  assert(errors.length >= 2);
});

test('aluno pode recusar a solicitação sem iniciar captura', async () => {
  const logs: string[] = [];
  const errors: unknown[] = [];
  const messages: SocketMessage<unknown>[] = [];
  const logger = createLogger(logs, errors);
  const professorHolder: EngineHolder = {};
  const studentHolder: EngineHolder = {};
  const professor = await createFixture(createScreenRelay(studentHolder, messages), logger);
  const student = await createFixture(createScreenRelay(professorHolder, messages), logger);

  professorHolder.engine = professor.engine;
  studentHolder.engine = student.engine;

  await professor.engine.requestScreenShare();
  await student.engine.denyScreenShare();

  assert.equal(professor.engine.getScreenSharingState(), ScreenSharingState.STOPPED);
  assert.equal(student.engine.getScreenSharingState(), ScreenSharingState.STOPPED);
  assert.equal(student.trackController.currentTrack.source, 'camera-video');
  assert.deepEqual(
    messages.map((message) => message.event),
    [EventType.SCREEN_SHARE_REQUEST, EventType.SCREEN_SHARE_DENY],
  );
  assert.equal(countMessage(logs, 'Solicitação recusada'), 2);
  assert.equal(errors.length, 0);
});

async function createFixture(
  signaling: ScreenSharingSignalingPort,
  logger: WebRtcLogger,
  remoteRenderer = new TestRenderer(),
  captureError?: Error,
): Promise<ScreenSharingFixture> {
  const cameraStream = createCameraStream();
  const mediaManager = new MediaManager(new TestMediaDevices(cameraStream), logger);
  const localRenderer = new TestRenderer();
  const screenTrack = new TestTrack('video', 'screen-video');
  const screenStream = new TestStream('screen-stream', [screenTrack]);
  const captureDevices = new TestScreenCaptureDevices(screenStream, captureError);
  const trackController = new TestTrackController(
    cameraStream.getVideoTracks()[0] as TestTrack,
    cameraStream,
    screenStream,
    remoteRenderer,
  );
  const peerManager = new TestPeerManager({ callId: CALL_ID, sessionId: SESSION_ID });
  const engine = new RtcEngine(
    peerManager,
    mediaManager,
    { local: localRenderer, remote: remoteRenderer },
    logger,
  );
  const manager = new ScreenSharingManager({
    captureDevices,
    trackController,
    mediaManager,
    localRenderer,
    logger,
  });
  const service = new ScreenSharingService(manager, signaling, { logger });

  await mediaManager.openAudioVideo();
  await mediaManager.renderLocal(localRenderer);
  engine.configureScreenSharing(service);
  return {
    engine,
    manager,
    screenTrack,
    cameraStream,
    localRenderer,
    remoteRenderer,
    trackController,
  };
}

function createScreenRelay(
  remoteHolder: EngineHolder,
  messages: SocketMessage<unknown>[],
): ScreenSharingSignalingPort {
  const remote = (): RtcEngine => {
    assert(remoteHolder.engine !== undefined);
    return remoteHolder.engine;
  };

  return {
    sendRequest(message): void {
      messages.push(message);
      remote().receiveScreenShareRequest(message);
    },
    sendAccept(message): void {
      messages.push(message);
      remote().receiveScreenShareAccept(message);
    },
    sendDeny(message): void {
      messages.push(message);
      remote().receiveScreenShareDeny(message);
    },
    sendStarted(message): void {
      messages.push(message);
      remote().receiveScreenShareStarted(message);
    },
    sendStopped(message): void {
      messages.push(message);
      remote().receiveScreenShareStopped(message);
    },
    sendFailed(message): void {
      messages.push(message);
      remote().receiveScreenShareFailed(message);
    },
  };
}

class TestTrack implements MediaTrackPort {
  private endedHandler: () => void = () => {};
  public stopped = false;

  public constructor(
    public readonly kind: MediaKind,
    public readonly source: string,
  ) {}

  public stop(): void {
    this.stopped = true;
  }

  public setEndedHandler(handler: () => void): void {
    this.endedHandler = handler;
  }

  public endByUser(): void {
    this.stopped = true;
    this.endedHandler();
  }
}

class TestStream implements MediaStreamPort {
  public constructor(
    public readonly source: string,
    private readonly tracks: readonly TestTrack[],
  ) {}

  public getTracks(): readonly MediaTrackPort[] {
    return this.tracks;
  }

  public getAudioTracks(): readonly MediaTrackPort[] {
    return this.tracks.filter((track) => track.kind === 'audio');
  }

  public getVideoTracks(): readonly MediaTrackPort[] {
    return this.tracks.filter((track) => track.kind === 'video');
  }
}

class TestMediaDevices implements RtcMediaDevicesPort {
  public constructor(private readonly cameraStream: TestStream) {}

  public async getUserMedia(): Promise<MediaStreamPort> {
    return this.cameraStream;
  }

  public async enumerateDevices(): Promise<readonly RtcMediaDevice[]> {
    return [];
  }
}

class TestScreenCaptureDevices implements ScreenCaptureDevicesPort {
  public constructor(
    private readonly screenStream: TestStream,
    private readonly error?: Error,
  ) {}

  public async getDisplayMedia(): Promise<MediaStreamPort> {
    if (this.error !== undefined) {
      throw this.error;
    }

    return this.screenStream;
  }
}

class TestRenderer implements RtcMediaRendererPort {
  public currentStream: MediaStreamPort | undefined;

  public attach(stream: MediaStreamPort): void {
    this.currentStream = stream;
  }

  public clear(): void {
    this.currentStream = undefined;
  }
}

class TestTrackController implements RtcVideoTrackControllerPort {
  public currentTrack: MediaTrackPort;

  public constructor(
    private readonly cameraTrack: MediaTrackPort,
    private readonly cameraStream: MediaStreamPort,
    private readonly screenStream: MediaStreamPort,
    private readonly remoteRenderer: RtcMediaRendererPort,
  ) {
    this.currentTrack = cameraTrack;
  }

  public async replaceVideoTrack(track: MediaTrackPort): Promise<void> {
    this.currentTrack = track;
    await this.remoteRenderer.attach(this.screenStream);
  }

  public async restoreCameraVideoTrack(): Promise<void> {
    this.currentTrack = this.cameraTrack;
    await this.remoteRenderer.attach(this.cameraStream);
  }
}

class TestPeerManager implements RtcPeerManagerPort {
  public constructor(private readonly connection: RtcConnection) {}

  public async connect(): Promise<void> {}
  public async receiveOffer(): Promise<void> {}
  public async receiveAnswer(): Promise<void> {}
  public async receiveIceCandidate(): Promise<void> {}
  public async replaceVideoTrack(): Promise<void> {}
  public async restoreCameraVideoTrack(): Promise<void> {}
  public async reconnect(): Promise<void> {}
  public async close(): Promise<void> {}

  public getConnection(): RtcConnection {
    return this.connection;
  }

  public getState(): WebRtcNegotiationState {
    return WebRtcNegotiationState.CONNECTED;
  }

  public onRemoteMedia(): () => void {
    return () => {};
  }

  public onStateChanged(): () => void {
    return () => {};
  }
}

function createCameraStream(): TestStream {
  return new TestStream('camera-stream', [
    new TestTrack('audio', 'microphone-audio'),
    new TestTrack('video', 'camera-video'),
  ]);
}

function statesOf(manager: ScreenSharingManager): readonly ScreenSharingState[] {
  return manager.getStateHistory().map((transition) => transition.nextState);
}

function hasValidEnvelope(message: SocketMessage<unknown>): boolean {
  return (
    message.id.trim().length > 0 &&
    !Number.isNaN(Date.parse(message.timestamp)) &&
    message.sessionId === SESSION_ID
  );
}

function createLogger(messages: string[], errors: unknown[]): WebRtcLogger {
  return {
    info(message): void {
      messages.push(message);
    },
    error(_message, error): void {
      errors.push(error);
    },
  };
}

function countMessage(messages: readonly string[], expected: string): number {
  return messages.filter((message) => message === expected).length;
}

async function waitUntil(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;

  while (!condition()) {
    if (Date.now() >= deadline) {
      throw new Error('Tempo limite excedido ao aguardar compartilhamento de tela');
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}
