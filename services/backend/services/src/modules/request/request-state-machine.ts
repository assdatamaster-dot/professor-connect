import { RequestStatus, type RequestId } from '@professor-connect/protocol';

import { StateMachine } from '../../core/state-machine/state-machine.js';
import type { StateTransition } from '../../core/state-machine/state-transition.js';
import type {
  StateMachineClock,
  StateMachineLogger,
  StateTransitionDefinition,
  StateTransitionListener,
} from '../../core/state-machine/state-machine.types.js';

export const REQUEST_STATE_TRANSITIONS: readonly StateTransitionDefinition<RequestStatus>[] = [
  { from: RequestStatus.PENDING, to: RequestStatus.ACCEPTED },
  { from: RequestStatus.PENDING, to: RequestStatus.REJECTED },
  { from: RequestStatus.PENDING, to: RequestStatus.CANCELLED },
  { from: RequestStatus.PENDING, to: RequestStatus.EXPIRED },
];

export interface RequestStateMachineOptions {
  readonly clock?: StateMachineClock;
  readonly logger?: StateMachineLogger;
}

export class RequestStateMachine {
  private readonly stateMachine: StateMachine<RequestStatus>;

  public constructor(
    requestId: RequestId,
    initialState = RequestStatus.PENDING,
    options: RequestStateMachineOptions = {},
  ) {
    this.stateMachine = new StateMachine(initialState, REQUEST_STATE_TRANSITIONS, {
      ...options,
      context: { entity: 'Request', requestId },
    });
  }

  public accept(): StateTransition<RequestStatus> {
    return this.stateMachine.transitionTo(RequestStatus.ACCEPTED);
  }

  public reject(): StateTransition<RequestStatus> {
    return this.stateMachine.transitionTo(RequestStatus.REJECTED);
  }

  public cancel(): StateTransition<RequestStatus> {
    return this.stateMachine.transitionTo(RequestStatus.CANCELLED);
  }

  public expire(): StateTransition<RequestStatus> {
    return this.stateMachine.transitionTo(RequestStatus.EXPIRED);
  }

  public transitionTo(status: RequestStatus): StateTransition<RequestStatus> {
    return this.stateMachine.transitionTo(status);
  }

  public canTransitionTo(status: RequestStatus): boolean {
    return this.stateMachine.canTransitionTo(status);
  }

  public getCurrentState(): RequestStatus {
    return this.stateMachine.getCurrentState();
  }

  public getHistory(): readonly StateTransition<RequestStatus>[] {
    return this.stateMachine.getHistory();
  }

  public onTransition(listener: StateTransitionListener<RequestStatus>): () => void {
    return this.stateMachine.onTransition(listener);
  }
}
