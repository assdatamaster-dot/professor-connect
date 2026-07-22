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
}

export type ProfessorPresenceListener = (snapshot: ProfessorPresenceSnapshot) => void;

export interface ProfessorPresenceApi {
  connect(name: string): Promise<ProfessorPresenceSnapshot>;
  disconnect(): Promise<ProfessorPresenceSnapshot>;
  getState(): Promise<ProfessorPresenceSnapshot>;
  onStateChanged(listener: ProfessorPresenceListener): () => void;
}
