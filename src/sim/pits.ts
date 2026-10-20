import { clamp } from './dmath';
import { pitBoxIndex, type Track } from './track';
import type { CarState } from './types';

/** GeneRally-style service: tyres + fuel + body together, only while stopped in a box. */
export const PIT = {
  /** Must be slower than this (px/s) to take service. */
  stopSpeed: 24,
  /** Remaining fuel/body climb and tyre wear drops at this rate. ~2.4s empty→full. */
  refillPerSecond: 0.42,
};

export function carSpeed(car: CarState): number {
  return Math.hypot(car.vx, car.vy);
}

export function isStoppedInPit(track: Track, car: CarState): boolean {
  return pitBoxIndex(track, car.x, car.y) >= 0 && carSpeed(car) < PIT.stopSpeed;
}

export function needsPitService(car: CarState): boolean {
  return (car.fuel ?? 1) < 0.999 || (car.tyreWear ?? 0) > 0.001 || (car.damage ?? 0) > 0.001;
}

export function applyPitService(car: CarState, track: Track, dt: number): void {
  if (!isStoppedInPit(track, car)) return;
  const d = PIT.refillPerSecond * dt;
  car.fuel = clamp((car.fuel ?? 1) + d, 0, 1);
  car.tyreWear = clamp((car.tyreWear ?? 0) - d, 0, 1);
  car.damage = clamp((car.damage ?? 0) - d, 0, 1);
}
