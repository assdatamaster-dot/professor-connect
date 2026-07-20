import type { StateTransition } from '@professor-connect/services/state-machine';
import type {
  DataChannelMessage,
  DataChannelPayload,
  PeerNegotiationState,
  PeerNegotiationStatePayload,
  SocketMessage,
} from '@professor-connect/shared-types';

import type {
  IceCandidateHandler,
  PeerConnectionStateHandler,
  WebRtcIceCandidate,
  WebRtcLogger,
  WebRtcManagerOptions,
  WebRtcSessionDescription,
} from './webrtc.types.js';

export type DataChannelReadyState = 'connecting' | 'open' | 'closing' | 'closed';
export type DataChannelOpenHandler = () => void;
export type DataChannelCloseHandler = () => void;
export type DataChannelErrorHandler = (error: unknown) => void;
export type DataChannelMessageHandler = (data: string) => void;

export interface DataChannelPort {
  readonly label: string;
  readonly readyState: DataChannelReadyState;
  send(data: string): void;
  close(): void;
  setOpenHandler(handler: DataChannelOpenHandler): void;
  setCloseHandler(handler: DataChannelCloseHandler): void;
  setErrorHandler(handler: DataChannelErrorHandler): void;
  setMessageHandler(handler: DataChannelMessageHandler): void;
}

export type RemoteDataChannelHandler = (channel: DataChannelPort) => void;

export interface DataChannelPeerPort {
  readonly connectionState: RTCPeerConnectionState;
  createDataChannel(label: string): DataChannelPort;
  createOffer(): Promise<WebRtcSessionDescription>;
  createAnswer(): Promise<WebRtcSessionDescription>;
  setLocalDescription(description: WebRtcSessionDescription): Promise<void>;
  setRemoteDescription(description: WebRtcSessionDescription): Promise<void>;
  addIceCandidate(candidate: WebRtcIceCandidate): Promise<void>;
  setIceCandidateHandler(handler: IceCandidateHandler): void;
  setConnectionStateHandler(handler: PeerConnectionStateHandler): void;
  setDataChannelHandler(handler: RemoteDataChannelHandler): void;
  close(): void;
}

export interface PeerFactoryPort {
  createPeer(): DataChannelPeerPort;
}

export interface PeerNegotiation {
  readonly callId: string;
  readonly sessionId: string;
  readonly peer: DataChannelPeerPort;
}

export type PeerStateListener = (message: SocketMessage<PeerNegotiationStatePayload>) => void;
export type DataChannelSocketMessage = SocketMessage<DataChannelMessage<DataChannelPayload>>;
export type DataChannelMessageListener = (
  callId: string,
  message: DataChannelSocketMessage,
) => void;
export type DataChannelEventMessage = SocketMessage<unknown>;
export type DataChannelEventListener = (callId: string, message: DataChannelEventMessage) => void;
export type DataChannelLifecycleListener = (callId: string) => void;
export type DataChannelFailureListener = (callId: string, error: unknown) => void;

export interface DataChannelManagerPort {
  createNegotiation(negotiation: PeerNegotiation): PeerNegotiation;
  findNegotiation(callId: string): PeerNegotiation | undefined;
  requireNegotiation(callId: string): PeerNegotiation;
  getState(callId: string): PeerNegotiationState;
  getStateHistory(callId: string): readonly StateTransition<PeerNegotiationState>[];
  transition(callId: string, state: PeerNegotiationState): void;
  fail(callId: string): void;
  close(callId: string): Promise<void>;
  onStateChanged(listener: PeerStateListener): () => void;
}

export interface DataChannelServiceOptions extends WebRtcManagerOptions {
  readonly logger?: WebRtcLogger;
}
