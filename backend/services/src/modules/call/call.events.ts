import { EventType } from '@professor-connect/shared-types';

export const CALL_EVENTS = {
  create: EventType.CALL_CREATE,
  created: EventType.CALL_CREATED,
  connecting: EventType.CALL_CONNECTING,
  connected: EventType.CALL_CONNECTED,
  finished: EventType.CALL_FINISHED,
  cancelled: EventType.CALL_CANCELLED,
  failed: EventType.CALL_FAILED,
} as const;
