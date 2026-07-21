import type { ClientRole } from '@professor-connect/protocol';

export type PresenceClock = () => Date;

export interface PresenceRegistration {
  readonly clientId: string;
  readonly connectionId: string;
  readonly displayName: string;
  readonly role: ClientRole;
}
