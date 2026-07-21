import assert from 'node:assert/strict';
import { test } from 'node:test';

import wrtc from '@roamhq/wrtc';

import {
  EventType,
  WebRtcNegotiationState,
  type SocketMessage,
  type WebRtcNegotiationStatePayload,
} from '@professor-connect/protocol';

import { MediaService } from '../src/modules/webrtc/media.service.js';
import {
  PeerConnectionFactory,
  createRtcConfiguration,
  type WebRtcIceSettings,
} from '../src/modules/webrtc/peer-connection.factory.js';
import { WebRtcManager } from '../src/modules/webrtc/webrtc.manager.js';
import { WebRtcService } from '../src/modules/webrtc/webrtc.service.js';
import type {
  IceCandidateHandler,
  MediaDevicesPort,
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

const CALL_ID = 'call-webrtc';
const SESSION_ID = 'session-webrtc';
const CONNECTION_TIMEOUT_MS = 10_000;
const TEST_ICE_SETTINGS: WebRtcIceSettings = {
  stunUrls: [],
  turn: { enabled: false, urls: [] },
};

test('centraliza STUN e inclui TURN somente quando habilitado', () => {
  assert.deepEqual(
    createRtcConfiguration({
      stunUrls: ['stun:stun.example.org:3478'],
      turn: { enabled: false, urls: ['turn:disabled.example.org:3478'] },
    }),
    { iceServers: [{ urls: ['stun:stun.example.org:3478'] }] },
  );
  assert.deepEqual(
    createRtcConfiguration({
      stunUrls: ['stun:stun.example.org:3478'],
      turn: {
        enabled: true,
        urls: ['turn:turn.example.org:3478'],
        username: 'user',
        credential: 'credential',
      },
    }),
    {
      iceServers: [
        { urls: ['stun:stun.example.org:3478'] },
        {
          urls: ['turn:turn.example.org:3478'],
          username: 'user',
          credential: 'credential',
        },
      ],
    },
  );
});

test('estabelece áudio e vídeo com Offer, Answer, ICE, estados e encerramento', async (context) => {
  const logs: string[] = [];
  const errors: unknown[] = [];
  const logger: WebRtcLogger = {
    info(message): void {
      logs.push(message);
    },
    error(_message, error): void {
      errors.push(error);
    },
  };
  const managerA = new WebRtcManager({ logger });
  const managerB = new WebRtcManager({ logger });
  const stateMessagesA: SocketMessage<WebRtcNegotiationStatePayload>[] = [];
  const stateMessagesB: SocketMessage<WebRtcNegotiationStatePayload>[] = [];
  const signalMessages: SocketMessage<unknown>[] = [];
  const remoteKindsA = new Set<MediaKind>();
  const remoteKindsB = new Set<MediaKind>();
  const holderA: { service?: WebRtcService } = {};
  const holderB: { service?: WebRtcService } = {};
  const serviceA = createService(managerA, createRelay(holderB, signalMessages, errors), logger);
  const serviceB = createService(managerB, createRelay(holderA, signalMessages, errors), logger);

  holderA.service = serviceA;
  holderB.service = serviceB;
  context.after(async () => {
    await closeIfOpen(serviceA, managerA);
    await closeIfOpen(serviceB, managerB);
  });
  managerA.onStateChanged((message) => stateMessagesA.push(message));
  managerB.onStateChanged((message) => stateMessagesB.push(message));
  serviceA.onRemoteMedia((_callId, stream) => collectKinds(stream, remoteKindsA));
  serviceB.onRemoteMedia((_callId, stream) => collectKinds(stream, remoteKindsB));

  await serviceA.createOffer(CALL_ID, SESSION_ID);
  await waitUntil(
    () =>
      managerA.getState(CALL_ID) === WebRtcNegotiationState.CONNECTED &&
      managerB.getState(CALL_ID) === WebRtcNegotiationState.CONNECTED,
  );
  await waitUntil(
    () =>
      remoteKindsA.has('audio') &&
      remoteKindsA.has('video') &&
      remoteKindsB.has('audio') &&
      remoteKindsB.has('video'),
  );

  assert.deepEqual(statesOf(stateMessagesA), [
    WebRtcNegotiationState.OFFER_SENT,
    WebRtcNegotiationState.ANSWER_RECEIVED,
    WebRtcNegotiationState.ICE_EXCHANGING,
    WebRtcNegotiationState.CONNECTED,
  ]);
  assert.deepEqual(statesOf(stateMessagesB), [
    WebRtcNegotiationState.OFFER_RECEIVED,
    WebRtcNegotiationState.ANSWER_SENT,
    WebRtcNegotiationState.ICE_EXCHANGING,
    WebRtcNegotiationState.CONNECTED,
  ]);
  assert(
    stateMessagesA.every(
      (message) =>
        message.event === EventType.WEBRTC_NEGOTIATION_STATE_CHANGED &&
        message.sessionId === SESSION_ID,
    ),
  );
  assert.equal(countEvent(signalMessages, EventType.SIGNAL_OFFER), 1);
  assert.equal(countEvent(signalMessages, EventType.SIGNAL_ANSWER), 1);
  assert(countEvent(signalMessages, EventType.SIGNAL_ICE_CANDIDATE) >= 2);
  assert.deepEqual(remoteKindsA, new Set<MediaKind>(['audio', 'video']));
  assert.deepEqual(remoteKindsB, new Set<MediaKind>(['audio', 'video']));
  assert.equal(countMessage(logs, 'Peer criado'), 2);
  assert.equal(countMessage(logs, 'Offer enviada'), 1);
  assert.equal(countMessage(logs, 'Offer recebida'), 1);
  assert.equal(countMessage(logs, 'Answer enviada'), 1);
  assert.equal(countMessage(logs, 'Answer recebida'), 1);
  assert(countMessage(logs, 'ICE Candidate enviado') >= 2);
  assert(countMessage(logs, 'ICE Candidate recebido') >= 2);
  assert.equal(countMessage(logs, 'Peer conectado'), 2);
  assert.equal(errors.length, 0);

  const localTracksA = managerA.requireNegotiation(CALL_ID).localStream.getTracks();
  const localTracksB = managerB.requireNegotiation(CALL_ID).localStream.getTracks();

  await serviceA.close(CALL_ID);
  await serviceB.close(CALL_ID);

  assert.equal(managerA.getState(CALL_ID), WebRtcNegotiationState.CLOSED);
  assert.equal(managerB.getState(CALL_ID), WebRtcNegotiationState.CLOSED);
  assert(localTracksA.every(isStopped));
  assert(localTracksB.every(isStopped));
  assert.equal(countMessage(logs, 'Peer encerrado'), 2);
});

function createService(
  manager: WebRtcManager,
  signaling: WebRtcSignalingPort,
  logger: WebRtcLogger,
): WebRtcService {
  const mediaDevices: MediaDevicesPort = {
    async getUserMedia(): Promise<MediaStreamPort> {
      return new NodeMediaStreamAdapter(
        new wrtc.MediaStream([
          new wrtc.nonstandard.RTCAudioSource().createTrack(),
          new wrtc.nonstandard.RTCVideoSource().createTrack(),
        ]),
      );
    },
  };
  const factory = new PeerConnectionFactory(
    TEST_ICE_SETTINGS,
    () => new NodePeerConnectionAdapter(new wrtc.RTCPeerConnection({ iceServers: [] })),
  );

  return new WebRtcService(manager, factory, new MediaService(mediaDevices), signaling, logger);
}

function createRelay(
  remoteHolder: { service?: WebRtcService },
  messages: SocketMessage<unknown>[],
  errors: unknown[],
): WebRtcSignalingPort {
  let delivery = Promise.resolve();
  const requireRemote = (): WebRtcService => {
    assert(remoteHolder.service !== undefined);
    return remoteHolder.service;
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

      const value = event.candidate.toJSON();
      assert(value.candidate !== undefined);

      handler({
        candidate: value.candidate,
        ...(value.sdpMid === undefined ? {} : { sdpMid: value.sdpMid }),
        ...(value.sdpMLineIndex === undefined ? {} : { sdpMLineIndex: value.sdpMLineIndex }),
        ...(value.usernameFragment === undefined
          ? {}
          : { usernameFragment: value.usernameFragment }),
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

function collectKinds(stream: MediaStreamPort, target: Set<MediaKind>): void {
  for (const track of stream.getTracks()) {
    target.add(track.kind);
  }
}

function statesOf(
  messages: readonly SocketMessage<WebRtcNegotiationStatePayload>[],
): readonly WebRtcNegotiationState[] {
  return messages.map((message) => message.payload.state);
}

function countEvent(messages: readonly SocketMessage<unknown>[], event: EventType): number {
  return messages.filter((message) => message.event === event).length;
}

function countMessage(messages: readonly string[], expected: string): number {
  return messages.filter((message) => message === expected).length;
}

function isStopped(track: MediaTrackPort): boolean {
  return track instanceof NodeMediaTrackAdapter && track.source.readyState === 'ended';
}

async function closeIfOpen(service: WebRtcService, manager: WebRtcManager): Promise<void> {
  const negotiation = manager.findNegotiation(CALL_ID);

  if (negotiation !== undefined && manager.getState(CALL_ID) !== WebRtcNegotiationState.CLOSED) {
    await service.close(CALL_ID);
  }
}

async function waitUntil(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + CONNECTION_TIMEOUT_MS;

  while (!condition()) {
    if (Date.now() >= deadline) {
      throw new Error('Tempo limite excedido ao aguardar a conexão WebRTC');
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}
