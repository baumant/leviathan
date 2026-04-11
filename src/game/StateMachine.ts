export interface StateDefinition {
  enter?: () => void;
  update: (deltaSeconds: number) => void;
  exit?: () => void;
}

export class StateMachine<TState extends string> {
  private readonly states = new Map<TState, StateDefinition>();
  private currentState?: StateDefinition;
  private currentStateId?: TState;

  add(stateId: TState, definition: StateDefinition): void {
    this.states.set(stateId, definition);
  }

  change(stateId: TState): void {
    if (this.currentStateId === stateId) {
      return;
    }

    this.currentState?.exit?.();
    this.currentStateId = stateId;
    this.currentState = this.states.get(stateId);

    if (!this.currentState) {
      throw new Error(`Unknown state: ${stateId}`);
    }

    this.currentState.enter?.();
  }

  update(deltaSeconds: number): void {
    this.currentState?.update(deltaSeconds);
  }

  get current(): TState | undefined {
    return this.currentStateId;
  }
}
