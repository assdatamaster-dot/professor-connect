export interface OnlineTeacher {
  readonly id: string;
  readonly name: string;
  readonly status: 'available';
  readonly availableSince: string;
  readonly avatarUrl?: string;
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
  readonly recoveryDeadline?: string;
  readonly latencyMs: number | undefined;
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
