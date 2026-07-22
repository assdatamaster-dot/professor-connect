export enum ProfessorPresenceStatus {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR',
}

export interface ProfessorPresenceSnapshot {
  readonly professorName: string | undefined;
  readonly status: ProfessorPresenceStatus;
  readonly serverConnected: boolean;
  readonly sessionRequests: readonly ProfessorSessionRequest[];
}

export interface ProfessorSessionRequest {
  readonly requestId: string;
  readonly studentId: string;
  readonly studentName: string;
}

export type ProfessorPresenceListener = (snapshot: ProfessorPresenceSnapshot) => void;

export interface ProfessorPresenceApi {
  connect(name: string): Promise<ProfessorPresenceSnapshot>;
  disconnect(): Promise<ProfessorPresenceSnapshot>;
  getState(): Promise<ProfessorPresenceSnapshot>;
  acceptSession(requestId: string): Promise<ProfessorPresenceSnapshot>;
  rejectSession(requestId: string): Promise<ProfessorPresenceSnapshot>;
  onStateChanged(listener: ProfessorPresenceListener): () => void;
}
