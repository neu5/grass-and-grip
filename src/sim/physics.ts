import { clamp, dcos, dsin, normalizeAngle } from './dmath';
import type { Surface } from './track';
import type { CarKind, CarState, PlayerInput } from './types';

export interface SurfaceParams {
  grip: number;
  engine: number;
  rolling: number;
}

export const SURFACES: Record<Surface, SurfaceParams> = {
  asphalt: { grip: 1, engine: 1, rolling: 0.4 },
  grass: { grip: 0.42, engine: 0.7, rolling: 1.8 },
};

export interface CarStats {
  length: number;
  width: number;
  radius: number;
  engineAccel: number;
  brakeDecel: number;
  reverseAccel: number;
  maxReverse: number;
  airDrag: number;
  coastDrag: number;
  lateralGrip: number;
  /** Above this lateral speed the tyres are sliding and grip drops. */
  slideThreshold: number;
  slideGripFactor: number;
  handbrakeGripFactor: number;
  handbrakeDecel: number;
  slideScrub: number;
  steerRate: number;
  steerFullSpeed: number;
  steerDampSpeed: number;
}

/** Rally: stock sliding car. Formula 1: faster, more grip, less slide. */
export const CARS: Record<CarKind, CarStats> = {
  rally: {
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
    slideThreshold: 70,
    slideGripFactor: 0.72,
    handbrakeGripFactor: 0.32,
    handbrakeDecel: 260,
    slideScrub: 0.0035,
    steerRate: 3.3,
    steerFullSpeed: 110,
    steerDampSpeed: 900,
  },
  f1: {
    length: 38,
    width: 20,
    radius: 14,
    engineAccel: 720,
    brakeDecel: 1100,
    reverseAccel: 280,
    maxReverse: 140,
    airDrag: 0.00072,
    coastDrag: 0.38,
    lateralGrip: 1850,
    slideThreshold: 125,
    slideGripFactor: 0.9,
    handbrakeGripFactor: 0.5,
    handbrakeDecel: 300,
    slideScrub: 0.0016,
    steerRate: 3.05,
    steerFullSpeed: 160,
    steerDampSpeed: 1200,
  },
};

/** Default / rally stats. Prefer `statsFor(kind)` for per-car physics. */
export const CAR = CARS.rally;

export function statsFor(kind: CarKind | undefined): CarStats {
  return CARS[kind === 'f1' ? 'f1' : 'rally'];
}

export const NO_INPUT: PlayerInput = { throttle: 0, steer: 0, handbrake: false };

/** Wear 0–1. Fresh tyres match stock grip; 1.0 is remaining grip/brake. */
export const TYRE = {
  brake: 0.08,
  handbrake: 0.11,
  slip: 0.00022,
  grass: 0.045,
  rolling: 0.0035,
  corner: 0.028,
  wornGrip: 0.38,
  wornBrake: 0.5,
  wornSlideThreshold: 0.48,
};

export function tyreFactor(wear: number, worn: number): number {
  return 1 - clamp(wear, 0, 1) * (1 - worn);
}

/** Remaining fuel 0–1. Throttle burns more than coast; empty is slower, not a crawl. */
export const FUEL = {
  idle: 0.0028,
  throttle: 0.0074,
  lightGain: 0.055,
  crawl: 0.42,
  emptyDrag: 0.45,
};

/** Crash damage 0–1. Hits add more with closing speed; crawl only when almost wrecked. */
export const DAMAGE = {
  /** Closing speed (px/s) at or below this is a graze. */
  graze: 22,
  /** Squared impact scale. ~400 px/s wall hit ≈ 0.34. */
  scale: 1 / 420000,
  /** At damage=1, remaining engine power. */
  crawl: 0.4,
  /** Extra first-order drag at damage=1. */
  drag: 0.38,
  /** >1 so mid damage is a light penalty; crawl only near 1. */
  curve: 1.7,
};

function damageAmount(dmg: number): number {
  const d = clamp(dmg, 0, 1);
  return d ** DAMAGE.curve;
}

export function applyCollisionDamage(car: CarState, closingSpeed: number): void {
  const hit = closingSpeed - DAMAGE.graze;
  if (hit <= 0) return;
  car.damage = clamp((car.damage ?? 0) + DAMAGE.scale * hit * hit, 0, 1);
}

export function stepCarPhysics(car: CarState, input: PlayerInput, surface: Surface, dt: number): void {
  const C = statsFor(car.kind);
  const s = SURFACES[surface];
  const wear = clamp(car.tyreWear ?? 0, 0, 1);
  const fuel = clamp(car.fuel ?? 1, 0, 1);
  const dmg = clamp(car.damage ?? 0, 0, 1);
  const empty = fuel <= 0;
  const lightMul = 1 + (1 - fuel) * FUEL.lightGain;
  const dmgAmt = damageAmount(dmg);
  const dmgMul = 1 - dmgAmt * (1 - DAMAGE.crawl);
  const powerMul = (empty ? FUEL.crawl : lightMul) * dmgMul;
  const gripMul = tyreFactor(wear, TYRE.wornGrip);
  const brakeMul = tyreFactor(wear, TYRE.wornBrake);
  const ca = dcos(car.angle);
  const sa = dsin(car.angle);
  let vF = car.vx * ca + car.vy * sa;
  let vR = -car.vx * sa + car.vy * ca;
  const speed0 = Math.hypot(car.vx, car.vy);

  const throttle = clamp(input.throttle, -1, 1);
  const steer = clamp(input.steer, -1, 1);
  const hb = input.handbrake;
  const braking = throttle < 0 && vF > 5;
  const brakeAmt = braking ? -throttle : 0;

  if (throttle > 0) {
    vF += C.engineAccel * s.engine * throttle * powerMul * dt;
  } else if (throttle < 0) {
    if (vF > 5) {
      vF = Math.max(0, vF + C.brakeDecel * brakeMul * throttle * dt);
    } else {
      vF = Math.max(-C.maxReverse, vF + C.reverseAccel * s.engine * throttle * powerMul * dt);
    }
  } else {
    vF -= vF * C.coastDrag * dt;
  }
  if (hb) {
    const d = C.handbrakeDecel * dt;
    vF = vF > d ? vF - d : vF < -d ? vF + d : 0;
  }

  vF -= vF * s.rolling * dt + vF * Math.abs(vF) * C.airDrag * dt;
  if (empty) vF -= vF * FUEL.emptyDrag * dt;
  if (dmgAmt > 0) vF -= vF * DAMAGE.drag * dmgAmt * dt;

  const slideThresh = C.slideThreshold * tyreFactor(wear, TYRE.wornSlideThreshold);
  let maxLat = C.lateralGrip * s.grip * gripMul;
  if (Math.abs(vR) > slideThresh) maxLat *= C.slideGripFactor;
  if (hb) maxLat *= C.handbrakeGripFactor;
  vR += clamp(-vR, -maxLat * dt, maxLat * dt);
  vF -= vF * Math.min(1, Math.abs(vR) * C.slideScrub * dt);

  const absF = Math.abs(vF);
  const speedFactor = Math.min(1, absF / C.steerFullSpeed);
  const highSpeedDamp = 1 / (1 + absF / C.steerDampSpeed);
  const yaw = steer * C.steerRate * speedFactor * highSpeedDamp * (vF >= 0 ? 1 : -1) * (hb ? 1.35 : 1);
  car.angle = normalizeAngle(car.angle + yaw * dt);

  car.vx = vF * ca - vR * sa;
  car.vy = vF * sa + vR * ca;
  car.x += car.vx * dt;
  car.y += car.vy * dt;
  car.slip = Math.abs(vR);
  car.onGrass = surface === 'grass';
  car.handbrake = hb && absF > 30;

  let wearRate = 0;
  if (speed0 > 12) {
    const spd = Math.min(1, speed0 / 280);
    wearRate += TYRE.rolling * spd;
    wearRate += TYRE.corner * Math.abs(steer) * spd;
    if (brakeAmt > 0) wearRate += TYRE.brake * brakeAmt * spd;
    if (hb) wearRate += TYRE.handbrake * spd;
    wearRate += TYRE.slip * car.slip;
    if (surface === 'grass') wearRate += TYRE.grass * spd;
  }
  car.tyreWear = clamp(wear + wearRate * dt, 0, 1);

  let burn = 0;
  if (speed0 > 4 || throttle > 0) {
    burn = FUEL.idle;
    if (throttle > 0) burn += FUEL.throttle * throttle;
  }
  car.fuel = clamp(fuel - burn * dt, 0, 1);
}

const RESTITUTION = 0.35;

export function collideCars(a: CarState, b: CarState): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d2 = dx * dx + dy * dy;
  const min = statsFor(a.kind).radius + statsFor(b.kind).radius;
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
    applyCollisionDamage(a, -rel);
    applyCollisionDamage(b, -rel);
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
  const min = statsFor(car.kind).radius + r;
  if (d2 >= min * min || d2 === 0) return;
  const d = Math.sqrt(d2);
  const nx = dx / d;
  const ny = dy / d;
  car.x = ox + nx * min;
  car.y = oy + ny * min;
  const vn = car.vx * nx + car.vy * ny;
  if (vn < 0) {
    applyCollisionDamage(car, -vn);
    car.vx -= (1 + RESTITUTION) * vn * nx;
    car.vy -= (1 + RESTITUTION) * vn * ny;
  }
}

export function collideBounds(car: CarState, width: number, height: number): void {
  const m = statsFor(car.kind).radius;
  if (car.x < m) {
    const closing = car.vx < 0 ? -car.vx : 0;
    car.x = m;
    if (car.vx < 0) car.vx = -car.vx * RESTITUTION;
    applyCollisionDamage(car, closing);
  } else if (car.x > width - m) {
    const closing = car.vx > 0 ? car.vx : 0;
    car.x = width - m;
    if (car.vx > 0) car.vx = -car.vx * RESTITUTION;
    applyCollisionDamage(car, closing);
  }
  if (car.y < m) {
    const closing = car.vy < 0 ? -car.vy : 0;
    car.y = m;
    if (car.vy < 0) car.vy = -car.vy * RESTITUTION;
    applyCollisionDamage(car, closing);
  } else if (car.y > height - m) {
    const closing = car.vy > 0 ? car.vy : 0;
    car.y = height - m;
    if (car.vy > 0) car.vy = -car.vy * RESTITUTION;
    applyCollisionDamage(car, closing);
  }
}
