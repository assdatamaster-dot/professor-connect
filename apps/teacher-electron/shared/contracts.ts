export enum TeacherConnectionStatus {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR',
}

export enum TeacherAttendanceStatus {
  IDLE = 'IDLE',
  AVAILABLE = 'AVAILABLE',
  REQUEST_PENDING = 'REQUEST_PENDING',
  PREPARING = 'PREPARING',
  ACTIVE = 'ACTIVE',
  ENDING = 'ENDING',
  ENDED = 'ENDED',
  ERROR = 'ERROR',
}

export enum TeacherStudentStatus {
  ONLINE = 'ONLINE',
  AVAILABLE = 'AVAILABLE',
  BUSY = 'BUSY',
}

export enum TeacherRequestStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
}

export enum TeacherActionStatus {
  IDLE = 'IDLE',
  REQUESTED = 'REQUESTED',
  AUTHORIZED = 'AUTHORIZED',
}

export enum TeacherLogCategory {
  CONNECTION = 'CONNECTION',
  REQUEST = 'REQUEST',
  CALL = 'CALL',
  VIDEO = 'VIDEO',
  SCREEN = 'SCREEN',
  REMOTE = 'REMOTE',
  ERROR = 'ERROR',
}

export enum TeacherLogLevel {
  INFO = 'INFO',
  ERROR = 'ERROR',
}

export interface TeacherStudent {
  readonly studentId: string;
  readonly displayName: string;
  readonly status: TeacherStudentStatus;
}

export interface TeacherAttendanceRequest {
  readonly requestId: string;
  readonly studentId: string;
  readonly studentName: string;
  readonly createdAt: string;
  readonly status: TeacherRequestStatus;
}

export interface TeacherLogEntry {
  readonly id: string;
  readonly timestamp: string;
  readonly category: TeacherLogCategory;
  readonly level: TeacherLogLevel;
  readonly message: string;
}

export interface TeacherWorkflowSnapshot {
  readonly connectionStatus: TeacherConnectionStatus;
  readonly attendanceStatus: TeacherAttendanceStatus;
  readonly screenSharingStatus: TeacherActionStatus;
  readonly remoteControlStatus: TeacherActionStatus;
  readonly statusMessage: string;
  readonly activeStudentName: string | undefined;
  readonly onlineStudents: readonly TeacherStudent[];
  readonly requests: readonly TeacherAttendanceRequest[];
  readonly isMediaVisible: boolean;
  readonly canAcceptRequests: boolean;
  readonly canRequestScreenSharing: boolean;
  readonly canRequestRemoteControl: boolean;
  readonly canEndAttendance: boolean;
  readonly logs: readonly TeacherLogEntry[];
}

export type TeacherStateListener = (snapshot: TeacherWorkflowSnapshot) => void;

export interface TeacherWorkflowApi {
  initialize(): Promise<TeacherWorkflowSnapshot>;
  acceptRequest(requestId: string): Promise<TeacherWorkflowSnapshot>;
  rejectRequest(requestId: string): Promise<TeacherWorkflowSnapshot>;
  requestScreenSharing(): Promise<TeacherWorkflowSnapshot>;
  requestRemoteControl(): Promise<TeacherWorkflowSnapshot>;
  endAttendance(): Promise<TeacherWorkflowSnapshot>;
  onStateChanged(listener: TeacherStateListener): () => void;
}
