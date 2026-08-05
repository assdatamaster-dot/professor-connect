import type { AttendanceSession } from '../modules/active-session/session.types.js';
import type { Professor } from '../modules/professor-presence/presence.manager.js';
import type { SessionRequest } from '../modules/session-request/session-request.types.js';
import type { OnlineStudent } from '../modules/student-presence/student-presence.manager.js';

export interface ProfessorPersistence {
  saveProfessor(professor: Professor): void;
  updateAvailability(
    professorId: string,
    availability: Professor['availability'],
    availableSince: Date | undefined,
  ): void;
  updateHeartbeat(socketId: string, at: Date): void;
  markOffline(socketId: string, at: Date): void;
}

export interface StudentPersistence {
  saveStudent(student: OnlineStudent): void;
  updateHeartbeat(socketId: string, at: Date): void;
  markOffline(socketId: string, at: Date): void;
}

export interface SessionRequestPersistence {
  saveRequest(request: SessionRequest): void;
}

export interface AttendanceSessionPersistence {
  saveSession(session: AttendanceSession, endReason?: string): void;
  markFeatureUsed(
    sessionId: string,
    feature: 'screen-share' | 'remote-control' | 'file-transfer',
  ): void;
}

export interface AuditPersistence {
  record(record: {
    readonly action: string;
    readonly actorType?: string;
    readonly actorId?: string;
    readonly entityType?: string;
    readonly entityId?: string;
    readonly severity?: 'info' | 'warning' | 'error';
    readonly metadata?: Readonly<Record<string, unknown>>;
  }): void;
}

export interface FileTransferPersistence {
  save(transfer: {
    readonly id: string;
    readonly sessionId: string;
    readonly direction: 'teacher-to-student' | 'student-to-teacher';
    readonly fileName: string;
    readonly byteSize: bigint;
    readonly checksum?: string;
    readonly status: 'completed' | 'rejected' | 'cancelled' | 'failed';
    readonly failureReason?: string;
    readonly startedAt: Date;
    readonly completedAt: Date;
  }): void;
}
