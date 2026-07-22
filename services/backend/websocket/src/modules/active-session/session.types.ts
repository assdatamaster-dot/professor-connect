export type SessionStatus = 'active' | 'finished';

export interface AttendanceSession {
  readonly sessionId: string;
  readonly requestId: string;
  readonly teacherId: string;
  readonly teacherName: string;
  readonly studentId: string;
  readonly studentName: string;
  readonly createdAt: string;
  readonly status: SessionStatus;
}

export interface SessionDelivery {
  readonly session: AttendanceSession;
  readonly teacherSocketId: string | undefined;
  readonly studentSocketId: string | undefined;
}

export interface SessionManagerOptions {
  readonly clock?: () => Date;
  readonly idFactory?: () => string;
}
