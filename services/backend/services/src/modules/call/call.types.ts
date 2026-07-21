import type {
  Call,
  CallId,
  EventType,
  RequestId,
  ServiceRequest,
} from '@professor-connect/protocol';

import type { StateMachineLogger } from '../../core/state-machine/state-machine.types.js';

export type CallClock = () => Date;
export type CallIdFactory = () => CallId;

export interface CallCreation {
  readonly requestId: RequestId;
  readonly sessionId?: string;
  readonly studentId: string;
  readonly teacherId: string;
}

export interface CallManagerOptions {
  readonly clock?: CallClock;
  readonly idFactory?: CallIdFactory;
  readonly stateMachineLogger?: StateMachineLogger;
}

export interface AcceptedRequestReader {
  findRequest(requestId: RequestId): ServiceRequest | undefined;
}

export interface CallLogger {
  info(message: string, context?: Readonly<Record<string, unknown>>): void;
  error(message: string, error: unknown): void;
}

export type CallLifecycleEventType =
  | EventType.CALL_CREATED
  | EventType.CALL_CONNECTING
  | EventType.CALL_CONNECTED
  | EventType.CALL_FINISHED
  | EventType.CALL_CANCELLED
  | EventType.CALL_FAILED;

export interface CallLifecycleEvent {
  readonly event: CallLifecycleEventType;
  readonly call: Call;
}

export type CallLifecycleListener = (event: CallLifecycleEvent) => void;
