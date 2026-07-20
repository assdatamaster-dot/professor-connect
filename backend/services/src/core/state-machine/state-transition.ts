export class StateTransition<TState extends string> {
  public constructor(
    public readonly previousState: TState,
    public readonly nextState: TState,
    public readonly timestamp: string,
  ) {}
}
