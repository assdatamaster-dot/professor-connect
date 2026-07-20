import { EventType } from '@professor-connect/shared-types';

export const SESSION_EVENTS = {
  create: EventType.SESSION_CREATE,
  created: EventType.SESSION_CREATED,
  join: EventType.SESSION_JOIN,
  leave: EventType.SESSION_LEAVE,
  close: EventType.SESSION_CLOSE,
  closed: EventType.SESSION_CLOSED,
} as const;
