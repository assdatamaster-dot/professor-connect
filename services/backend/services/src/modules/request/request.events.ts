import { EventType } from '@professor-connect/protocol';

export const REQUEST_EVENTS = {
  create: EventType.REQUEST_CREATE,
  created: EventType.REQUEST_CREATED,
  received: EventType.REQUEST_RECEIVED,
  accept: EventType.REQUEST_ACCEPT,
  accepted: EventType.REQUEST_ACCEPTED,
  reject: EventType.REQUEST_REJECT,
  rejected: EventType.REQUEST_REJECTED,
  cancel: EventType.REQUEST_CANCEL,
  cancelled: EventType.REQUEST_CANCELLED,
  expired: EventType.REQUEST_EXPIRED,
} as const;
