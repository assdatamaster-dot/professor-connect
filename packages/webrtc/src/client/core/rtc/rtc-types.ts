import type {
  SignalAnswerPayload,
  SignalIceCandidatePayload,
  SignalOfferPayload,
  SocketMessage,
  WebRtcNegotiationState,
  WebRtcNegotiationStatePayload,
} from '@professor-connect/shared-types';

import type { RtcEventType } from './rtc-events.js';
import type {
  MediaServicePort,
  MediaStreamPort,
  PeerConnectionFactoryPort,
  RemoteMediaListener,
  WebRtcSignalingPort,
  WebRtcStateListener,
  MediaTrackPort,
} from '../../../modules/webrtc/webrtc.types.js';

export interface RtcAudioSettings {
  readonly deviceId?: string;
}

export interface RtcVideoSettings {
  readonly deviceId?: string;
  readonly width?: number;
  readonly height?: number;
  readonly frameRate?: number;
}

export interface RtcMediaSettings {
  readonly audio: RtcAudioSettings;
  readonly video: RtcVideoSettings;
}

export type RtcMediaDeviceKind = 'audioinput' | 'audiooutput' | 'videoinput';

export interface RtcMediaDevice {
  readonly deviceId: string;
  readonly kind: RtcMediaDeviceKind;
  readonly label: string;
}

export interface RtcMediaDevicesPort {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStreamPort>;
  enumerateDevices(): Promise<readonly RtcMediaDevice[]>;
}

export interface RtcMediaRendererPort {
  attach(stream: MediaStreamPort): Promise<void> | void;
  clear(): Promise<void> | void;
}

export interface RtcMediaView {
  readonly local: RtcMediaRendererPort;
  readonly remote: RtcMediaRendererPort;
}

export interface RtcMediaManagerPort extends MediaServicePort {
  configure(settings: RtcMediaSettings): void;
  listDevices(): Promise<readonly RtcMediaDevice[]>;
  getLocalStream(): MediaStreamPort | undefined;
  renderLocal(renderer: RtcMediaRendererPort): Promise<void>;
  renderStream(stream: MediaStreamPort, renderer: RtcMediaRendererPort): Promise<void>;
  renderRemote(stream: MediaStreamPort, renderer: RtcMediaRendererPort): Promise<void>;
}

export interface RtcConnection {
  readonly callId: string;
  readonly sessionId: string;
}

export interface RtcEvent {
  readonly type: RtcEventType;
  readonly callId: string;
  readonly timestamp: string;
  readonly error?: unknown;
}

export type RtcEventListener = (event: RtcEvent) => void;

export interface RtcPeerManagerPort {
  connect(callId: string, sessionId: string): Promise<void>;
  receiveOffer(message: SocketMessage<SignalOfferPayload>): Promise<void>;
  receiveAnswer(message: SocketMessage<SignalAnswerPayload>): Promise<void>;
  receiveIceCandidate(message: SocketMessage<SignalIceCandidatePayload>): Promise<void>;
  replaceVideoTrack(track: MediaTrackPort): Promise<void>;
  restoreCameraVideoTrack(): Promise<void>;
  reconnect(): Promise<void>;
  close(): Promise<void>;
  getConnection(): RtcConnection | undefined;
  getState(): WebRtcNegotiationState | undefined;
  onRemoteMedia(listener: RemoteMediaListener): () => void;
  onStateChanged(listener: WebRtcStateListener): () => void;
}

export interface RtcVideoTrackControllerPort {
  replaceVideoTrack(track: MediaTrackPort): Promise<void>;
  restoreCameraVideoTrack(): Promise<void>;
}

export interface PeerManagerDependencies {
  readonly peerFactory: PeerConnectionFactoryPort;
  readonly mediaManager: RtcMediaManagerPort;
  readonly signaling: WebRtcSignalingPort;
}

export interface RtcStateSnapshot {
  readonly connection: RtcConnection;
  readonly state: SocketMessage<WebRtcNegotiationStatePayload>;
}
