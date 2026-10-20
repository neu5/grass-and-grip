import { getTrack, type CarState, type PlayerInput } from '../sim';
import type { GameOptions } from './game';

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Steer toward a point and, if `stop`, brake in time to halt on it. */
function arrive(car: CarState, tx: number, ty: number, maxThrottle: number, stop: boolean): PlayerInput {
  const dx = tx - car.x;
  const dy = ty - car.y;
  const dist = Math.hypot(dx, dy);
  const diff = wrapAngle(Math.atan2(dy, dx) - car.angle);
  const speed = Math.hypot(car.vx, car.vy);
  const steer = clamp(diff * 2.6, -1, 1);
  if (stop) {
    const brakeDist = (speed * speed) / (2 * 520) + 14;
    if (dist < brakeDist) {
      if (speed < 7 && dist < 18) return { throttle: 0, steer, handbrake: false };
      return { throttle: -1, steer, handbrake: speed > 35 };
    }
  }
  const turnSlow = Math.abs(diff) > 0.6 ? 0.35 : 1;
  const throttle = Math.min(maxThrottle, 0.18 + dist / 140) * turnSlow;
  return { throttle, steer, handbrake: false };
}

/** Auto-drive a pit stop for `?demo=pit` (drive in, service, drive out). */
export function pitDemoOptions(): GameOptions {
  const track = getTrack('meadow');
  const box = track.def.pitBoxes[0];
  const boxX = box.x + box.w / 2;
  const boxY = box.y + box.h / 2;
  let phase: 'hold' | 'in' | 'wait' | 'out' = 'hold';
  let servedTicks = 0;
  let holdTicks = 0;

  return {
    humans: 1,
    aiCount: 0,
    laps: 1,
    p1Car: 'f1',
    countdownSeconds: 0,
    setup: (state) => {
      const car = state.cars[0];
      // On the racing line just after S/F, ready to peel into the stalls.
      car.x = boxX + 8;
      car.y = 198;
      car.angle = -0.55;
      car.vx = 0;
      car.vy = 0;
      car.fuel = 0.18;
      car.tyreWear = 0.82;
      phase = 'hold';
      servedTicks = 0;
      holdTicks = 0;
    },
    scriptedInput: (state) => {
      const car = state.cars[0];
      if (phase === 'hold') {
        holdTicks++;
        if (holdTicks > 40) phase = 'in';
        return { throttle: 0, steer: 0, handbrake: false };
      }
      if (phase === 'in') {
        const input = arrive(car, boxX, boxY, 0.48, true);
        const inBox = car.x >= box.x && car.x < box.x + box.w && car.y >= box.y && car.y < box.y + box.h;
        const speed = Math.hypot(car.vx, car.vy);
        if (inBox && speed < 12) phase = 'wait';
        return input;
      }
      if (phase === 'wait') {
        if (car.fuel >= 0.995 && car.tyreWear <= 0.005) servedTicks++;
        else servedTicks = 0;
        if (servedTicks > 55) phase = 'out';
        return { throttle: 0, steer: 0, handbrake: false };
      }
      return arrive(car, boxX + 20, 215, 0.55, false);
    },
  };
}
