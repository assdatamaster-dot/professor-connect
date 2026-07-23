export interface RemoteControlReferencePayload {
  readonly callId: string;
  readonly authorizationId: string;
}

export interface RemoteControlRequestPayload extends RemoteControlReferencePayload {
  readonly durationMs: number;
}

export interface RemoteControlAuthorizationPayload extends RemoteControlReferencePayload {
  readonly expiresAt: string;
}

export enum RemoteControlFailureCode {
  INVALID_PERMISSION = 'INVALID_PERMISSION',
  TRANSPORT_FAILED = 'TRANSPORT_FAILED',
  INVALID_COMMAND = 'INVALID_COMMAND',
}

export interface RemoteControlFailedPayload extends RemoteControlReferencePayload {
  readonly code: RemoteControlFailureCode;
  readonly message: string;
}

export const REMOTE_CONTROL_CHANNEL_EVENTS = {
  REQUEST: 'remote-control:request',
  APPROVED: 'remote-control:approved',
  DENIED: 'remote-control:denied',
  MOUSE: 'remote-control:mouse',
  KEYBOARD: 'remote-control:keyboard',
  STOP: 'remote-control:stop',
} as const;

export type RemoteControlChannelEvent =
  (typeof REMOTE_CONTROL_CHANNEL_EVENTS)[keyof typeof REMOTE_CONTROL_CHANNEL_EVENTS];

export interface RemoteControlChannelReference {
  readonly sessionId: string;
  readonly requestId: string;
}

export type RemoteControlRequest = RemoteControlChannelReference;
export type RemoteControlApproved = RemoteControlChannelReference;
export type RemoteControlDenied = RemoteControlChannelReference;

export type RemoteControlMouseEventType =
  'mousemove' | 'mousedown' | 'mouseup' | 'dblclick' | 'wheel';

export interface RemoteControlMouseEvent {
  readonly type: RemoteControlMouseEventType;
  readonly x: number;
  readonly y: number;
  readonly button: number;
  readonly buttons: number;
  readonly deltaX?: number;
  readonly deltaY?: number;
  readonly deltaMode?: number;
}

export interface RemoteControlMousePayload extends RemoteControlChannelReference {
  readonly event: RemoteControlMouseEvent;
}

export type RemoteControlKeyboardEventType = 'keydown' | 'keyup';

export interface RemoteControlKeyboardEvent {
  readonly type: RemoteControlKeyboardEventType;
  readonly key: string;
  readonly code: string;
  readonly repeat: boolean;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
}

export interface RemoteControlKeyboardPayload extends RemoteControlChannelReference {
  readonly event: RemoteControlKeyboardEvent;
}

export interface RemoteControlStopPayload extends RemoteControlChannelReference {
  readonly reason:
    'participant' | 'session-ended' | 'disconnect' | 'focus-lost' | 'execution-error';
}
