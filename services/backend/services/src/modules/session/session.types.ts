import type { Session } from '@professor-connect/protocol';

export type SessionIdFactory = () => string;
export type SessionClock = () => Date;

export interface ClientSessionChange {
  readonly session: Session;
  readonly clientId: string;
}
