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
