import type { EventType } from './protocol.js';

export interface SocketMessage<T> {
  readonly id: string;
  readonly event: EventType;
  readonly timestamp: string;
  readonly sessionId?: string;
  readonly payload: T;
}
