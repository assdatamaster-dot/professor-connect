export type RequestId = string;

export enum RequestStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
}

export interface ServiceRequest {
  readonly requestId: RequestId;
  readonly studentId: string;
  readonly teacherId?: string;
  readonly status: RequestStatus;
  readonly createdAt: string;
  readonly acceptedAt?: string;
  readonly expiresAt: string;
}

export type RequestCreatePayload = Record<never, never>;

export interface RequestReferencePayload {
  readonly requestId: RequestId;
}

export interface RequestPayload {
  readonly request: ServiceRequest;
}

export interface RequestRejectedPayload extends RequestPayload {
  readonly teacherId: string;
}
