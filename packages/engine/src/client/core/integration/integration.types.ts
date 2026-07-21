import type { StateTransition } from '@professor-connect/services/state-machine';
import type { ClientPresence, ServiceRequest } from '@professor-connect/protocol';

import type { EndToEndEventType } from './integration.events.js';

export enum EndToEndRole {
  STUDENT = 'STUDENT',
  TEACHER = 'TEACHER',
}

export enum EndToEndState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  CALLING = 'CALLING',
  PREPARING = 'PREPARING',
  IN_ATTENDANCE = 'IN_ATTENDANCE',
  SHARING = 'SHARING',
  RECONNECTING = 'RECONNECTING',
  STOPPING = 'STOPPING',
  FAILED = 'FAILED',
}

export enum EndToEndResource {
  PEER_CONNECTION = 'PeerConnection',
  MEDIA_STREAMS = 'MediaStreams',
  RTC_DATA_CHANNEL = 'RTCDataChannel',
  TIMERS = 'Timers',
  LISTENERS = 'Listeners',
  SESSION = 'Session',
  CALL = 'Call',
  PENDING_REQUESTS = 'PendingRequests',
}

export interface EndToEndClient {
  readonly clientId: string;
  readonly displayName: string;
  readonly role: EndToEndRole;
}

export interface EndToEndAttendance {
  readonly requestId: string;
  readonly sessionId: string;
  readonly callId: string;
  readonly studentId: string;
  readonly teacherId: string;
}

export interface EndToEndResourceReleaseFailure {
  readonly resource: EndToEndResource;
  readonly error: unknown;
}

export interface EndToEndResourceReleaseReport {
  readonly released: readonly EndToEndResource[];
  readonly failures: readonly EndToEndResourceReleaseFailure[];
}

export interface EndToEndSnapshot {
  readonly state: EndToEndState;
  readonly client: EndToEndClient | undefined;
  readonly onlineStudents: readonly ClientPresence[];
  readonly pendingRequests: readonly ServiceRequest[];
  readonly attendance: EndToEndAttendance | undefined;
  readonly hasAudio: boolean;
  readonly hasVideo: boolean;
  readonly isSharingScreen: boolean;
}

export interface EndToEndEvent {
  readonly type: EndToEndEventType;
  readonly timestamp: string;
  readonly snapshot: EndToEndSnapshot;
  readonly error?: unknown;
}

export type EndToEndEventListener = (event: EndToEndEvent) => void;
export type EndToEndStateListener = (transition: StateTransition<EndToEndState>) => void;

export interface EndToEndLogger {
  info(message: string, context?: Readonly<Record<string, unknown>>): void;
  error(message: string, error: unknown): void;
}

export interface EndToEndWorkflowPort {
  connect(client: EndToEndClient): Promise<void>;
  registerPresence(client: EndToEndClient): Promise<void>;
  listOnlineStudents(): Promise<readonly ClientPresence[]>;
  createRequest(): Promise<ServiceRequest>;
  acceptRequest(requestId: string): Promise<EndToEndAttendance>;
  rejectRequest(requestId: string): Promise<void>;
  prepareSignaling(attendance: EndToEndAttendance): Promise<void>;
  connectRtc(attendance: EndToEndAttendance, initiator: boolean): Promise<void>;
  reconnectRtc(attendance: EndToEndAttendance): Promise<void>;
  hasAudio(): boolean;
  hasVideo(): boolean;
  startScreenSharing(attendance: EndToEndAttendance): Promise<void>;
  disconnect(): Promise<void>;
}

export interface EndToEndResourceManagerPort {
  release(
    attendance: EndToEndAttendance | undefined,
    pendingRequestId: string | undefined,
  ): Promise<EndToEndResourceReleaseReport>;
}

export interface EndToEndManagerOptions {
  readonly logger?: EndToEndLogger;
  readonly clock?: () => Date;
}

export interface EndToEndManagerPort {
  connect(client: EndToEndClient): Promise<EndToEndSnapshot>;
  callProfessor(): Promise<ServiceRequest>;
  receiveRequest(request: ServiceRequest): void;
  acceptRequest(requestId: string): Promise<EndToEndAttendance>;
  receiveAcceptedAttendance(attendance: EndToEndAttendance): Promise<void>;
  rejectRequest(requestId: string): Promise<void>;
  shareScreen(): Promise<void>;
  reconnect(): Promise<void>;
  endAttendance(): Promise<EndToEndResourceReleaseReport>;
  disconnect(): Promise<void>;
  getSnapshot(): EndToEndSnapshot;
  getStateHistory(): readonly StateTransition<EndToEndState>[];
  onEvent(listener: EndToEndEventListener): () => void;
  onStateChanged(listener: EndToEndStateListener): () => void;
}
