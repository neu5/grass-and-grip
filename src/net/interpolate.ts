import { TICK_RATE, type CarState, type GameState } from '../sim';

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

const TICK_MS = 1000 / TICK_RATE;

/**
 * Received snapshots, played back on the server's own clock: each one is
 * placed by its tick, not by when it arrived, so a late packet followed by
 * an early one doesn't make the cars lurch and stall.
 */
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
   * Where server tick 0 falls on our clock: the quickest arrival in the buffer
   * (about two seconds), so packets that came in late don't drag it.
   */
  private origin(): number {
    let best = Infinity;
    for (const s of this.snaps) best = Math.min(best, s.at - s.state.tick * TICK_MS);
    return best;
  }

  /**
   * Sample the buffer `delayMs` behind the newest server time. Interpolates
   * between received snapshots and briefly extrapolates on a gap.
   */
  sample(now: number, delayMs = INTERP_DELAY_MS): Sample | null {
    if (this.snaps.length === 0) return null;
    const tick = (now - delayMs - this.origin()) / TICK_MS;
    if (tick <= this.snaps[0].state.tick) {
      const s = this.snaps[0].state;
      return { prev: s, curr: s, alpha: 1 };
    }
    const last = this.snaps[this.snaps.length - 1];
    if (tick >= last.state.tick) {
      const dt = Math.min(EXTRAPOLATE_MS, (tick - last.state.tick) * TICK_MS) / 1000;
      if (dt <= 0) return { prev: last.state, curr: last.state, alpha: 1 };
      return { prev: last.state, curr: extrapolateState(last.state, dt), alpha: 1 };
    }
    let i = this.snaps.length - 1;
    while (i > 0 && this.snaps[i - 1].state.tick > tick) i--;
    const b = this.snaps[i].state;
    const a = this.snaps[Math.max(0, i - 1)].state;
    const span = b.tick - a.tick;
    const alpha = span <= 0 ? 1 : (tick - a.tick) / span;
    return { prev: a, curr: b, alpha };
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
