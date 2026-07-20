import type { EventType } from './protocol.js';

export interface SignalOfferPayload {
  readonly callId: string;
  readonly sdp: string;
}

export interface SignalAnswerPayload {
  readonly callId: string;
  readonly sdp: string;
}

export interface SignalIceCandidatePayload {
  readonly callId: string;
  readonly candidate: string;
  readonly sdpMid?: string | null;
  readonly sdpMLineIndex?: number | null;
  readonly usernameFragment?: string | null;
}

export enum SignalErrorCode {
  INVALID_MESSAGE = 'INVALID_MESSAGE',
  SESSION_NOT_FOUND = 'SESSION_NOT_FOUND',
  SESSION_NOT_ACTIVE = 'SESSION_NOT_ACTIVE',
  INVALID_SESSION_CLIENT_COUNT = 'INVALID_SESSION_CLIENT_COUNT',
  CLIENT_NOT_IN_SESSION = 'CLIENT_NOT_IN_SESSION',
  CLIENT_NOT_CONNECTED = 'CLIENT_NOT_CONNECTED',
  CLIENT_PRESENCE_NOT_FOUND = 'CLIENT_PRESENCE_NOT_FOUND',
  CALL_NOT_FOUND = 'CALL_NOT_FOUND',
  CALL_NOT_ACTIVE = 'CALL_NOT_ACTIVE',
  CALL_SESSION_MISMATCH = 'CALL_SESSION_MISMATCH',
  CALL_PARTICIPANT_MISMATCH = 'CALL_PARTICIPANT_MISMATCH',
}

export interface SignalErrorPayload {
  readonly code: SignalErrorCode;
  readonly message: string;
  readonly relatedEvent: EventType;
}
