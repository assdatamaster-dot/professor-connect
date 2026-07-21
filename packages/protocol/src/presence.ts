export enum PresenceStatus {
  ONLINE = 'ONLINE',
  AVAILABLE = 'AVAILABLE',
  BUSY = 'BUSY',
  OFFLINE = 'OFFLINE',
}

export enum ClientRole {
  STUDENT = 'STUDENT',
  TEACHER = 'TEACHER',
}

export interface ClientPresence {
  readonly clientId: string;
  readonly connectionId: string;
  readonly displayName: string;
  readonly role: ClientRole;
  readonly status: PresenceStatus;
  readonly lastSeen: string;
}

export interface PresenceRegisterPayload {
  readonly clientId: string;
  readonly displayName: string;
  readonly role: ClientRole;
}

export interface PresenceUpdatePayload {
  readonly status: PresenceStatus;
}

export type PresenceQueryPayload = Record<never, never>;

export interface PresenceListPayload {
  readonly clients: readonly ClientPresence[];
}
