import type { StateTransition } from '@professor-connect/services/state-machine';
import type {
  SignalAnswerPayload,
  SignalIceCandidatePayload,
  SignalOfferPayload,
  SocketMessage,
  WebRtcNegotiationState,
  WebRtcNegotiationStatePayload,
} from '@professor-connect/protocol';

export type MediaKind = 'audio' | 'video';
export type WebRtcPeerConnectionState =
  'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed';

export interface WebRtcSessionDescription {
  readonly type: 'offer' | 'answer';
  readonly sdp: string;
}

export interface WebRtcIceCandidate {
  readonly candidate: string;
  readonly sdpMid?: string | null;
  readonly sdpMLineIndex?: number | null;
  readonly usernameFragment?: string | null;
}

export interface MediaTrackPort {
  readonly kind: MediaKind;
  readonly source: unknown;
  stop(): void;
  setEndedHandler(handler: () => void): void;
}

export interface MediaStreamPort {
  readonly source: unknown;
  getTracks(): readonly MediaTrackPort[];
  getAudioTracks(): readonly MediaTrackPort[];
  getVideoTracks(): readonly MediaTrackPort[];
}

export interface MediaDevicesPort {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStreamPort>;
}

export type IceCandidateHandler = (candidate: WebRtcIceCandidate | null) => void;
export type RemoteTrackHandler = (stream: MediaStreamPort, track: MediaTrackPort) => void;
export type PeerConnectionStateHandler = (state: WebRtcPeerConnectionState) => void;

export interface PeerConnectionPort {
  readonly connectionState: WebRtcPeerConnectionState;
  addTrack(track: MediaTrackPort, stream: MediaStreamPort): void;
  removeTrack(track: MediaTrackPort): void;
  replaceTrack(currentTrack: MediaTrackPort, replacementTrack: MediaTrackPort): Promise<void>;
  restartIce(): void;
  createOffer(): Promise<WebRtcSessionDescription>;
  createAnswer(): Promise<WebRtcSessionDescription>;
  setLocalDescription(description: WebRtcSessionDescription): Promise<void>;
  setRemoteDescription(description: WebRtcSessionDescription): Promise<void>;
  addIceCandidate(candidate: WebRtcIceCandidate): Promise<void>;
  setIceCandidateHandler(handler: IceCandidateHandler): void;
  setRemoteTrackHandler(handler: RemoteTrackHandler): void;
  setConnectionStateHandler(handler: PeerConnectionStateHandler): void;
  close(): Promise<void> | void;
}

export interface PeerConnectionFactoryPort {
  createPeer(): PeerConnectionPort;
}

export interface MediaServicePort {
  openAudioVideo(): Promise<MediaStreamPort>;
  attachTracks(peer: PeerConnectionPort, stream: MediaStreamPort): void;
  detachTracks(peer: PeerConnectionPort, stream: MediaStreamPort): void;
  close(stream: MediaStreamPort): void;
}

export interface WebRtcSignalingPort {
  sendOffer(message: SocketMessage<SignalOfferPayload>): Promise<void> | void;
  sendAnswer(message: SocketMessage<SignalAnswerPayload>): Promise<void> | void;
  sendIceCandidate(message: SocketMessage<SignalIceCandidatePayload>): Promise<void> | void;
}

export interface WebRtcLogger {
  info(message: string, context?: Readonly<Record<string, unknown>>): void;
  error(message: string, error: unknown): void;
}

export interface WebRtcNegotiation {
  readonly callId: string;
  readonly sessionId: string;
  readonly peer: PeerConnectionPort;
  readonly localStream: MediaStreamPort;
}

export type WebRtcClock = () => Date;
export type WebRtcMessageIdFactory = () => string;
export type WebRtcStateListener = (message: SocketMessage<WebRtcNegotiationStatePayload>) => void;
export type RemoteMediaListener = (callId: string, stream: MediaStreamPort) => void;

export interface WebRtcManagerOptions {
  readonly clock?: WebRtcClock;
  readonly messageIdFactory?: WebRtcMessageIdFactory;
  readonly logger?: WebRtcLogger;
}

export interface WebRtcManagerPort {
  createNegotiation(negotiation: WebRtcNegotiation): WebRtcNegotiation;
  findNegotiation(callId: string): WebRtcNegotiation | undefined;
  requireNegotiation(callId: string): WebRtcNegotiation;
  getState(callId: string): WebRtcNegotiationState;
  getStateHistory(callId: string): readonly StateTransition<WebRtcNegotiationState>[];
  transition(callId: string, state: WebRtcNegotiationState): void;
  fail(callId: string): void;
  close(callId: string): Promise<void>;
  onStateChanged(listener: WebRtcStateListener): () => void;
}
