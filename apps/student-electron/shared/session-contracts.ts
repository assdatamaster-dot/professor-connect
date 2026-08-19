export interface OnlineTeacher {
  readonly id: string;
  readonly name: string;
  readonly status: 'available' | 'busy';
  readonly availableSince: string;
  readonly avatarUrl?: string;
}

export type ProfessorAvailabilityStatus = 'OFFLINE' | 'BUSY' | 'AVAILABLE';

export interface ProfessorAvailabilitySnapshot {
  readonly status: ProfessorAvailabilityStatus;
  readonly online: number;
  readonly available: number;
  readonly busy: number;
  readonly queueEnabled: boolean;
  readonly queuePosition?: number;
  readonly studentsAhead?: number;
  readonly estimatedWaitMinutes?: number;
}

export interface AttendanceHistoryItem {
  readonly requestId: string;
  readonly sessionId: string | null;
  readonly professor: { readonly id: string; readonly name: string };
  readonly student: { readonly id: string; readonly name: string };
  readonly requestedAt: string;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly durationSeconds: number | null;
  readonly status: string;
}

export type StudentSessionRequestStatus =
  | 'idle'
  | 'waiting'
  | 'accepted'
  | 'rejected'
  | 'cancelled'
  | 'timeout'
  | 'connected'
  | 'reconnecting'
  | 'recovering'
  | 'recovery-available'
  | 'disconnected'
  | 'ended';

export interface StudentSessionSnapshot {
  readonly status: StudentSessionRequestStatus;
  readonly message: string;
  readonly activeSessionId: string | undefined;
  readonly activeTeacherName: string | undefined;
  readonly pendingRequestId: string | undefined;
  readonly queuePosition: number | undefined;
  readonly studentsAhead: number | undefined;
  readonly totalWaiting: number | undefined;
  readonly estimatedWaitMinutes: number | undefined;
  readonly queuedAt: string | undefined;
  readonly teacherOnline: boolean | undefined;
  readonly queueMode: 'direct' | 'queued' | undefined;
  readonly recoveryDeadline?: string;
  readonly latencyMs: number | undefined;
  readonly availability: ProfessorAvailabilitySnapshot;
  readonly remoteControl: StudentRemoteControlSnapshot;
}

export type StudentSessionListener = (snapshot: StudentSessionSnapshot) => void;
export type AvailableTeachersListener = (teachers: readonly OnlineTeacher[]) => void;

export interface StudentSessionApi {
  getOnlineTeachers(): Promise<readonly OnlineTeacher[]>;
  getHistory(): Promise<readonly AttendanceHistoryItem[]>;
  requestSession(teacherId: string): Promise<StudentSessionSnapshot>;
  cancelRequest(): Promise<StudentSessionSnapshot>;
  getState(): Promise<StudentSessionSnapshot>;
  endSession(): Promise<StudentSessionSnapshot>;
  resumeSession(): Promise<StudentSessionSnapshot>;
  discardRecovery(): Promise<StudentSessionSnapshot>;
  approveRemoteControl(): Promise<StudentSessionSnapshot>;
  denyRemoteControl(): Promise<StudentSessionSnapshot>;
  stopRemoteControl(): Promise<StudentSessionSnapshot>;
  onStateChanged(listener: StudentSessionListener): () => void;
  onAvailableTeachersChanged(listener: AvailableTeachersListener): () => void;
}
import type { StudentRemoteControlSnapshot } from './remote-control-contracts.js';
