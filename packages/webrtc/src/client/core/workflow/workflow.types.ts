import type { StateTransition } from '@professor-connect/services/state-machine';

import type { RemoteCommand } from '../remote-control/remote.types.js';
import type { WorkflowEventType } from './workflow.events.js';

export enum WorkflowState {
  IDLE = 'IDLE',
  CONNECTING = 'CONNECTING',
  REQUESTED = 'REQUESTED',
  PREPARING = 'PREPARING',
  NEGOTIATING = 'NEGOTIATING',
  ACTIVE = 'ACTIVE',
  RECOVERING = 'RECOVERING',
  STOPPING = 'STOPPING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export enum WorkflowHealthStatus {
  HEALTHY = 'HEALTHY',
  UNHEALTHY = 'UNHEALTHY',
}

export enum WorkflowHealthComponent {
  SOCKET_IO = 'Socket.IO',
  HEARTBEAT = 'Heartbeat',
  CALL = 'Call',
  SESSION = 'Session',
  PEER_CONNECTION = 'PeerConnection',
  DATA_CHANNEL = 'DataChannel',
  MEDIA_STREAMS = 'MediaStreams',
}

export interface WorkflowClient {
  readonly clientId: string;
  readonly connectionId: string;
  readonly displayName: string;
}

export interface WorkflowStartInput {
  readonly student: WorkflowClient;
  readonly teacher: WorkflowClient;
}

export interface WorkflowContext {
  readonly workflowId: string;
  readonly student: WorkflowClient;
  readonly teacher: WorkflowClient;
  readonly startedAt: string;
  readonly requestId?: string;
  readonly sessionId?: string;
  readonly callId?: string;
  readonly callStartedAt?: string;
  readonly endedAt?: string;
}

export interface WorkflowEvent {
  readonly type: WorkflowEventType;
  readonly workflowId: string;
  readonly timestamp: string;
  readonly context: WorkflowContext;
  readonly error?: unknown;
}

export type WorkflowEventListener = (event: WorkflowEvent) => void;
export type WorkflowStateListener = (transition: StateTransition<WorkflowState>) => void;
export type WorkflowClock = () => Date;
export type WorkflowIdFactory = () => string;

export interface WorkflowLogger {
  info(message: string, context?: Readonly<Record<string, unknown>>): void;
  error(message: string, error: unknown): void;
}

export interface WorkflowConnectionPort {
  connectParticipants(input: WorkflowStartInput): Promise<void> | void;
  recoverParticipants(context: WorkflowContext): Promise<void> | void;
  areSocketsConnected(context: WorkflowContext): boolean;
}

export interface WorkflowPresencePort {
  registerParticipants(input: WorkflowStartInput): Promise<void> | void;
  isReady(context: WorkflowContext): boolean;
}

export interface WorkflowRequestPort {
  createRequest(context: WorkflowContext): Promise<string> | string;
  acceptRequest(context: WorkflowContext, requestId: string): Promise<void> | void;
  cancelTimers(): Promise<void> | void;
}

export interface WorkflowSessionPort {
  createSession(context: WorkflowContext): Promise<string> | string;
  closeSession(sessionId: string): Promise<void> | void;
  isActive(sessionId: string): boolean;
}

export interface WorkflowCallPort {
  createCall(requestId: string, sessionId: string): Promise<string> | string;
  connectCall(callId: string): Promise<void> | void;
  finishCall(callId: string): Promise<void> | void;
  failCall(callId: string): Promise<void> | void;
  isActive(callId: string): boolean;
}

export interface WorkflowSignalingPort {
  prepare(callId: string, sessionId: string): Promise<void> | void;
  removeListeners(): Promise<void> | void;
}

export interface WorkflowRtcPort {
  connect(callId: string, sessionId: string): Promise<void>;
  reconnect(): Promise<void>;
  close(): Promise<void>;
  isPeerConnected(): boolean;
  hasMediaStreams(): boolean;
}

export interface WorkflowDataChannelPort {
  connect(callId: string, sessionId: string): Promise<void>;
  reconnect(callId: string, sessionId: string): Promise<void>;
  close(callId: string): Promise<void> | void;
  isOpen(callId: string): boolean;
}

export interface WorkflowHeartbeatPort {
  start(context: WorkflowContext): Promise<void> | void;
  stop(): Promise<void> | void;
  isHealthy(context: WorkflowContext): boolean;
}

export interface WorkflowScreenSharingPort {
  start(context: WorkflowContext): Promise<void>;
  stop(): Promise<void>;
  isActive(): boolean;
}

export interface WorkflowRemoteControlPort {
  authorize(context: WorkflowContext): Promise<void>;
  sendCommand(command: RemoteCommand): void;
  revoke(): Promise<void>;
  isActive(): boolean;
}

export interface WorkflowMemoryPort {
  clear(workflowId: string): Promise<void> | void;
}

export interface WorkflowDependencies {
  readonly connection: WorkflowConnectionPort;
  readonly presence: WorkflowPresencePort;
  readonly request: WorkflowRequestPort;
  readonly session: WorkflowSessionPort;
  readonly call: WorkflowCallPort;
  readonly signaling: WorkflowSignalingPort;
  readonly rtc: WorkflowRtcPort;
  readonly dataChannel: WorkflowDataChannelPort;
  readonly heartbeat: WorkflowHeartbeatPort;
  readonly screenSharing: WorkflowScreenSharingPort;
  readonly remoteControl: WorkflowRemoteControlPort;
}

export interface WorkflowHealthCheckDependencies {
  readonly connection: WorkflowConnectionPort;
  readonly heartbeat: WorkflowHeartbeatPort;
  readonly call: WorkflowCallPort;
  readonly session: WorkflowSessionPort;
  readonly rtc: WorkflowRtcPort;
  readonly dataChannel: WorkflowDataChannelPort;
}

export interface WorkflowHealthComponentResult {
  readonly component: WorkflowHealthComponent;
  readonly healthy: boolean;
}

export interface WorkflowHealthSnapshot {
  readonly status: WorkflowHealthStatus;
  readonly timestamp: string;
  readonly components: readonly WorkflowHealthComponentResult[];
}

export interface WorkflowHealthCheckPort {
  check(context: WorkflowContext | undefined): WorkflowHealthSnapshot;
}

export interface ResourceReleaseFailure {
  readonly resource: string;
  readonly error: unknown;
}

export interface ResourceReleaseReport {
  readonly released: readonly string[];
  readonly failures: readonly ResourceReleaseFailure[];
}

export interface ResourceManagerDependencies {
  readonly request: WorkflowRequestPort;
  readonly session: WorkflowSessionPort;
  readonly call: WorkflowCallPort;
  readonly signaling: WorkflowSignalingPort;
  readonly rtc: WorkflowRtcPort;
  readonly dataChannel: WorkflowDataChannelPort;
  readonly heartbeat: WorkflowHeartbeatPort;
  readonly screenSharing: WorkflowScreenSharingPort;
  readonly remoteControl: WorkflowRemoteControlPort;
  readonly memory: WorkflowMemoryPort;
  readonly logger?: WorkflowLogger;
}

export interface ResourceManagerPort {
  release(context: WorkflowContext): Promise<ResourceReleaseReport>;
  registerListener(unsubscribe: () => void): () => void;
}

export interface WorkflowManagerOptions {
  readonly logger?: WorkflowLogger;
  readonly clock?: WorkflowClock;
  readonly workflowIdFactory?: WorkflowIdFactory;
}

export interface WorkflowManagerPort {
  begin(input: WorkflowStartInput): Promise<WorkflowContext>;
  accept(): Promise<WorkflowContext>;
  startScreenSharing(): Promise<void>;
  authorizeRemoteControl(): Promise<void>;
  sendRemoteCommand(command: RemoteCommand): void;
  recover(): Promise<void>;
  end(): Promise<ResourceReleaseReport>;
  getContext(): WorkflowContext | undefined;
  getState(): WorkflowState;
  getStateHistory(): readonly StateTransition<WorkflowState>[];
  onEvent(listener: WorkflowEventListener): () => void;
  onStateChanged(listener: WorkflowStateListener): () => void;
}

export interface WorkflowServicePort {
  begin(input: WorkflowStartInput): Promise<WorkflowContext>;
  accept(): Promise<WorkflowContext>;
  startScreenSharing(): Promise<void>;
  authorizeRemoteControl(): Promise<void>;
  sendRemoteCommand(command: RemoteCommand): void;
  recover(): Promise<void>;
  end(): Promise<ResourceReleaseReport>;
  checkHealth(): WorkflowHealthSnapshot;
  getState(): WorkflowState;
  onEvent(listener: WorkflowEventListener): () => void;
}

export type { WorkflowEventType } from './workflow.events.js';
