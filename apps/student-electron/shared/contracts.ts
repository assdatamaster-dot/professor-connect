export enum DesktopConnectionStatus {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR',
}

export enum DesktopAttendanceStatus {
  IDLE = 'IDLE',
  REQUESTING = 'REQUESTING',
  WAITING = 'WAITING',
  PREPARING = 'PREPARING',
  ACTIVE = 'ACTIVE',
  ENDING = 'ENDING',
  ENDED = 'ENDED',
  ERROR = 'ERROR',
}

export enum DesktopRemoteControlStatus {
  NOT_AUTHORIZED = 'NOT_AUTHORIZED',
  AUTHORIZED = 'AUTHORIZED',
}

export enum DesktopLogCategory {
  CONNECTION = 'CONNECTION',
  REQUEST = 'REQUEST',
  CALL = 'CALL',
  VIDEO = 'VIDEO',
  SCREEN = 'SCREEN',
  ERROR = 'ERROR',
}

export enum DesktopLogLevel {
  INFO = 'INFO',
  ERROR = 'ERROR',
}

export interface DesktopLogEntry {
  readonly id: string;
  readonly timestamp: string;
  readonly category: DesktopLogCategory;
  readonly level: DesktopLogLevel;
  readonly message: string;
}

export interface DesktopWorkflowSnapshot {
  readonly connectionStatus: DesktopConnectionStatus;
  readonly attendanceStatus: DesktopAttendanceStatus;
  readonly remoteControlStatus: DesktopRemoteControlStatus;
  readonly statusMessage: string;
  readonly isMediaVisible: boolean;
  readonly isScreenSharing: boolean;
  readonly canCallProfessor: boolean;
  readonly canShareScreen: boolean;
  readonly canEndAttendance: boolean;
  readonly logs: readonly DesktopLogEntry[];
}

export type DesktopStateListener = (snapshot: DesktopWorkflowSnapshot) => void;

export interface DesktopWorkflowApi {
  initialize(): Promise<DesktopWorkflowSnapshot>;
  callProfessor(): Promise<DesktopWorkflowSnapshot>;
  shareScreen(): Promise<DesktopWorkflowSnapshot>;
  endAttendance(): Promise<DesktopWorkflowSnapshot>;
  onStateChanged(listener: DesktopStateListener): () => void;
}
