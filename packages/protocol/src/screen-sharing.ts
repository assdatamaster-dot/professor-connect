export interface ScreenShareReferencePayload {
  readonly callId: string;
  readonly requestId: string;
}

export interface ScreenShareRequestPayload {
  readonly callId: string;
  readonly requestId: string;
}

export enum ScreenShareFailureCode {
  CAPTURE_FAILED = 'CAPTURE_FAILED',
  TRACK_REPLACEMENT_FAILED = 'TRACK_REPLACEMENT_FAILED',
}

export interface ScreenShareFailedPayload extends ScreenShareReferencePayload {
  readonly code: ScreenShareFailureCode;
  readonly message: string;
}
