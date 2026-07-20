import type { StateTransition } from '@professor-connect/services/state-machine';
import type {
  ScreenShareFailedPayload,
  ScreenShareFailureCode,
  ScreenShareReferencePayload,
  ScreenShareRequestPayload,
  SocketMessage,
} from '@professor-connect/shared-types';

import type {
  MediaStreamPort,
  WebRtcClock,
  WebRtcLogger,
  WebRtcMessageIdFactory,
} from '../../../modules/webrtc/webrtc.types.js';
import type {
  RtcMediaManagerPort,
  RtcMediaRendererPort,
  RtcVideoTrackControllerPort,
} from './rtc-types.js';

export enum ScreenSharingState {
  IDLE = 'IDLE',
  REQUESTED = 'REQUESTED',
  STARTING = 'STARTING',
  SHARING = 'SHARING',
  STOPPING = 'STOPPING',
  STOPPED = 'STOPPED',
  FAILED = 'FAILED',
}

export interface ScreenSharingContext {
  readonly callId: string;
  readonly sessionId: string;
  readonly requestId: string;
}

export interface ScreenCaptureDevicesPort {
  getDisplayMedia(constraints: DisplayMediaStreamOptions): Promise<MediaStreamPort>;
}

export interface ScreenSharingFailure {
  readonly code: ScreenShareFailureCode;
  readonly error: unknown;
}

export type ScreenSharingStateListener = (transition: StateTransition<ScreenSharingState>) => void;
export type ScreenSharingStoppedListener = (context: ScreenSharingContext) => void;
export type ScreenSharingFailedListener = (
  context: ScreenSharingContext,
  failure: ScreenSharingFailure,
) => void;

export interface ScreenSharingManagerPort {
  request(context: ScreenSharingContext): void;
  startLocal(): Promise<void>;
  acceptRemote(): void;
  markStartedRemote(): void;
  deny(): void;
  stopLocal(): Promise<void>;
  markStoppedRemote(): void;
  failRemote(): void;
  getContext(): ScreenSharingContext | undefined;
  getState(): ScreenSharingState;
  hasLocalCapture(): boolean;
  getStateHistory(): readonly StateTransition<ScreenSharingState>[];
  onStateChanged(listener: ScreenSharingStateListener): () => void;
  onLocalStopped(listener: ScreenSharingStoppedListener): () => void;
  onLocalFailed(listener: ScreenSharingFailedListener): () => void;
}

export interface ScreenSharingManagerDependencies {
  readonly captureDevices: ScreenCaptureDevicesPort;
  readonly trackController: RtcVideoTrackControllerPort;
  readonly mediaManager: RtcMediaManagerPort;
  readonly localRenderer: RtcMediaRendererPort;
  readonly logger?: WebRtcLogger;
  readonly clock?: WebRtcClock;
}

export interface ScreenSharingSignalingPort {
  sendRequest(message: SocketMessage<ScreenShareRequestPayload>): Promise<void> | void;
  sendAccept(message: SocketMessage<ScreenShareReferencePayload>): Promise<void> | void;
  sendDeny(message: SocketMessage<ScreenShareReferencePayload>): Promise<void> | void;
  sendStarted(message: SocketMessage<ScreenShareReferencePayload>): Promise<void> | void;
  sendStopped(message: SocketMessage<ScreenShareReferencePayload>): Promise<void> | void;
  sendFailed(message: SocketMessage<ScreenShareFailedPayload>): Promise<void> | void;
}

export interface ScreenSharingServicePort {
  request(callId: string, sessionId: string): Promise<void>;
  receiveRequest(message: SocketMessage<ScreenShareRequestPayload>): void;
  accept(): Promise<void>;
  receiveAccept(message: SocketMessage<ScreenShareReferencePayload>): void;
  deny(): Promise<void>;
  receiveDeny(message: SocketMessage<ScreenShareReferencePayload>): void;
  receiveStarted(message: SocketMessage<ScreenShareReferencePayload>): void;
  stop(): Promise<void>;
  receiveStopped(message: SocketMessage<ScreenShareReferencePayload>): void;
  receiveFailed(message: SocketMessage<ScreenShareFailedPayload>): void;
  getState(): ScreenSharingState;
  isLocalSharing(): boolean;
}

export interface ScreenSharingServiceOptions {
  readonly logger?: WebRtcLogger;
  readonly clock?: WebRtcClock;
  readonly messageIdFactory?: WebRtcMessageIdFactory;
}
