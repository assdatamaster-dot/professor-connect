export type SessionRequestStatus = 'pending' | 'accepted' | 'rejected' | 'expired';

export interface SessionRequest {
  readonly requestId: string;
  readonly studentId: string;
  readonly studentName: string;
  readonly teacherId: string;
  readonly teacherName: string;
  readonly status: SessionRequestStatus;
  readonly createdAt: string;
}

export interface SessionRequestDelivery {
  readonly request: SessionRequest;
  readonly studentSocketId: string | undefined;
  readonly teacherSocketId: string | undefined;
}

export interface SessionRequestManagerOptions {
  readonly clock?: () => Date;
  readonly idFactory?: () => string;
  readonly timeoutMs?: number;
  readonly scheduler?: (task: () => void, timeoutMs: number) => NodeJS.Timeout;
}

export type SessionRequestExpirationHandler = (delivery: SessionRequestDelivery) => void;
