export type SessionStatus = 'active' | 'finished';

export type SessionConnectionState =
  | 'WAITING'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'RECONNECTING'
  | 'RECOVERING'
  | 'DISCONNECTED'
  | 'FINISHED';

export interface AttendanceSession {
  readonly sessionId: string;
  readonly requestId: string;
  readonly teacherId: string;
  readonly teacherName: string;
  readonly studentId: string;
  readonly studentName: string;
  readonly createdAt: string;
  readonly status: SessionStatus;
  readonly connectionState?: SessionConnectionState;
  readonly stateUpdatedAt?: string;
  readonly recoveryDeadline?: string;
  readonly teacherRecoveryTokenHash?: string;
  readonly studentRecoveryTokenHash?: string;
  readonly lastHeartbeatAt?: string;
  readonly connectedMilliseconds?: number;
  readonly reconnectingMilliseconds?: number;
  readonly disconnectCount?: number;
  readonly endedAt?: string;
  readonly durationSeconds?: number;
  readonly endReason?: string;
}

export interface SessionDelivery {
  readonly session: AttendanceSession;
  readonly teacherSocketId: string | undefined;
  readonly studentSocketId: string | undefined;
  readonly teacherRecoveryToken?: string;
  readonly studentRecoveryToken?: string;
}

export interface SessionManagerOptions {
  readonly clock?: () => Date;
  readonly idFactory?: () => string;
  readonly persistence?: AttendanceSessionPersistence;
  readonly audit?: AuditPersistence;
  readonly initialHistory?: readonly AttendanceSession[];
  readonly recoveryWindowMs?: number;
}

export type SessionParticipantRole = 'teacher' | 'student';

export interface SessionRecoveryResult extends SessionDelivery {
  readonly recoveredRole: SessionParticipantRole;
  readonly recoveryToken: string;
  readonly fullyRecovered: boolean;
}

export interface SessionSignalingRoute {
  readonly session: AttendanceSession;
  readonly recipientSocketId: string;
  readonly senderRole: 'teacher' | 'student';
}

export type SessionEndedListener = (delivery: SessionDelivery) => void;
import type {
  AttendanceSessionPersistence,
  AuditPersistence,
} from '../../persistence/persistence.types.js';
