import type { RequestId } from './request.js';

export type CallId = string;

export enum CallStatus {
  CREATED = 'CREATED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  FINISHED = 'FINISHED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export interface Call {
  readonly callId: CallId;
  readonly requestId: RequestId;
  readonly sessionId?: string;
  readonly studentId: string;
  readonly teacherId: string;
  readonly status: CallStatus;
  readonly createdAt: string;
  readonly connectedAt?: string;
  readonly finishedAt?: string;
}

export interface CallCreatePayload {
  readonly requestId: RequestId;
  readonly sessionId?: string;
}

export interface CallReferencePayload {
  readonly callId: CallId;
}

export interface CallPayload {
  readonly call: Call;
}
