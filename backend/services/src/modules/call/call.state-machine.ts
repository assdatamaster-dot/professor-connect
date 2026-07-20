import { CallStatus, type CallId } from '@professor-connect/shared-types';

import { StateMachine } from '../../core/state-machine/state-machine.js';
import type { StateTransition } from '../../core/state-machine/state-transition.js';
import type {
  StateMachineClock,
  StateMachineLogger,
  StateTransitionDefinition,
  StateTransitionListener,
} from '../../core/state-machine/state-machine.types.js';

export const CALL_STATE_TRANSITIONS: readonly StateTransitionDefinition<CallStatus>[] = [
  { from: CallStatus.CREATED, to: CallStatus.CONNECTING },
  { from: CallStatus.CREATED, to: CallStatus.CANCELLED },
  { from: CallStatus.CREATED, to: CallStatus.FAILED },
  { from: CallStatus.CONNECTING, to: CallStatus.CONNECTED },
  { from: CallStatus.CONNECTING, to: CallStatus.FAILED },
  { from: CallStatus.CONNECTING, to: CallStatus.CANCELLED },
  { from: CallStatus.CONNECTED, to: CallStatus.FINISHED },
];

export interface CallStateMachineOptions {
  readonly clock?: StateMachineClock;
  readonly logger?: StateMachineLogger;
}

export class CallStateMachine {
  private readonly stateMachine: StateMachine<CallStatus>;

  public constructor(
    callId: CallId,
    initialState = CallStatus.CREATED,
    options: CallStateMachineOptions = {},
  ) {
    this.stateMachine = new StateMachine(initialState, CALL_STATE_TRANSITIONS, {
      ...options,
      context: { entity: 'Call', callId },
    });
  }

  public start(): StateTransition<CallStatus> {
    return this.stateMachine.transitionTo(CallStatus.CONNECTING);
  }

  public connect(): StateTransition<CallStatus> {
    return this.stateMachine.transitionTo(CallStatus.CONNECTED);
  }

  public finish(): StateTransition<CallStatus> {
    return this.stateMachine.transitionTo(CallStatus.FINISHED);
  }

  public fail(): StateTransition<CallStatus> {
    return this.stateMachine.transitionTo(CallStatus.FAILED);
  }

  public cancel(): StateTransition<CallStatus> {
    return this.stateMachine.transitionTo(CallStatus.CANCELLED);
  }

  public transitionTo(status: CallStatus): StateTransition<CallStatus> {
    return this.stateMachine.transitionTo(status);
  }

  public canTransitionTo(status: CallStatus): boolean {
    return this.stateMachine.canTransitionTo(status);
  }

  public getCurrentState(): CallStatus {
    return this.stateMachine.getCurrentState();
  }

  public getHistory(): readonly StateTransition<CallStatus>[] {
    return this.stateMachine.getHistory();
  }

  public onTransition(listener: StateTransitionListener<CallStatus>): () => void {
    return this.stateMachine.onTransition(listener);
  }
}
