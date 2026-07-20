import type { RequestId, ServiceRequest } from '@professor-connect/shared-types';

import type { StateMachineLogger } from '../../core/state-machine/state-machine.types.js';

export type RequestClock = () => Date;
export type RequestIdFactory = () => RequestId;

export interface ScheduledRequestTask {
  cancel(): void;
}

export type RequestScheduler = (
  task: () => void,
  delayMilliseconds: number,
) => ScheduledRequestTask;

export interface RequestDelivery {
  readonly request: ServiceRequest;
  readonly studentConnectionId: string | undefined;
  readonly teacherConnectionIds: readonly string[];
}

export interface RequestRejection {
  readonly request: ServiceRequest;
  readonly teacherId: string;
  readonly teacherConnectionId: string;
}

export type RequestExpirationHandler = (delivery: RequestDelivery) => void;

export interface RequestManagerOptions {
  readonly clock?: RequestClock;
  readonly idFactory?: RequestIdFactory;
  readonly stateMachineLogger?: StateMachineLogger;
}
