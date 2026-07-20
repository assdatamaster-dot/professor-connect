export class InvalidStateTransitionError<TState extends string> extends Error {
  public readonly code = 'INVALID_STATE_TRANSITION';

  public constructor(
    public readonly previousState: TState,
    public readonly nextState: TState,
  ) {
    super(`Transição de estado inválida: ${previousState} → ${nextState}`);
    this.name = 'InvalidStateTransitionError';
  }
}
