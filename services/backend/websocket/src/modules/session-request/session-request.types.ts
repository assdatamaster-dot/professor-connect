export type SessionRequestStatus = 'pending' | 'accepted' | 'rejected' | 'expired' | 'cancelled';

export interface SessionRequest {
  readonly requestId: string;
  readonly studentId: string;
  readonly studentName: string;
  readonly teacherId: string;
  readonly teacherName: string;
  readonly status: SessionRequestStatus;
  readonly createdAt: string;
  readonly queuedAt?: string;
  readonly respondedAt?: string;
}

export interface SessionQueueEntry {
  readonly requestId: string;
  readonly studentId: string;
  readonly studentName: string;
  readonly teacherId: string;
  readonly teacherName: string;
  readonly status: 'waiting';
  readonly position: number;
  readonly studentsAhead: number;
  readonly totalWaiting: number;
  readonly estimatedWaitMinutes: number;
  readonly createdAt: string;
  readonly queuedAt?: string;
  readonly mode: 'direct' | 'queued';
  readonly teacherOnline: boolean;
}

export const ESTIMATED_ATTENDANCE_MINUTES = 3;

export function estimateQueueWaitMinutes(position: number): number {
  return Math.max(1, position) * ESTIMATED_ATTENDANCE_MINUTES;
}

export interface SessionRequestDelivery {
  readonly request: SessionRequest;
  readonly studentSocketId: string | undefined;
  readonly teacherSocketId: string | undefined;
  readonly queue?: SessionQueueEntry;
}

export interface SessionRequestManagerOptions {
  readonly clock?: () => Date;
  readonly idFactory?: () => string;
  readonly timeoutMs?: number;
  readonly scheduler?: (task: () => void, timeoutMs: number) => NodeJS.Timeout;
  readonly persistence?: SessionRequestPersistence;
  readonly audit?: AuditPersistence;
  readonly initialHistory?: readonly SessionRequest[];
}

export type SessionRequestExpirationHandler = (delivery: SessionRequestDelivery) => void;
export type SessionQueueChangedHandler = (
  teacherId: string,
  queue: readonly SessionQueueEntry[],
) => void;
import type {
  AuditPersistence,
  SessionRequestPersistence,
} from '../../persistence/persistence.types.js';
