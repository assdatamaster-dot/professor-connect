import type { ClientRole } from '@professor-connect/shared-types';

export type PresenceClock = () => Date;

export interface PresenceRegistration {
  readonly clientId: string;
  readonly connectionId: string;
  readonly displayName: string;
  readonly role: ClientRole;
}
