import type { CarState, GameState } from '../sim';

/** Render remotes this far behind the newest snapshot so we usually have a pair. */
export const INTERP_DELAY_MS = 100;
/** How long to keep sliding on the last known velocity when a snapshot is late. */
export const EXTRAPOLATE_MS = 80;

interface Buffered {
  at: number;
  state: GameState;
}

export interface Sample {
  prev: GameState;
  curr: GameState;
  alpha: number;
}

export class SnapshotBuffer {
  private snaps: Buffered[] = [];

  get length(): number {
    return this.snaps.length;
  }

  get latest(): GameState | null {
    return this.snaps[this.snaps.length - 1]?.state ?? null;
  }

  push(state: GameState, at = performance.now()): void {
    const last = this.snaps[this.snaps.length - 1];
    if (last && state.tick < last.state.tick) this.snaps = [];
    this.snaps.push({ at, state });
    while (this.snaps.length > 40) this.snaps.shift();
  }

  clear(): void {
    this.snaps = [];
  }

  /**
   * Sample the buffer at `now - delay`. Interpolates between received snapshots
   * and briefly extrapolates on a gap.
   */
  sample(now: number, delayMs = INTERP_DELAY_MS): Sample | null {
    if (this.snaps.length === 0) return null;
    const target = now - delayMs;
    if (target <= this.snaps[0].at) {
      const s = this.snaps[0].state;
      return { prev: s, curr: s, alpha: 1 };
    }
    const last = this.snaps[this.snaps.length - 1];
    if (target >= last.at) {
      const dt = Math.min(EXTRAPOLATE_MS, target - last.at) / 1000;
      if (dt <= 0) return { prev: last.state, curr: last.state, alpha: 1 };
      return { prev: last.state, curr: extrapolateState(last.state, dt), alpha: 1 };
    }
    let i = this.snaps.length - 1;
    while (i > 0 && this.snaps[i - 1].at > target) i--;
    const b = this.snaps[i];
    const a = this.snaps[Math.max(0, i - 1)];
    const span = b.at - a.at;
    const alpha = span <= 0 ? 1 : (target - a.at) / span;
    return { prev: a.state, curr: b.state, alpha };
  }
}

export function extrapolateCar(car: CarState, dt: number): CarState {
  return { ...car, x: car.x + car.vx * dt, y: car.y + car.vy * dt };
}

export function extrapolateState(state: GameState, dt: number): GameState {
  return { ...state, cars: state.cars.map((c) => extrapolateCar(c, dt)) };
}

/** Overlay the predicted local car onto a remote interpolated state. */
export function mergeOwn(remote: GameState, own: GameState | null, carId: number | undefined): GameState {
  if (!own || carId === undefined) return remote;
  const mine = own.cars.find((c) => c.id === carId);
  if (!mine) return remote;
  return {
    ...remote,
    tick: own.tick,
    phase: own.phase,
    cars: remote.cars.map((c) => (c.id === carId ? mine : c)),
  };
}
