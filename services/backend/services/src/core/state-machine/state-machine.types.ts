import type { StateTransition } from './state-transition.js';

export interface StateTransitionDefinition<TState extends string> {
  readonly from: TState;
  readonly to: TState;
}

export type StateMachineClock = () => Date;

export interface StateMachineLogger {
  info(message: string, context?: Readonly<Record<string, unknown>>): void;
  error(message: string, error: unknown): void;
}

export type StateTransitionListener<TState extends string> = (
  transition: StateTransition<TState>,
) => void;

export interface StateMachineOptions {
  readonly clock?: StateMachineClock;
  readonly logger?: StateMachineLogger;
  readonly context?: Readonly<Record<string, unknown>>;
}
