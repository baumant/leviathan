const KEY_BINDINGS = {
  forward: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  rise: ['Space'],
  dive: ['ShiftLeft', 'ShiftRight'],
  tailSlap: ['KeyF'],
  restart: ['KeyR'],
  skip: ['Enter'],
} as const;

const BOUND_CODES = new Set<string>(Object.values(KEY_BINDINGS).flat());

export class Input {
  private readonly heldKeys = new Set<string>();
  private restartRequested = false;
  private skipRequested = false;
  private tailSlapRequested = false;

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

  consumeTailSlapPressed(): boolean {
    if (!this.tailSlapRequested) {
      return false;
    }

    this.tailSlapRequested = false;
    return true;
  }

  consumeRestartRequested(): boolean {
    if (!this.restartRequested) {
      return false;
    }

    this.restartRequested = false;
    return true;
  }

  consumeSkipRequested(): boolean {
    if (!this.skipRequested) {
      return false;
    }

    this.skipRequested = false;
    return true;
  }

  private anyHeld(codes: readonly string[]): boolean {
    return codes.some((code) => this.heldKeys.has(code));
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (this.isEditableTarget(event.target)) {
      return;
    }

    if (BOUND_CODES.has(event.code)) {
      event.preventDefault();
    }

    this.heldKeys.add(event.code);

    if (!event.repeat && KEY_BINDINGS.restart.includes(event.code as (typeof KEY_BINDINGS.restart)[number])) {
      this.restartRequested = true;
    }

    if (!event.repeat && KEY_BINDINGS.skip.includes(event.code as (typeof KEY_BINDINGS.skip)[number])) {
      this.skipRequested = true;
    }

    if (!event.repeat && KEY_BINDINGS.tailSlap.includes(event.code as (typeof KEY_BINDINGS.tailSlap)[number])) {
      this.tailSlapRequested = true;
    }
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    if (this.isEditableTarget(event.target)) {
      return;
    }

    if (BOUND_CODES.has(event.code)) {
      event.preventDefault();
    }

    this.heldKeys.delete(event.code);
  };

  private readonly handleBlur = (): void => {
    this.heldKeys.clear();
    this.skipRequested = false;
    this.tailSlapRequested = false;
  };

  private isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
      return false;
    }

    return (
      target.isContentEditable ||
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT'
    );
  }
}
