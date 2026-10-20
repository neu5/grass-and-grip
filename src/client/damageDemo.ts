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

type Phase = 'hold' | 'ram' | 'back' | 'toPit' | 'wait' | 'out';

/** Auto-drive crash → smoke, harder crash → fire, then a pit repair. `?demo=damage` */
export function damageDemoOptions(): GameOptions {
  const track = getTrack('meadow');
  const box = track.def.pitBoxes[0];
  const boxX = box.x + box.w / 2;
  const boxY = box.y + box.h / 2;
  let phase: Phase = 'hold';
  let holdTicks = 0;
  let servedTicks = 0;
  let rams = 0;
  let lastDamage = 0;

  return {
    humans: 1,
    aiCount: 0,
    laps: 1,
    p1Car: 'f1',
    countdownSeconds: 0,
    setup: (state) => {
      const car = state.cars[0];
      car.x = boxX;
      car.y = 250;
      car.angle = -Math.PI / 2;
      car.vx = 0;
      car.vy = 0;
      car.fuel = 0.38;
      car.tyreWear = 0.48;
      car.damage = 0;
      phase = 'hold';
      holdTicks = 0;
      servedTicks = 0;
      rams = 0;
      lastDamage = 0;
    },
    scriptedInput: (state) => {
      const car = state.cars[0];
      const speed = Math.hypot(car.vx, car.vy);
      if (phase === 'hold') {
        holdTicks++;
        if (holdTicks > 45) phase = 'ram';
        return { throttle: 0, steer: 0, handbrake: false };
      }
      if (phase === 'ram') {
        if (car.damage > lastDamage + 0.04 && car.y < 50) {
          lastDamage = car.damage;
          rams++;
          phase = car.damage > 0.6 ? 'toPit' : 'back';
        }
        return { throttle: rams === 0 ? 0.75 : 1, steer: 0, handbrake: false };
      }
      if (phase === 'back') {
        if (car.y > 280 && speed < 140) phase = 'ram';
        return { throttle: -1, steer: 0, handbrake: false };
      }
      if (phase === 'toPit') {
        const inBox = car.x >= box.x && car.x < box.x + box.w && car.y >= box.y && car.y < box.y + box.h;
        if (inBox && speed < 12) phase = 'wait';
        if (car.y < boxY - 4) return { throttle: -0.55, steer: 0, handbrake: speed > 50 };
        return arrive(car, boxX, boxY, 0.4, true);
      }
      if (phase === 'wait') {
        const healthy = car.damage <= 0.02 && car.fuel >= 0.995 && car.tyreWear <= 0.005;
        if (healthy) servedTicks++;
        else servedTicks = 0;
        if (servedTicks > 45) phase = 'out';
        return { throttle: 0, steer: 0, handbrake: false };
      }
      return arrive(car, boxX + 16, 230, 0.5, false);
    },
  };
}
