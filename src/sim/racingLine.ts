import { carStats, SURFACES, type CarStats } from './physics';
import { surfaceAt, type Track, type Vec2 } from './track';
import type { CarKind, CarSetup, CarState } from './types';

/** How far the line stays inside the road edge (car half-width plus a little). */
const LINE_MARGIN = 18;
/** Relax at these neighbour spans, wide first, so long curves settle quickly. */
const LINE_SCALES = [24, 12, 6, 3, 1];
const LINE_ITERATIONS = 60;
const LINE_STEP = 0.5;

export interface RacingLine {
  /** Lateral offset from the centerline sample, along its normal. */
  offset: number[];
  points: Vec2[];
  /** 1 / radius of the line at each sample. */
  curvature: number[];
  /** Arc length from samples[0] to each sample, along the centerline. */
  arc: number[];
  /** Centerline lap length. */
  length: number;
  /** Sample index of each checkpoint gate. */
  gateIndex: number[];
}

const lines = new WeakMap<Track, RacingLine>();

/**
 * Minimum-curvature line: start on the centerline and pull each point toward
 * the middle of its neighbours, kept inside the road. Gives the usual
 * outside-inside-outside through corners and straightens S-bends.
 */
export function racingLine(track: Track): RacingLine {
  const cached = lines.get(track);
  if (cached) return cached;
  const s = track.samples;
  const nrm = track.normals;
  const n = s.length;
  const limit = Math.max(0, track.def.halfWidth - LINE_MARGIN);
  const offset = new Array<number>(n).fill(0);
  const at = (i: number) => {
    const k = ((i % n) + n) % n;
    return { x: s[k].x + nrm[k].x * offset[k], y: s[k].y + nrm[k].y * offset[k] };
  };
  for (const span of LINE_SCALES) {
    for (let it = 0; it < LINE_ITERATIONS; it++) {
      for (let i = 0; i < n; i++) {
        const a = at(i - span);
        const b = at(i + span);
        const mx = (a.x + b.x) / 2 - s[i].x;
        const my = (a.y + b.y) / 2 - s[i].y;
        const want = mx * nrm[i].x + my * nrm[i].y;
        const next = offset[i] + (want - offset[i]) * LINE_STEP;
        offset[i] = next < -limit ? -limit : next > limit ? limit : next;
      }
    }
  }
  const points = offset.map((_, i) => at(i));
  const curvature = points.map((_, i) => {
    const a = points[(i - 3 + n) % n];
    const p = points[i];
    const b = points[(i + 3) % n];
    return circleCurvature(a, p, b);
  });
  const arc = [0];
  for (let i = 1; i < n; i++) arc.push(arc[i - 1] + track.segmentLengths[i - 1]);
  const length = arc[n - 1] + track.segmentLengths[n - 1];
  const gateIndex = track.gates.map((_, g) => Math.floor((g * n) / track.gates.length));
  const line = { offset, points, curvature, arc, length, gateIndex };
  lines.set(track, line);
  return line;
}

/** 1 / radius of the circle through three points (0 when straight). */
function circleCurvature(a: Vec2, b: Vec2, c: Vec2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const bcx = c.x - b.x;
  const bcy = c.y - b.y;
  const acx = c.x - a.x;
  const acy = c.y - a.y;
  const cross = Math.abs(abx * bcy - aby * bcx);
  const d = Math.sqrt((abx * abx + aby * aby) * (bcx * bcx + bcy * bcy) * (acx * acx + acy * acy));
  return d > 0 ? (2 * cross) / d : 0;
}

/** Share of the tyres' lateral grip the plan dares to use. */
export const PLAN_GRIP = 0.9;
/** Share of the brakes the plan counts on. */
export const PLAN_BRAKE = 0.75;
/**
 * Yaw the plan counts on, as a share of full steering lock. Above 1 because
 * a sliding car rotates more than its steering alone allows.
 */
export const PLAN_STEER = 1.3;
const MAX_PLAN_SPEED = 900;

const profiles = new Map<string, number[]>();

/** Fastest a car may go at a sample before its yaw rate runs out. */
function steerLimit(C: CarStats, kappa: number): number {
  if (kappa <= 1e-6) return MAX_PLAN_SPEED;
  // Yaw rate at speed v (above steerFullSpeed) is steerRate / (1 + v / steerDampSpeed);
  // a corner needs v * kappa of it.
  const a = kappa / C.steerDampSpeed;
  const v = (-kappa + Math.sqrt(kappa * kappa + 4 * a * C.steerRate * PLAN_STEER)) / (2 * a);
  return Math.max(30, v);
}

/**
 * Target speed at each sample for one car kind and setup on fresh tyres:
 * the corner limit (grip and steering), then a backward pass so the car can
 * brake down to every corner in time.
 */
export function speedProfile(track: Track, car: { kind?: CarKind; setup?: CarSetup }): number[] {
  const C = carStats(car);
  const key = `${track.def.id}|${car.kind}|${car.setup?.gearing ?? 0},${car.setup?.steering ?? 0},${car.setup?.grip ?? 0}`;
  const cached = profiles.get(key);
  if (cached) return cached;
  const line = racingLine(track);
  const n = line.points.length;
  const v = line.points.map((p, i) => {
    const k = line.curvature[i];
    const surface = SURFACES[surfaceAt(track, p.x, p.y)];
    const lat = k > 1e-6 ? Math.sqrt((C.lateralGrip * surface.grip * PLAN_GRIP) / k) : MAX_PLAN_SPEED;
    return Math.min(MAX_PLAN_SPEED, lat, steerLimit(C, k));
  });
  const brake = C.brakeDecel * PLAN_BRAKE;
  // Two laps backward so braking zones wrap past the start line.
  for (let pass = 0; pass < 2; pass++) {
    for (let k = n - 1; k >= 0; k--) {
      const next = v[(k + 1) % n];
      const ds = track.segmentLengths[k];
      const reach = Math.sqrt(next * next + 2 * brake * ds);
      if (reach < v[k]) v[k] = reach;
    }
  }
  profiles.set(key, v);
  return v;
}

/** Where the car is along the lap, by its nearest centerline sample. */
export function lapPosition(track: Track, idx: number): number {
  return racingLine(track).arc[idx];
}

/** Distance past the next gate without having crossed it (0 when not past). */
export function pastNextGate(track: Track, car: CarState, idx: number): number {
  const line = racingLine(track);
  const gate = line.gateIndex[car.nextCheckpoint] ?? 0;
  let d = line.arc[idx] - line.arc[gate];
  if (d < 0) d += line.length;
  return d < line.length / 2 ? d : 0;
}

/** How far past the next gate counts as having missed it. */
export const MISSED_GATE_DISTANCE = 45;

export function missedGate(track: Track, car: CarState, idx: number): boolean {
  return pastNextGate(track, car, idx) > MISSED_GATE_DISTANCE;
}
