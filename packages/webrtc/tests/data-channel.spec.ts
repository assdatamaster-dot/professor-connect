import assert from 'node:assert/strict';
import { test } from 'node:test';

import wrtc from '@roamhq/wrtc';

import {
  EventType,
  PeerNegotiationState,
  type DataChannelPayload,
  type PeerNegotiationStatePayload,
  type SocketMessage,
} from '@professor-connect/shared-types';

import { loadWebRtcIceSettings } from '../src/config/webrtc.js';
import { DataChannelService } from '../src/modules/webrtc/data-channel.service.js';
import { PeerFactory } from '../src/modules/webrtc/peer.factory.js';
import { DataChannelWebRtcManager } from '../src/modules/webrtc/webrtc.manager.js';
import { DataChannelWebRtcService } from '../src/modules/webrtc/webrtc.service.js';
import type { DataChannelSocketMessage } from '../src/modules/webrtc/peer.types.js';
import type { WebRtcLogger, WebRtcSignalingPort } from '../src/modules/webrtc/webrtc.types.js';

const CALL_ID = 'call-data-channel';
const SESSION_ID = 'session-data-channel';
const CONNECTION_TIMEOUT_MS = 10_000;
const TEST_ICE_SETTINGS = {
  stunUrls: [],
  turn: { enabled: false, urls: [] },
} as const;

interface ServiceHolder {
  service?: DataChannelWebRtcService;
}

test('carrega STUN e TURN por variáveis de ambiente tipadas', () => {
  assert.deepEqual(
    loadWebRtcIceSettings({
      WEBRTC_STUN_URLS: 'stun:one.example.org:3478, stun:two.example.org:3478',
      WEBRTC_TURN_ENABLED: 'true',
      WEBRTC_TURN_URLS: 'turn:turn.example.org:3478',
      WEBRTC_TURN_USERNAME: 'professor',
      WEBRTC_TURN_CREDENTIAL: 'secret',
    }),
    {
      stunUrls: ['stun:one.example.org:3478', 'stun:two.example.org:3478'],
      turn: {
        enabled: true,
        urls: ['turn:turn.example.org:3478'],
        username: 'professor',
        credential: 'secret',
      },
    },
  );
});

test('negocia dois peers, troca ICE e mensagens pelo DataChannel e encerra', async (context) => {
  const logs: string[] = [];
  const errors: unknown[] = [];
  const signalMessages: SocketMessage<unknown>[] = [];
  const stateMessagesA: SocketMessage<PeerNegotiationStatePayload>[] = [];
  const stateMessagesB: SocketMessage<PeerNegotiationStatePayload>[] = [];
  const receivedByA: DataChannelSocketMessage[] = [];
  const receivedByB: DataChannelSocketMessage[] = [];
  const logger = createLogger(logs, errors);
  const managerA = new DataChannelWebRtcManager({ logger });
  const managerB = new DataChannelWebRtcManager({ logger });
  const holderA: ServiceHolder = {};
  const holderB: ServiceHolder = {};
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
  serviceA.onMessage((_callId, message) => receivedByA.push(message));
  serviceB.onMessage((_callId, message) => receivedByB.push(message));

  await serviceA.createOffer(CALL_ID, SESSION_ID);
  await waitUntil(
    () =>
      managerA.getState(CALL_ID) === PeerNegotiationState.CONNECTED &&
      managerB.getState(CALL_ID) === PeerNegotiationState.CONNECTED,
  );

  assert.deepEqual(statesOf(stateMessagesA), [
    PeerNegotiationState.CONNECTING,
    PeerNegotiationState.NEGOTIATING,
    PeerNegotiationState.CONNECTED,
  ]);
  assert.deepEqual(statesOf(stateMessagesB), [
    PeerNegotiationState.CONNECTING,
    PeerNegotiationState.NEGOTIATING,
    PeerNegotiationState.CONNECTED,
  ]);
  assert(
    [...stateMessagesA, ...stateMessagesB].every(
      (message) =>
        message.event === EventType.WEBRTC_PEER_STATE_CHANGED && message.sessionId === SESSION_ID,
    ),
  );
  assert.equal(countEvent(signalMessages, EventType.SIGNAL_OFFER), 1);
  assert.equal(countEvent(signalMessages, EventType.SIGNAL_ANSWER), 1);
  assert(countEvent(signalMessages, EventType.SIGNAL_ICE_CANDIDATE) >= 2);

  const payloadA: DataChannelPayload = { value: 'ping-from-a' };
  const payloadB: DataChannelPayload = { value: 'pong-from-b' };
  const sentByA = serviceA.send(CALL_ID, payloadA);
  const sentByB = serviceB.send(CALL_ID, payloadB);

  await waitUntil(() => receivedByA.length === 1 && receivedByB.length === 1);

  assert.equal(sentByA.event, EventType.WEBRTC_DATA_CHANNEL_MESSAGE);
  assert.equal(sentByB.event, EventType.WEBRTC_DATA_CHANNEL_MESSAGE);
  assert.deepEqual(receivedByB[0]?.payload.payload, payloadA);
  assert.deepEqual(receivedByA[0]?.payload.payload, payloadB);
  assert.equal(countMessage(logs, 'Peer criado'), 2);
  assert.equal(countMessage(logs, 'Offer enviada'), 1);
  assert.equal(countMessage(logs, 'Offer recebida'), 1);
  assert.equal(countMessage(logs, 'Answer enviada'), 1);
  assert.equal(countMessage(logs, 'Answer recebida'), 1);
  assert(countMessage(logs, 'ICE Candidate enviado') >= 2);
  assert(countMessage(logs, 'ICE Candidate recebido') >= 2);
  assert.equal(countMessage(logs, 'DataChannel aberto'), 2);
  assert.equal(countMessage(logs, 'Mensagem enviada'), 2);
  assert.equal(countMessage(logs, 'Mensagem recebida'), 2);
  assert.equal(errors.length, 0);

  await Promise.all([serviceA.close(CALL_ID), serviceB.close(CALL_ID)]);

  assert.equal(managerA.getState(CALL_ID), PeerNegotiationState.CLOSED);
  assert.equal(managerB.getState(CALL_ID), PeerNegotiationState.CLOSED);
  assert.equal(countMessage(logs, 'Peer fechado'), 2);
  assert.equal(errors.length, 0);
});

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

function createService(
  manager: DataChannelWebRtcManager,
  signaling: WebRtcSignalingPort,
  logger: WebRtcLogger,
): DataChannelWebRtcService {
  const factory = new PeerFactory(
    TEST_ICE_SETTINGS,
    (configuration) => new wrtc.RTCPeerConnection(configuration) as unknown as RTCPeerConnection,
  );

  return new DataChannelWebRtcService(
    manager,
    factory,
    new DataChannelService(logger),
    signaling,
    logger,
  );
}

function createRelay(
  remoteHolder: ServiceHolder,
  messages: SocketMessage<unknown>[],
  errors: unknown[],
): WebRtcSignalingPort {
  let delivery = Promise.resolve();
  const requireRemote = (): DataChannelWebRtcService => {
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

function statesOf(
  messages: readonly SocketMessage<PeerNegotiationStatePayload>[],
): readonly PeerNegotiationState[] {
  return messages.map((message) => message.payload.state);
}

function countEvent(messages: readonly SocketMessage<unknown>[], event: EventType): number {
  return messages.filter((message) => message.event === event).length;
}

function countMessage(messages: readonly string[], expected: string): number {
  return messages.filter((message) => message === expected).length;
}

async function closeIfOpen(
  service: DataChannelWebRtcService,
  manager: DataChannelWebRtcManager,
): Promise<void> {
  if (
    manager.findNegotiation(CALL_ID) !== undefined &&
    manager.getState(CALL_ID) !== PeerNegotiationState.CLOSED
  ) {
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
