import { clamp, dcos, dsin, normalizeAngle } from './dmath';
import type { Surface } from './track';
import { DEFAULT_RULES, toCarKind, type CarKind, type CarSetup, type CarState, type PlayerInput, type RaceRules } from './types';

export interface SurfaceParams {
  grip: number;
  engine: number;
  rolling: number;
}

export const SURFACES: Record<Surface, SurfaceParams> = {
  asphalt: { grip: 1, engine: 1, rolling: 0.4 },
  grass: { grip: 0.42, engine: 0.7, rolling: 1.8 },
  /** Looser than grass: more slide, slower than asphalt, not the same drag. */
  sand: { grip: 0.22, engine: 0.58, rolling: 2.5 },
  /** Strong drag vs land, but still driveable — not a crawl. */
  water: { grip: 0.16, engine: 0.38, rolling: 4.2 },
  /** Loose stones: between grass and asphalt, with a lot of rolling drag. */
  gravel: { grip: 0.55, engine: 0.8, rolling: 1.5 },
  /** Packed snow: slippery but not hopeless. */
  snow: { grip: 0.36, engine: 0.66, rolling: 1.0 },
  /** Ice: almost no grip and almost no drag, so cars slide a long way. */
  ice: { grip: 0.13, engine: 0.5, rolling: 0.2 },
  /** Packed dirt road: a rally stage, quick but loose. */
  dirt: { grip: 0.72, engine: 0.92, rolling: 0.75 },
  /** Mud: puddles and ploughed fields, slippery and draggy. */
  mud: { grip: 0.3, engine: 0.55, rolling: 2.8 },
};

export interface CarStats {
  length: number;
  width: number;
  radius: number;
  /**
   * Engine, brake, reverse and handbrake are forces: a car's acceleration is
   * the force divided by its `mass`, so heavy cars pull and stop slower.
   */
  engineAccel: number;
  brakeDecel: number;
  reverseAccel: number;
  maxReverse: number;
  /** Air drag per unit of speed squared; with `engineAccel / mass` it sets the top speed. */
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
  /** Relative mass, for driving (see `engineAccel`) and car-to-car shoves. Rally is 1. */
  mass: number;
  /** Crash damage is divided by this. */
  toughness: number;
  /**
   * Off-road ability. Positive closes part of the gap to asphalt grip and
   * power on loose surfaces; negative makes them worse.
   */
  offroad: number;
}

/**
 * Balanced so every car laps within a few percent of the others on average,
 * but each gets there its own way. Top speeds on tarmac: F1 ~620, rally ~540,
 * buggy ~500, truck ~480, kart ~450.
 * Rally: the all-rounder that slides.
 * Formula 1: by far the fastest on a straight, grips hard, slow off the
 * line, fragile and hopeless off the road.
 */
export const CARS: Record<CarKind, CarStats> = {
  rally: {
    length: 32,
    width: 17,
    radius: 14,
    engineAccel: 535,
    brakeDecel: 900,
    reverseAccel: 260,
    maxReverse: 150,
    airDrag: 0.001094,
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
    mass: 1,
    toughness: 1,
    offroad: 0,
  },
  f1: {
    length: 38,
    width: 20,
    radius: 14,
    engineAccel: 520,
    brakeDecel: 950,
    reverseAccel: 280,
    maxReverse: 140,
    airDrag: 0.000708,
    coastDrag: 0.38,
    lateralGrip: 1300,
    slideThreshold: 100,
    slideGripFactor: 0.85,
    handbrakeGripFactor: 0.5,
    handbrakeDecel: 300,
    slideScrub: 0.0016,
    steerRate: 3.05,
    steerFullSpeed: 160,
    steerDampSpeed: 1200,
    mass: 1,
    toughness: 0.75,
    offroad: -0.35,
  },
  /** A little slower on tarmac, best on grass, sand and gravel, shrugs off knocks. */
  buggy: {
    length: 30,
    width: 18,
    radius: 14,
    engineAccel: 486,
    brakeDecel: 765,
    reverseAccel: 234,
    maxReverse: 150,
    airDrag: 0.00136,
    coastDrag: 0.5,
    lateralGrip: 1150,
    slideThreshold: 75,
    slideGripFactor: 0.74,
    handbrakeGripFactor: 0.32,
    handbrakeDecel: 234,
    slideScrub: 0.0035,
    steerRate: 3.5,
    steerFullSpeed: 110,
    steerDampSpeed: 900,
    mass: 0.9,
    toughness: 1.25,
    offroad: 0.5,
  },
  /** Heavy: big engine and brakes, but its mass makes it slow to pull, turn and stop; hard to hurt, shoves everyone else aside. */
  truck: {
    length: 44,
    width: 22,
    radius: 17,
    engineAccel: 1296,
    brakeDecel: 1920,
    reverseAccel: 528,
    maxReverse: 120,
    airDrag: 0.00151,
    coastDrag: 0.5,
    lateralGrip: 1680,
    slideThreshold: 60,
    slideGripFactor: 0.76,
    handbrakeGripFactor: 0.36,
    handbrakeDecel: 576,
    slideScrub: 0.004,
    steerRate: 3.15,
    steerFullSpeed: 120,
    steerDampSpeed: 900,
    mass: 2.4,
    toughness: 2,
    offroad: 0.2,
  },
  /** Tiny, light and twitchy: quickest off the line and in tight corners, lowest top speed, hates grass. */
  kart: {
    length: 22,
    width: 14,
    radius: 10,
    engineAccel: 418,
    brakeDecel: 550,
    reverseAccel: 143,
    maxReverse: 130,
    airDrag: 0.002792,
    coastDrag: 0.45,
    lateralGrip: 1800,
    slideThreshold: 95,
    slideGripFactor: 0.82,
    handbrakeGripFactor: 0.4,
    handbrakeDecel: 154,
    slideScrub: 0.0025,
    steerRate: 4.1,
    steerFullSpeed: 90,
    steerDampSpeed: 1000,
    mass: 0.55,
    toughness: 0.8,
    offroad: -0.25,
  },
};

/** Default / rally stats. Prefer `carStats(car)` for per-car physics. */
export const CAR = CARS.rally;

/** Stock stats for a kind (size, looks). Driving uses `carStats`, which adds the setup. */
export function statsFor(kind: CarKind | undefined): CarStats {
  return CARS[toCarKind(kind)];
}

/** What one setup step changes. */
export const SETUP_EFFECT = {
  /** Long gearing: less pull, less drag, so a higher top speed. */
  gearingAccel: 0.05,
  gearingDrag: 0.15,
  steerRate: 0.07,
  /** More grip: more cornering, a little more drag and less pull. */
  gripLateral: 0.05,
  gripSlide: 0.05,
  gripDrag: 0.04,
  gripAccel: 0.025,
};

const tunedCache = new Map<string, CarStats>();

/** Stats for one car: its kind plus garage setup. */
export function carStats(car: { kind?: CarKind; setup?: CarSetup }): CarStats {
  const kind = toCarKind(car.kind);
  const g = car.setup?.gearing ?? 0;
  const st = car.setup?.steering ?? 0;
  const gr = car.setup?.grip ?? 0;
  if (g === 0 && st === 0 && gr === 0) return CARS[kind];
  const key = `${kind}:${g}:${st}:${gr}`;
  let tuned = tunedCache.get(key);
  if (!tuned) {
    const base = CARS[kind];
    const e = SETUP_EFFECT;
    tuned = {
      ...base,
      engineAccel: base.engineAccel * (1 - e.gearingAccel * g) * (1 - e.gripAccel * gr),
      airDrag: base.airDrag * (1 - e.gearingDrag * g) * (1 + e.gripDrag * gr),
      steerRate: base.steerRate * (1 + e.steerRate * st),
      lateralGrip: base.lateralGrip * (1 + e.gripLateral * gr),
      slideThreshold: base.slideThreshold * (1 + e.gripSlide * gr),
    };
    tunedCache.set(key, tuned);
  }
  return tuned;
}

/** Surface grip / power / rolling for one car, after its off-road ability. */
export function surfaceFor(C: CarStats, surface: Surface): SurfaceParams {
  const s = SURFACES[surface];
  // Off-road tyres help on loose ground, not on tarmac or bare ice.
  if (surface === 'asphalt' || surface === 'ice' || C.offroad === 0) return s;
  if (C.offroad > 0) {
    // Good off-road tyres close part of the gap to tarmac.
    return {
      grip: s.grip + (1 - s.grip) * C.offroad,
      engine: s.engine + (1 - s.engine) * C.offroad,
      rolling: s.rolling * (1 - C.offroad * 0.5),
    };
  }
  // Road tyres lose a share of what grip and drive there is (never below zero).
  return {
    grip: s.grip * (1 + C.offroad),
    engine: s.engine * (1 + C.offroad * 0.5),
    rolling: s.rolling * (1 - C.offroad * 0.5),
  };
}

export const NO_INPUT: PlayerInput = { throttle: 0, steer: 0, handbrake: false };

/** Wear 0–1. Fresh tyres match stock grip; 1.0 is remaining grip/brake. */
export const TYRE = {
  brake: 0.08,
  handbrake: 0.11,
  slip: 0.00022,
  grass: 0.045,
  sand: 0.07,
  gravel: 0.09,
  /** A dirt rally road: a little harder on tyres than tarmac, not like a gravel trap. */
  dirt: 0.008,
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

export function applyCollisionDamage(car: CarState, closingSpeed: number, rules: RaceRules = DEFAULT_RULES): void {
  const hit = closingSpeed - DAMAGE.graze;
  if (hit <= 0 || rules.damage === 0) return;
  const add = (DAMAGE.scale * hit * hit * rules.damage) / statsFor(car.kind).toughness;
  car.damage = clamp((car.damage ?? 0) + add, 0, 1);
}

export function stepCarPhysics(
  car: CarState,
  input: PlayerInput,
  surface: Surface,
  dt: number,
  rules: RaceRules = DEFAULT_RULES,
): void {
  const C = carStats(car);
  const s = surfaceFor(C, surface);
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

  const perMass = 1 / C.mass;
  if (throttle > 0) {
    vF += C.engineAccel * perMass * s.engine * throttle * powerMul * dt;
  } else if (throttle < 0) {
    if (vF > 5) {
      vF = Math.max(0, vF + C.brakeDecel * perMass * brakeMul * throttle * dt);
    } else {
      vF = Math.max(-C.maxReverse, vF + C.reverseAccel * perMass * s.engine * throttle * powerMul * dt);
    }
  } else {
    vF -= vF * C.coastDrag * dt;
  }
  if (hb) {
    const d = C.handbrakeDecel * perMass * dt;
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
    if (surface === 'sand') wearRate += TYRE.sand * spd;
    if (surface === 'gravel') wearRate += TYRE.gravel * spd;
    if (surface === 'dirt') wearRate += TYRE.dirt * spd;
    if (surface === 'mud') wearRate += TYRE.sand * spd;
  }
  car.tyreWear = clamp(wear + wearRate * rules.tyreWear * dt, 0, 1);

  let burn = 0;
  if (speed0 > 4 || throttle > 0) {
    burn = FUEL.idle;
    if (throttle > 0) burn += FUEL.throttle * throttle;
  }
  car.fuel = clamp(fuel - burn * rules.fuel * dt, 0, 1);
}

const RESTITUTION = 0.35;

export function collideCars(a: CarState, b: CarState, rules: RaceRules = DEFAULT_RULES): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d2 = dx * dx + dy * dy;
  const sa = statsFor(a.kind);
  const sb = statsFor(b.kind);
  const min = sa.radius + sb.radius;
  if (d2 >= min * min || d2 === 0) return;
  const d = Math.sqrt(d2);
  const nx = dx / d;
  const ny = dy / d;
  // The lighter car moves more, both out of the overlap and in the bounce.
  const ia = 1 / sa.mass;
  const ib = 1 / sb.mass;
  const share = (min - d) / (ia + ib);
  a.x -= nx * share * ia;
  a.y -= ny * share * ia;
  b.x += nx * share * ib;
  b.y += ny * share * ib;
  const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (rel < 0) {
    applyCollisionDamage(a, -rel, rules);
    applyCollisionDamage(b, -rel, rules);
    const j = (-(1 + RESTITUTION) * rel) / (ia + ib);
    a.vx -= j * ia * nx;
    a.vy -= j * ia * ny;
    b.vx += j * ib * nx;
    b.vy += j * ib * ny;
  }
}

export function collideCircle(car: CarState, ox: number, oy: number, r: number, rules: RaceRules = DEFAULT_RULES): void {
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
    applyCollisionDamage(car, -vn, rules);
    car.vx -= (1 + RESTITUTION) * vn * nx;
    car.vy -= (1 + RESTITUTION) * vn * ny;
  }
}

/** Push a car off a barrier segment `a`-`b` that is `half` units thick each side. */
export function collideSegment(
  car: CarState,
  a: { x: number; y: number },
  b: { x: number; y: number },
  half: number,
  rules: RaceRules = DEFAULT_RULES,
): void {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  let t = len2 > 0 ? ((car.x - a.x) * abx + (car.y - a.y) * aby) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  collideCircle(car, a.x + abx * t, a.y + aby * t, half, rules);
}

export function collideBounds(car: CarState, width: number, height: number, rules: RaceRules = DEFAULT_RULES): void {
  const m = statsFor(car.kind).radius;
  if (car.x < m) {
    const closing = car.vx < 0 ? -car.vx : 0;
    car.x = m;
    if (car.vx < 0) car.vx = -car.vx * RESTITUTION;
    applyCollisionDamage(car, closing, rules);
  } else if (car.x > width - m) {
    const closing = car.vx > 0 ? car.vx : 0;
    car.x = width - m;
    if (car.vx > 0) car.vx = -car.vx * RESTITUTION;
    applyCollisionDamage(car, closing, rules);
  }
  if (car.y < m) {
    const closing = car.vy < 0 ? -car.vy : 0;
    car.y = m;
    if (car.vy < 0) car.vy = -car.vy * RESTITUTION;
    applyCollisionDamage(car, closing, rules);
  } else if (car.y > height - m) {
    const closing = car.vy > 0 ? car.vy : 0;
    car.y = height - m;
    if (car.vy > 0) car.vy = -car.vy * RESTITUTION;
    applyCollisionDamage(car, closing, rules);
  }
}
