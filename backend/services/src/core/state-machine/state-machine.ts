import { InvalidStateTransitionError } from './state-machine.errors.js';
import { StateTransition } from './state-transition.js';
import type {
  StateMachineLogger,
  StateMachineOptions,
  StateTransitionDefinition,
  StateTransitionListener,
} from './state-machine.types.js';

const silentLogger: StateMachineLogger = {
  info(): void {},
  error(): void {},
};

export class StateMachine<TState extends string> {
  private readonly allowedTargetsByState = new Map<TState, ReadonlySet<TState>>();
  private readonly history: StateTransition<TState>[] = [];
  private readonly listeners = new Set<StateTransitionListener<TState>>();
  private readonly clock: () => Date;
  private readonly logger: StateMachineLogger;
  private readonly context: Readonly<Record<string, unknown>>;
  private currentState: TState;

  public constructor(
    initialState: TState,
    allowedTransitions: readonly StateTransitionDefinition<TState>[],
    options: StateMachineOptions = {},
  ) {
    this.currentState = initialState;
    this.clock = options.clock ?? (() => new Date());
    this.logger = options.logger ?? silentLogger;
    this.context = options.context ?? {};
    this.indexTransitions(allowedTransitions);
  }

  public getCurrentState(): TState {
    return this.currentState;
  }

  public canTransitionTo(nextState: TState): boolean {
    return this.allowedTargetsByState.get(this.currentState)?.has(nextState) ?? false;
  }

  public transitionTo(nextState: TState): StateTransition<TState> {
    const previousState = this.currentState;

    if (!this.canTransitionTo(nextState)) {
      const error = new InvalidStateTransitionError(previousState, nextState);
      const context = { ...this.context, previousState, nextState };

      this.logger.info('Tentativa inválida', context);
      this.logger.error('Erro de transição', error);
      throw error;
    }

    const transition = new StateTransition(previousState, nextState, this.clock().toISOString());

    this.currentState = nextState;
    this.history.push(transition);
    this.logger.info('Mudança de estado', {
      ...this.context,
      previousState,
      nextState,
      timestamp: transition.timestamp,
    });
    this.emitTransition(transition);

    return transition;
  }

  public getHistory(): readonly StateTransition<TState>[] {
    return [...this.history];
  }

  public onTransition(listener: StateTransitionListener<TState>): () => void {
    this.listeners.add(listener);

    return () => this.listeners.delete(listener);
  }

  private indexTransitions(allowedTransitions: readonly StateTransitionDefinition<TState>[]): void {
    const mutableTargetsByState = new Map<TState, Set<TState>>();

    for (const transition of allowedTransitions) {
      const targets = mutableTargetsByState.get(transition.from) ?? new Set<TState>();

      targets.add(transition.to);
      mutableTargetsByState.set(transition.from, targets);
    }

    for (const [state, targets] of mutableTargetsByState) {
      this.allowedTargetsByState.set(state, targets);
    }
  }

  private emitTransition(transition: StateTransition<TState>): void {
    for (const listener of this.listeners) {
      try {
        listener(transition);
      } catch (error) {
        this.logger.error('Erro ao emitir evento de mudança de estado', error);
      }
    }
  }
}
