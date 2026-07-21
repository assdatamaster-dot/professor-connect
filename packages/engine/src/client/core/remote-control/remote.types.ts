import type { StateTransition } from '@professor-connect/services/state-machine';
import type {
  EventType,
  RemoteControlAuthorizationPayload,
  RemoteControlFailedPayload,
  RemoteControlReferencePayload,
  RemoteControlRequestPayload,
  SocketMessage,
} from '@professor-connect/protocol';

import type {
  WebRtcClock,
  WebRtcLogger,
  WebRtcMessageIdFactory,
} from '../../../modules/webrtc/webrtc.types.js';

export enum RemoteControlState {
  IDLE = 'IDLE',
  REQUESTED = 'REQUESTED',
  AUTHORIZED = 'AUTHORIZED',
  ACTIVE = 'ACTIVE',
  STOPPING = 'STOPPING',
  STOPPED = 'STOPPED',
  DENIED = 'DENIED',
  EXPIRED = 'EXPIRED',
  FAILED = 'FAILED',
}

export enum RemoteCommandType {
  MOUSE_MOVE = 'MouseMove',
  MOUSE_DOWN = 'MouseDown',
  MOUSE_UP = 'MouseUp',
  MOUSE_WHEEL = 'MouseWheel',
  KEY_DOWN = 'KeyDown',
  KEY_UP = 'KeyUp',
}

export enum RemoteMouseButton {
  LEFT = 'LEFT',
  MIDDLE = 'MIDDLE',
  RIGHT = 'RIGHT',
}

export interface MouseMovePayload {
  readonly x: number;
  readonly y: number;
}

export interface MouseButtonPayload {
  readonly button: RemoteMouseButton;
}

export interface MouseWheelPayload {
  readonly deltaX: number;
  readonly deltaY: number;
}

export interface KeyCommandPayload {
  readonly code: string;
  readonly key: string;
  readonly repeat: boolean;
}

export interface RemoteCommandBase<TType extends RemoteCommandType, TPayload> {
  readonly commandId: string;
  readonly type: TType;
  readonly timestamp: string;
  readonly payload: TPayload;
}

export interface MouseMoveCommand {
  readonly commandId: string;
  readonly type: RemoteCommandType.MOUSE_MOVE;
  readonly timestamp: string;
  readonly payload: MouseMovePayload;
}

export interface MouseDownCommand {
  readonly commandId: string;
  readonly type: RemoteCommandType.MOUSE_DOWN;
  readonly timestamp: string;
  readonly payload: MouseButtonPayload;
}

export interface MouseUpCommand {
  readonly commandId: string;
  readonly type: RemoteCommandType.MOUSE_UP;
  readonly timestamp: string;
  readonly payload: MouseButtonPayload;
}

export interface MouseWheelCommand {
  readonly commandId: string;
  readonly type: RemoteCommandType.MOUSE_WHEEL;
  readonly timestamp: string;
  readonly payload: MouseWheelPayload;
}

export interface KeyDownCommand {
  readonly commandId: string;
  readonly type: RemoteCommandType.KEY_DOWN;
  readonly timestamp: string;
  readonly payload: KeyCommandPayload;
}

export interface KeyUpCommand {
  readonly commandId: string;
  readonly type: RemoteCommandType.KEY_UP;
  readonly timestamp: string;
  readonly payload: KeyCommandPayload;
}

export type RemoteCommand =
  | MouseMoveCommand
  | MouseDownCommand
  | MouseUpCommand
  | MouseWheelCommand
  | KeyDownCommand
  | KeyUpCommand;

export interface RemoteCommandTransportPayload {
  readonly authorizationId: string;
  readonly command: string;
}

export interface RemoteControlContext {
  readonly callId: string;
  readonly sessionId: string;
  readonly authorizationId: string;
  readonly durationMs: number;
  readonly expiresAt?: string;
}

export type PermissionTimerHandle = ReturnType<typeof setTimeout>;
export interface PermissionScheduler {
  schedule(action: () => void, delayMs: number): PermissionTimerHandle;
  cancel(handle: PermissionTimerHandle): void;
}

export type RemoteControlStateListener = (transition: StateTransition<RemoteControlState>) => void;
export type PermissionExpiredListener = (context: RemoteControlContext) => void;

export interface PermissionManagerPort {
  request(context: RemoteControlContext): void;
  authorize(expiresAt: string): void;
  deny(): void;
  activate(): void;
  revoke(): void;
  stop(): void;
  expireRemote(): void;
  fail(): void;
  isAuthorized(): boolean;
  getContext(): RemoteControlContext | undefined;
  getState(): RemoteControlState;
  getStateHistory(): readonly StateTransition<RemoteControlState>[];
  onStateChanged(listener: RemoteControlStateListener): () => void;
  onExpired(listener: PermissionExpiredListener): () => void;
}

export interface RemoteCommandExecutorPort {
  execute(command: RemoteCommand): Promise<void> | void;
}

export interface CommandDispatcherPort {
  serialize(command: RemoteCommand): string;
  deserialize(serialized: string): RemoteCommand;
  dispatch(serialized: string): Promise<RemoteCommand>;
}

export interface RemoteControlDataChannelPort {
  isOpen(callId: string): boolean;
  sendEvent<TPayload>(callId: string, event: EventType, payload: TPayload): SocketMessage<TPayload>;
  onEvent(listener: (callId: string, message: SocketMessage<unknown>) => void): () => void;
}

export interface RemoteControlManagerPort {
  start(): void;
  stop(): void;
  expireRemote(): void;
  fail(): void;
  sendCommand(command: RemoteCommand): SocketMessage<RemoteCommandTransportPayload>;
  getState(): RemoteControlState;
}

export interface RemoteControlSignalingPort {
  sendRequest(message: SocketMessage<RemoteControlRequestPayload>): Promise<void> | void;
  sendAccept(message: SocketMessage<RemoteControlAuthorizationPayload>): Promise<void> | void;
  sendDeny(message: SocketMessage<RemoteControlReferencePayload>): Promise<void> | void;
  sendStarted(message: SocketMessage<RemoteControlReferencePayload>): Promise<void> | void;
  sendStopped(message: SocketMessage<RemoteControlReferencePayload>): Promise<void> | void;
  sendExpired(message: SocketMessage<RemoteControlReferencePayload>): Promise<void> | void;
  sendFailed(message: SocketMessage<RemoteControlFailedPayload>): Promise<void> | void;
}

export interface RemoteControlServiceOptions {
  readonly logger?: WebRtcLogger;
  readonly clock?: WebRtcClock;
  readonly messageIdFactory?: WebRtcMessageIdFactory;
}

export interface RemoteControlServicePort {
  request(callId: string, sessionId: string, durationMs?: number): Promise<void>;
  receiveRequest(message: SocketMessage<RemoteControlRequestPayload>): void;
  accept(): Promise<void>;
  receiveAccept(message: SocketMessage<RemoteControlAuthorizationPayload>): Promise<void>;
  deny(): Promise<void>;
  receiveDeny(message: SocketMessage<RemoteControlReferencePayload>): void;
  receiveStarted(message: SocketMessage<RemoteControlReferencePayload>): void;
  stop(): Promise<void>;
  revoke(): Promise<void>;
  receiveStopped(message: SocketMessage<RemoteControlReferencePayload>): void;
  receiveExpired(message: SocketMessage<RemoteControlReferencePayload>): void;
  receiveFailed(message: SocketMessage<RemoteControlFailedPayload>): void;
  sendCommand(command: RemoteCommand): SocketMessage<RemoteCommandTransportPayload>;
  getState(): RemoteControlState;
}

export interface PermissionManagerOptions {
  readonly logger?: WebRtcLogger;
  readonly clock?: WebRtcClock;
  readonly scheduler?: PermissionScheduler;
}
