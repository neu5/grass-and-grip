import { lerpAngle } from '../sim/dmath';
import { stepOwnCar, type CarState, type GameState, type PlayerInput } from '../sim';

export interface TimedInput {
  seq: number;
  tick: number;
  input: PlayerInput;
}

/** Client input history used for prediction and snapshot reconciliation. */
export class InputQueue {
  private nextSeq = 1;
  items: TimedInput[] = [];

  push(tick: number, input: PlayerInput): TimedInput {
    const item: TimedInput = { seq: this.nextSeq++, tick, input: { ...input } };
    this.items.push(item);
    if (this.items.length > 120) this.items.shift();
    return item;
  }

  /** Drop inputs the server has already applied. */
  ack(seq: number): TimedInput[] {
    const kept = this.items.filter((i) => i.seq > seq);
    this.items = kept;
    return kept;
  }

  get unacked(): TimedInput[] {
    return this.items;
  }

  get lastSeq(): number {
    return this.nextSeq - 1;
  }

  reset(): void {
    this.nextSeq = 1;
    this.items = [];
  }
}

/** Rewind to the server pose and replay every unacked input. */
export function replayUnacked(server: GameState, carId: number, unacked: TimedInput[]): GameState {
  let state = server;
  for (const item of unacked) state = stepOwnCar(state, carId, item.input);
  return state;
}

/**
 * Blend a small correction into the live predicted car. Large errors move
 * faster, but the pose is never replaced in one frame.
 */
export function smoothCar(from: CarState, to: CarState): CarState {
  const err = Math.hypot(to.x - from.x, to.y - from.y);
  const t = err < 1.5 ? 0.14 : err < 18 ? 0.3 : 0.55;
  return {
    ...to,
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    vx: from.vx + (to.vx - from.vx) * t,
    vy: from.vy + (to.vy - from.vy) * t,
    angle: lerpAngle(from.angle, to.angle, t),
    slip: from.slip + (to.slip - from.slip) * t,
  };
}

export function replaceCar(state: GameState, car: CarState): GameState {
  return { ...state, cars: state.cars.map((c) => (c.id === car.id ? car : c)) };
}

export function lerpCar(a: CarState, b: CarState, t: number): CarState {
  return {
    ...b,
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    vx: a.vx + (b.vx - a.vx) * t,
    vy: a.vy + (b.vy - a.vy) * t,
    angle: lerpAngle(a.angle, b.angle, t),
    slip: a.slip + (b.slip - a.slip) * t,
  };
}

export function reconcile(predicted: GameState | null, server: GameState, carId: number, unacked: TimedInput[]): GameState {
  const replayed = replayUnacked(server, carId, unacked);
  const live = predicted?.cars.find((c) => c.id === carId);
  const next = replayed.cars.find((c) => c.id === carId);
  if (!live || !next) return replayed;
  return replaceCar(replayed, smoothCar(live, next));
}
