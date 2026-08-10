import type {
  RemoteControlKeyboardEvent,
  RemoteControlMouseEvent,
  TeacherRemoteControlSnapshot,
} from './remote-control-contracts.js';

export enum ProfessorPresenceStatus {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  RECONNECTING = 'RECONNECTING',
  RECOVERING = 'RECOVERING',
  RECOVERY_AVAILABLE = 'RECOVERY_AVAILABLE',
  ERROR = 'ERROR',
}

export interface ProfessorPresenceSnapshot {
  readonly professorName: string | undefined;
  readonly status: ProfessorPresenceStatus;
  readonly serverConnected: boolean;
  readonly available: boolean;
  readonly availableSince: string | undefined;
  readonly sessionRequests: readonly ProfessorSessionRequest[];
  readonly onlineStudents: readonly OperationalStudentPresence[];
  readonly activeSession: ProfessorActiveSession | undefined;
  readonly sessionNotice: string | undefined;
  readonly remoteControl: TeacherRemoteControlSnapshot;
  readonly recoverableSession?: {
    readonly sessionId: string;
    readonly studentName: string;
    readonly recoveryDeadline?: string;
  };
  readonly latencyMs: number | undefined;
}

export interface OperationalStudentPresence {
  readonly id: string;
  readonly name: string;
  readonly connectionStatus: 'online' | 'reconnecting';
  readonly attendanceStatus: 'available' | 'waiting' | 'in_attendance';
  readonly onlineSince: string;
  readonly lastHeartbeat: string;
  readonly requestId?: string;
  readonly position?: number;
  readonly queuedAt?: string;
  readonly sessionId?: string;
  readonly attendanceStartedAt?: string;
}

export interface ProfessorSessionRequest {
  readonly requestId: string;
  readonly studentId: string;
  readonly studentName: string;
  readonly createdAt: string;
  readonly queuedAt?: string;
  readonly position: number;
  readonly mode: 'direct' | 'queued';
}

export interface ProfessorActiveSession {
  readonly sessionId: string;
  readonly requestId?: string;
  readonly teacherId: string;
  readonly teacherName: string;
  readonly studentId: string;
  readonly studentName: string;
  readonly state?: 'CONNECTED' | 'RECONNECTING' | 'RECOVERING' | 'FINISHED';
  readonly recoveryDeadline?: string;
  readonly recoveryToken?: string;
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

export type ProfessorPresenceListener = (snapshot: ProfessorPresenceSnapshot) => void;

export interface ProfessorPresenceApi {
  connect(name: string): Promise<ProfessorPresenceSnapshot>;
  disconnect(): Promise<ProfessorPresenceSnapshot>;
  setAvailability(available: boolean): Promise<ProfessorPresenceSnapshot>;
  getState(): Promise<ProfessorPresenceSnapshot>;
  getHistory(): Promise<readonly AttendanceHistoryItem[]>;
  acceptSession(requestId: string): Promise<ProfessorPresenceSnapshot>;
  rejectSession(requestId: string): Promise<ProfessorPresenceSnapshot>;
  endSession(): Promise<ProfessorPresenceSnapshot>;
  resumeSession(): Promise<ProfessorPresenceSnapshot>;
  discardRecovery(): Promise<ProfessorPresenceSnapshot>;
  requestRemoteControl(): Promise<ProfessorPresenceSnapshot>;
  sendRemoteControlMouse(event: RemoteControlMouseEvent): Promise<void>;
  sendRemoteControlKeyboard(event: RemoteControlKeyboardEvent): Promise<void>;
  stopRemoteControl(): Promise<ProfessorPresenceSnapshot>;
  onStateChanged(listener: ProfessorPresenceListener): () => void;
}
