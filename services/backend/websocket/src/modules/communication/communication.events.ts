import { EventType } from '@professor-connect/protocol';

export const COMMUNICATION_EVENTS = {
  connection: EventType.CONNECTION,
  disconnect: EventType.DISCONNECT,
  ping: EventType.COMMUNICATION_PING,
  pong: EventType.COMMUNICATION_PONG,
} as const;
