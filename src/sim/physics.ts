import { clamp, dcos, dsin, normalizeAngle } from './dmath';
import type { Surface } from './track';
import type { CarState, PlayerInput } from './types';

export interface SurfaceParams {
  grip: number;
  engine: number;
  rolling: number;
}

export const SURFACES: Record<Surface, SurfaceParams> = {
  asphalt: { grip: 1, engine: 1, rolling: 0.4 },
  grass: { grip: 0.42, engine: 0.7, rolling: 1.8 },
};

export const CAR = {
  length: 32,
  width: 17,
  radius: 14,
  engineAccel: 520,
  brakeDecel: 900,
  reverseAccel: 260,
  maxReverse: 150,
  airDrag: 0.0012,
  coastDrag: 0.5,
  lateralGrip: 1150,
  /** Above this lateral speed the tyres are sliding and grip drops. */
  slideThreshold: 70,
  slideGripFactor: 0.72,
  handbrakeGripFactor: 0.32,
  handbrakeDecel: 260,
  slideScrub: 0.0035,
  steerRate: 3.3,
  steerFullSpeed: 110,
  steerDampSpeed: 900,
};

export const NO_INPUT: PlayerInput = { throttle: 0, steer: 0, handbrake: false };

export function stepCarPhysics(car: CarState, input: PlayerInput, surface: Surface, dt: number): void {
  const s = SURFACES[surface];
  const ca = dcos(car.angle);
  const sa = dsin(car.angle);
  let vF = car.vx * ca + car.vy * sa;
  let vR = -car.vx * sa + car.vy * ca;

  const throttle = clamp(input.throttle, -1, 1);
  const steer = clamp(input.steer, -1, 1);
  const hb = input.handbrake;

  if (throttle > 0) {
    vF += CAR.engineAccel * s.engine * throttle * dt;
  } else if (throttle < 0) {
    if (vF > 5) {
      vF = Math.max(0, vF + CAR.brakeDecel * throttle * dt);
    } else {
      vF = Math.max(-CAR.maxReverse, vF + CAR.reverseAccel * s.engine * throttle * dt);
    }
  } else {
    vF -= vF * CAR.coastDrag * dt;
  }
  if (hb) {
    const d = CAR.handbrakeDecel * dt;
    vF = vF > d ? vF - d : vF < -d ? vF + d : 0;
  }

  vF -= vF * s.rolling * dt + vF * Math.abs(vF) * CAR.airDrag * dt;

  let maxLat = CAR.lateralGrip * s.grip;
  if (Math.abs(vR) > CAR.slideThreshold) maxLat *= CAR.slideGripFactor;
  if (hb) maxLat *= CAR.handbrakeGripFactor;
  vR += clamp(-vR, -maxLat * dt, maxLat * dt);
  vF -= vF * Math.min(1, Math.abs(vR) * CAR.slideScrub * dt);

  const absF = Math.abs(vF);
  const speedFactor = Math.min(1, absF / CAR.steerFullSpeed);
  const highSpeedDamp = 1 / (1 + absF / CAR.steerDampSpeed);
  const yaw = steer * CAR.steerRate * speedFactor * highSpeedDamp * (vF >= 0 ? 1 : -1) * (hb ? 1.35 : 1);
  car.angle = normalizeAngle(car.angle + yaw * dt);

  car.vx = vF * ca - vR * sa;
  car.vy = vF * sa + vR * ca;
  car.x += car.vx * dt;
  car.y += car.vy * dt;
  car.slip = Math.abs(vR);
  car.onGrass = surface === 'grass';
  car.handbrake = hb && absF > 30;
}

const RESTITUTION = 0.35;

export function collideCars(a: CarState, b: CarState): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d2 = dx * dx + dy * dy;
  const min = CAR.radius * 2;
  if (d2 >= min * min || d2 === 0) return;
  const d = Math.sqrt(d2);
  const nx = dx / d;
  const ny = dy / d;
  const push = (min - d) / 2;
  a.x -= nx * push;
  a.y -= ny * push;
  b.x += nx * push;
  b.y += ny * push;
  const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (rel < 0) {
    const j = (-(1 + RESTITUTION) * rel) / 2;
    a.vx -= j * nx;
    a.vy -= j * ny;
    b.vx += j * nx;
    b.vy += j * ny;
  }
}

export function collideCircle(car: CarState, ox: number, oy: number, r: number): void {
  const dx = car.x - ox;
  const dy = car.y - oy;
  const d2 = dx * dx + dy * dy;
  const min = CAR.radius + r;
  if (d2 >= min * min || d2 === 0) return;
  const d = Math.sqrt(d2);
  const nx = dx / d;
  const ny = dy / d;
  car.x = ox + nx * min;
  car.y = oy + ny * min;
  const vn = car.vx * nx + car.vy * ny;
  if (vn < 0) {
    car.vx -= (1 + RESTITUTION) * vn * nx;
    car.vy -= (1 + RESTITUTION) * vn * ny;
  }
}

export function collideBounds(car: CarState, width: number, height: number): void {
  const m = CAR.radius;
  if (car.x < m) {
    car.x = m;
    if (car.vx < 0) car.vx = -car.vx * RESTITUTION;
  } else if (car.x > width - m) {
    car.x = width - m;
    if (car.vx > 0) car.vx = -car.vx * RESTITUTION;
  }
  if (car.y < m) {
    car.y = m;
    if (car.vy < 0) car.vy = -car.vy * RESTITUTION;
  } else if (car.y > height - m) {
    car.y = height - m;
    if (car.vy > 0) car.vy = -car.vy * RESTITUTION;
  }
}
