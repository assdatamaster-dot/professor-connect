import { EventType } from '@professor-connect/shared-types';

export const PRESENCE_EVENTS = {
  register: EventType.PRESENCE_REGISTER,
  update: EventType.PRESENCE_UPDATE,
  online: EventType.PRESENCE_ONLINE,
  offline: EventType.PRESENCE_OFFLINE,
  available: EventType.PRESENCE_AVAILABLE,
  busy: EventType.PRESENCE_BUSY,
} as const;
