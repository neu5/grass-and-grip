import type { PlayerInput } from '../sim';

export interface KeyBindings {
  up: string[];
  down: string[];
  left: string[];
  right: string[];
  handbrake: string[];
}

export const BINDINGS_SOLO: KeyBindings = {
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  handbrake: ['Space', 'ShiftLeft', 'ShiftRight'],
};

export const BINDINGS_P1: KeyBindings = {
  up: ['ArrowUp'],
  down: ['ArrowDown'],
  left: ['ArrowLeft'],
  right: ['ArrowRight'],
  handbrake: ['ShiftRight', 'Slash', 'Enter'],
};

export const BINDINGS_P2: KeyBindings = {
  up: ['KeyW'],
  down: ['KeyS'],
  left: ['KeyA'],
  right: ['KeyD'],
  handbrake: ['ShiftLeft', 'Space'],
};

const GAME_KEYS = new Set([
  ...Object.values(BINDINGS_SOLO).flat(),
  ...Object.values(BINDINGS_P1).flat(),
  ...Object.values(BINDINGS_P2).flat(),
]);

export class Keyboard {
  private down = new Set<string>();

  constructor(target: Window) {
    target.addEventListener('keydown', (e) => {
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      this.down.add(e.code);
    });
    target.addEventListener('keyup', (e) => this.down.delete(e.code));
    target.addEventListener('blur', () => this.down.clear());
  }

  private any(codes: string[]): boolean {
    return codes.some((c) => this.down.has(c));
  }

  sample(b: KeyBindings): PlayerInput {
    return {
      throttle: (this.any(b.up) ? 1 : 0) - (this.any(b.down) ? 1 : 0),
      steer: (this.any(b.right) ? 1 : 0) - (this.any(b.left) ? 1 : 0),
      handbrake: this.any(b.handbrake),
    };
  }
}
