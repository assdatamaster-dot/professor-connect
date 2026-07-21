import { EventType } from '@professor-connect/protocol';

export const HEARTBEAT_EVENTS = {
  ping: EventType.HEARTBEAT_PING,
  pong: EventType.HEARTBEAT_PONG,
  timeout: EventType.CONNECTION_TIMEOUT,
  lost: EventType.CONNECTION_LOST,
  recovered: EventType.CONNECTION_RECOVERED,
} as const;
