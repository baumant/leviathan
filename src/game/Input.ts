const KEY_BINDINGS = {
  forward: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  rise: ['Space'],
  dive: ['ShiftLeft', 'ShiftRight'],
} as const;

export class Input {
  private readonly heldKeys = new Set<string>();

  constructor(target: Window = window) {
    target.addEventListener('keydown', this.handleKeyDown);
    target.addEventListener('keyup', this.handleKeyUp);
    target.addEventListener('blur', this.handleBlur);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);
  }

  get moveAxis(): number {
    return Number(this.anyHeld(KEY_BINDINGS.forward)) - Number(this.anyHeld(KEY_BINDINGS.brake));
  }

  get turnAxis(): number {
    return Number(this.anyHeld(KEY_BINDINGS.right)) - Number(this.anyHeld(KEY_BINDINGS.left));
  }

  get depthAxis(): number {
    return Number(this.anyHeld(KEY_BINDINGS.rise)) - Number(this.anyHeld(KEY_BINDINGS.dive));
  }

  get boostHeld(): boolean {
    return this.anyHeld(KEY_BINDINGS.dive);
  }

  private anyHeld(codes: readonly string[]): boolean {
    return codes.some((code) => this.heldKeys.has(code));
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    this.heldKeys.add(event.code);
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    this.heldKeys.delete(event.code);
  };

  private readonly handleBlur = (): void => {
    this.heldKeys.clear();
  };
}
