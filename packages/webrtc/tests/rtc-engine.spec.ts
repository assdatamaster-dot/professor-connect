import assert from 'node:assert/strict';
import { test } from 'node:test';

import wrtc from '@roamhq/wrtc';

import {
  EventType,
  WebRtcNegotiationState,
  type SocketMessage,
} from '@professor-connect/shared-types';

import { MediaManager } from '../src/client/core/rtc/media-manager.js';
import { PeerManager } from '../src/client/core/rtc/peer-manager.js';
import { RtcEngine } from '../src/client/core/rtc/rtc-engine.js';
import { RtcEventType } from '../src/client/core/rtc/rtc-events.js';
import type {
  RtcEvent,
  RtcMediaDevice,
  RtcMediaDevicesPort,
  RtcMediaRendererPort,
} from '../src/client/core/rtc/rtc-types.js';
import { PeerConnectionFactory } from '../src/modules/webrtc/peer-connection.factory.js';
import type {
  IceCandidateHandler,
  MediaKind,
  MediaStreamPort,
  MediaTrackPort,
  PeerConnectionPort,
  PeerConnectionStateHandler,
  RemoteTrackHandler,
  WebRtcIceCandidate,
  WebRtcLogger,
  WebRtcSessionDescription,
  WebRtcSignalingPort,
} from '../src/modules/webrtc/webrtc.types.js';

const CALL_ID = 'call-rtc-engine';
const SESSION_ID = 'session-rtc-engine';
const CONNECTION_TIMEOUT_MS = 10_000;
const TEST_ICE_SETTINGS = {
  stunUrls: [],
  turn: { enabled: false, urls: [] },
} as const;

interface EngineHolder {
  engine?: RtcEngine;
}

interface EngineFixture {
  readonly engine: RtcEngine;
  readonly mediaDevices: TestMediaDevices;
  readonly localRenderer: TestRenderer;
  readonly remoteRenderer: TestRenderer;
  readonly events: RtcEvent[];
}

test('registra permissão negada sem criar stream', async () => {
  const errors: string[] = [];
  const logger: WebRtcLogger = {
    info(): void {},
    error(message): void {
      errors.push(message);
    },
  };
  const mediaDevices: RtcMediaDevicesPort = {
    async getUserMedia(): Promise<MediaStreamPort> {
      throw new DOMException('denied', 'NotAllowedError');
    },
    async enumerateDevices(): Promise<readonly RtcMediaDevice[]> {
      return [];
    },
  };
  const manager = new MediaManager(mediaDevices, logger);

  await assert.rejects(manager.openAudioVideo(), { name: 'NotAllowedError' });
  assert.deepEqual(errors, ['Permissão negada']);
});

test('captura, envia, renderiza e reconecta áudio e vídeo entre dois clientes', async (context) => {
  const logs: string[] = [];
  const loggedErrors: unknown[] = [];
  const deliveryErrors: unknown[] = [];
  const signalMessages: SocketMessage<unknown>[] = [];
  const logger = createLogger(logs, loggedErrors);
  const holderA: EngineHolder = {};
  const holderB: EngineHolder = {};
  const fixtureA = createFixture(createRelay(holderB, signalMessages, deliveryErrors), logger);
  const fixtureB = createFixture(createRelay(holderA, signalMessages, deliveryErrors), logger);

  holderA.engine = fixtureA.engine;
  holderB.engine = fixtureB.engine;
  context.after(async () => {
    await Promise.all([fixtureA.engine.close(), fixtureB.engine.close()]);
  });

  fixtureA.engine.configureMedia({
    audio: { deviceId: 'microphone-a' },
    video: { deviceId: 'camera-a', width: 1280, height: 720, frameRate: 30 },
  });
  assert.equal((await fixtureA.engine.listDevices()).length, 3);

  await fixtureA.engine.connect(CALL_ID, SESSION_ID);
  await waitUntil(() => isConnected(fixtureA.engine) && isConnected(fixtureB.engine));
  await waitUntil(
    () =>
      rendererHasAudioVideo(fixtureA.remoteRenderer) &&
      rendererHasAudioVideo(fixtureB.remoteRenderer),
  );

  assert.equal(fixtureA.mediaDevices.captureCount, 1);
  assert.equal(fixtureB.mediaDevices.captureCount, 1);
  assert.deepEqual(fixtureA.mediaDevices.constraints[0], {
    audio: { deviceId: { exact: 'microphone-a' } },
    video: {
      deviceId: { exact: 'camera-a' },
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30 },
    },
  });
  assert.equal(countEvent(signalMessages, EventType.SIGNAL_OFFER), 1);
  assert.equal(countEvent(signalMessages, EventType.SIGNAL_ANSWER), 1);
  assert(countEvent(signalMessages, EventType.SIGNAL_ICE_CANDIDATE) >= 2);
  assert(fixtureA.events.some((event) => event.type === RtcEventType.PEER_CONNECTED));
  assert(fixtureB.events.some((event) => event.type === RtcEventType.REMOTE_STREAM_RECEIVED));
  assert.equal(countMessage(logs, 'Permissão concedida'), 2);
  assert.equal(countMessage(logs, 'Câmera iniciada'), 2);
  assert.equal(countMessage(logs, 'Microfone iniciado'), 2);
  assert.equal(countMessage(logs, 'Stream local criada'), 2);
  assert.equal(countMessage(logs, 'Stream remota recebida'), 2);

  const firstTracksA = fixtureA.mediaDevices.streams[0]?.getTracks() ?? [];
  const firstTracksB = fixtureB.mediaDevices.streams[0]?.getTracks() ?? [];

  await fixtureA.engine.reconnect();
  await waitUntil(
    () =>
      fixtureA.mediaDevices.captureCount === 2 &&
      fixtureB.mediaDevices.captureCount === 2 &&
      isConnected(fixtureA.engine) &&
      isConnected(fixtureB.engine),
  );
  await waitUntil(() => fixtureA.events.some((event) => event.type === RtcEventType.RECONNECTED));

  assert(firstTracksA.every(isStopped));
  assert(firstTracksB.every(isStopped));
  assert.equal(countEvent(signalMessages, EventType.SIGNAL_OFFER), 2);
  assert.equal(countEvent(signalMessages, EventType.SIGNAL_ANSWER), 2);
  assert(fixtureA.localRenderer.attachCount >= 2);
  assert(fixtureB.remoteRenderer.attachCount >= 2);
  assert.equal(deliveryErrors.length, 0);
  assert.equal(loggedErrors.length, 0);

  await Promise.all([fixtureA.engine.close(), fixtureB.engine.close()]);

  const finalTracksA = fixtureA.mediaDevices.streams[1]?.getTracks() ?? [];
  const finalTracksB = fixtureB.mediaDevices.streams[1]?.getTracks() ?? [];

  assert(finalTracksA.every(isStopped));
  assert(finalTracksB.every(isStopped));
  assert.equal(fixtureA.localRenderer.currentStream, undefined);
  assert.equal(fixtureA.remoteRenderer.currentStream, undefined);
  assert.equal(fixtureB.localRenderer.currentStream, undefined);
  assert.equal(fixtureB.remoteRenderer.currentStream, undefined);
  assert.equal(countMessage(logs, 'Encerramento'), 2);
  assert.equal(deliveryErrors.length, 0);
  assert.equal(loggedErrors.length, 0);
});

function createFixture(signaling: WebRtcSignalingPort, logger: WebRtcLogger): EngineFixture {
  const mediaDevices = new TestMediaDevices();
  const mediaManager = new MediaManager(mediaDevices, logger);
  const peerFactory = new PeerConnectionFactory(
    TEST_ICE_SETTINGS,
    () => new NodePeerConnectionAdapter(new wrtc.RTCPeerConnection({ iceServers: [] })),
  );
  const peerManager = new PeerManager({ peerFactory, mediaManager, signaling }, logger);
  const localRenderer = new TestRenderer();
  const remoteRenderer = new TestRenderer();
  const engine = new RtcEngine(
    peerManager,
    mediaManager,
    { local: localRenderer, remote: remoteRenderer },
    logger,
  );
  const events: RtcEvent[] = [];

  engine.onEvent((event) => events.push(event));
  return { engine, mediaDevices, localRenderer, remoteRenderer, events };
}

function createRelay(
  remoteHolder: EngineHolder,
  messages: SocketMessage<unknown>[],
  errors: unknown[],
): WebRtcSignalingPort {
  let delivery = Promise.resolve();
  const requireRemote = (): RtcEngine => {
    assert(remoteHolder.engine !== undefined);
    return remoteHolder.engine;
  };

  return {
    sendOffer(message): void {
      messages.push(message);
      delivery = delivery
        .then(() => requireRemote().receiveOffer(message))
        .catch((error: unknown) => {
          errors.push(error);
        });
    },
    sendAnswer(message): void {
      messages.push(message);
      delivery = delivery
        .then(() => requireRemote().receiveAnswer(message))
        .catch((error: unknown) => {
          errors.push(error);
        });
    },
    sendIceCandidate(message): void {
      messages.push(message);
      delivery = delivery
        .then(() => requireRemote().receiveIceCandidate(message))
        .catch((error: unknown) => {
          errors.push(error);
        });
    },
  };
}

class TestMediaDevices implements RtcMediaDevicesPort {
  public readonly constraints: MediaStreamConstraints[] = [];
  public readonly streams: NodeMediaStreamAdapter[] = [];

  public get captureCount(): number {
    return this.streams.length;
  }

  public async getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStreamPort> {
    this.constraints.push(constraints);
    const stream = new NodeMediaStreamAdapter(
      new wrtc.MediaStream([
        new wrtc.nonstandard.RTCAudioSource().createTrack(),
        new wrtc.nonstandard.RTCVideoSource().createTrack(),
      ]),
    );

    this.streams.push(stream);
    return stream;
  }

  public async enumerateDevices(): Promise<readonly RtcMediaDevice[]> {
    return [
      { deviceId: 'microphone-a', kind: 'audioinput', label: 'Microphone' },
      { deviceId: 'speaker-a', kind: 'audiooutput', label: 'Speaker' },
      { deviceId: 'camera-a', kind: 'videoinput', label: 'Camera' },
    ];
  }
}

class TestRenderer implements RtcMediaRendererPort {
  public readonly streams: MediaStreamPort[] = [];
  public currentStream: MediaStreamPort | undefined;

  public get attachCount(): number {
    return this.streams.length;
  }

  public attach(stream: MediaStreamPort): void {
    this.currentStream = stream;
    this.streams.push(stream);
  }

  public clear(): void {
    this.currentStream = undefined;
  }
}

class NodeMediaTrackAdapter implements MediaTrackPort {
  public readonly kind: MediaKind;
  public readonly source: MediaStreamTrack;

  public constructor(track: MediaStreamTrack) {
    if (track.kind !== 'audio' && track.kind !== 'video') {
      throw new Error(`Tipo de mídia não suportado no teste: ${track.kind}`);
    }

    this.kind = track.kind;
    this.source = track;
  }

  public stop(): void {
    this.source.stop();
  }

  public setEndedHandler(handler: () => void): void {
    this.source.onended = handler;
  }
}

class NodeMediaStreamAdapter implements MediaStreamPort {
  public readonly source: MediaStream;

  public constructor(stream: MediaStream) {
    this.source = stream;
  }

  public getTracks(): readonly MediaTrackPort[] {
    return this.source.getTracks().map((track) => new NodeMediaTrackAdapter(track));
  }

  public getAudioTracks(): readonly MediaTrackPort[] {
    return this.source.getAudioTracks().map((track) => new NodeMediaTrackAdapter(track));
  }

  public getVideoTracks(): readonly MediaTrackPort[] {
    return this.source.getVideoTracks().map((track) => new NodeMediaTrackAdapter(track));
  }
}

class NodePeerConnectionAdapter implements PeerConnectionPort {
  private readonly sendersByTrack = new Map<unknown, RTCRtpSender>();

  public constructor(private readonly peer: RTCPeerConnection) {}

  public get connectionState() {
    return this.peer.connectionState;
  }

  public addTrack(track: MediaTrackPort, stream: MediaStreamPort): void {
    assert(track instanceof NodeMediaTrackAdapter);
    assert(stream instanceof NodeMediaStreamAdapter);
    const sender = this.peer.addTrack(track.source, stream.source);

    this.sendersByTrack.set(track.source, sender);
  }

  public removeTrack(track: MediaTrackPort): void {
    const sender = this.sendersByTrack.get(track.source);

    if (sender !== undefined) {
      this.peer.removeTrack(sender);
      this.sendersByTrack.delete(track.source);
    }
  }

  public async replaceTrack(
    currentTrack: MediaTrackPort,
    replacementTrack: MediaTrackPort,
  ): Promise<void> {
    assert(replacementTrack instanceof NodeMediaTrackAdapter);
    const sender = this.sendersByTrack.get(currentTrack.source);

    assert(sender !== undefined);
    await sender.replaceTrack(replacementTrack.source);
    this.sendersByTrack.delete(currentTrack.source);
    this.sendersByTrack.set(replacementTrack.source, sender);
  }

  public restartIce(): void {
    this.peer.restartIce();
  }

  public async createOffer(): Promise<WebRtcSessionDescription> {
    const offer = await this.peer.createOffer();
    assert(offer.sdp !== undefined);
    return { type: 'offer', sdp: offer.sdp };
  }

  public async createAnswer(): Promise<WebRtcSessionDescription> {
    const answer = await this.peer.createAnswer();
    assert(answer.sdp !== undefined);
    return { type: 'answer', sdp: answer.sdp };
  }

  public async setLocalDescription(description: WebRtcSessionDescription): Promise<void> {
    await this.peer.setLocalDescription(description);
  }

  public async setRemoteDescription(description: WebRtcSessionDescription): Promise<void> {
    await this.peer.setRemoteDescription(description);
  }

  public async addIceCandidate(candidate: WebRtcIceCandidate): Promise<void> {
    await this.peer.addIceCandidate(candidate);
  }

  public setIceCandidateHandler(handler: IceCandidateHandler): void {
    this.peer.onicecandidate = (event) => {
      if (event.candidate === null) {
        handler(null);
        return;
      }

      const candidate = event.candidate.toJSON();
      assert(candidate.candidate !== undefined);
      handler({
        candidate: candidate.candidate,
        ...(candidate.sdpMid === undefined ? {} : { sdpMid: candidate.sdpMid }),
        ...(candidate.sdpMLineIndex === undefined
          ? {}
          : { sdpMLineIndex: candidate.sdpMLineIndex }),
        ...(candidate.usernameFragment === undefined
          ? {}
          : { usernameFragment: candidate.usernameFragment }),
      });
    };
  }

  public setRemoteTrackHandler(handler: RemoteTrackHandler): void {
    this.peer.ontrack = (event) => {
      const stream = event.streams[0] ?? new wrtc.MediaStream([event.track]);
      handler(new NodeMediaStreamAdapter(stream), new NodeMediaTrackAdapter(event.track));
    };
  }

  public setConnectionStateHandler(handler: PeerConnectionStateHandler): void {
    this.peer.onconnectionstatechange = () => handler(this.peer.connectionState);
  }

  public close(): void {
    this.sendersByTrack.clear();
    this.peer.close();
  }
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

function rendererHasAudioVideo(renderer: TestRenderer): boolean {
  const stream = renderer.currentStream;
  return (
    stream !== undefined && stream.getAudioTracks().length > 0 && stream.getVideoTracks().length > 0
  );
}

function isConnected(engine: RtcEngine): boolean {
  return engine.getState() === WebRtcNegotiationState.CONNECTED;
}

function isStopped(track: MediaTrackPort): boolean {
  return track instanceof NodeMediaTrackAdapter && track.source.readyState === 'ended';
}

function countEvent(messages: readonly SocketMessage<unknown>[], event: EventType): number {
  return messages.filter((message) => message.event === event).length;
}

function countMessage(messages: readonly string[], expected: string): number {
  return messages.filter((message) => message === expected).length;
}

async function waitUntil(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + CONNECTION_TIMEOUT_MS;

  while (!condition()) {
    if (Date.now() >= deadline) {
      throw new Error('Tempo limite excedido ao aguardar o RTC Engine');
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}
