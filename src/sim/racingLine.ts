import { carStats, surfaceFor, tyreFactor, TYRE, type CarStats } from './physics';
import { surfaceAt, type Track, type Vec2 } from './track';
import type { CarKind, CarSetup, CarState } from './types';

/** How far the line stays inside the road edge (car half-width plus a little). */
const LINE_MARGIN = 18;
/**
 * Relax at these neighbour spans (road distance), wide first: a pair of
 * corners close together on a wide road settles into one long arc.
 */
const LINE_SCALES = [200, 100, 50, 25, 12, 6, 2];
const LINE_ITERATIONS = 60;
const LINE_STEP = 0.5;
/** Curvature-evening passes, wide neighbours first (road distance). */
const EVEN_SCALES = [100, 50, 25, 12, 6, 4, 2];
/** How fast the inside limit may change along the road (sideways units per unit). */
const BOUND_SLOPE = 0.4;
const EVEN_ITERATIONS = 60;
const EVEN_STEP = 0.4;
const EVEN_PROBE = 0.5;
/** Share of a corner's radius the line may cut toward its centre. */
const INSIDE_SHARE = 0.9;
/** Half the stretch the line's bend is measured over: about a car length, what a car actually steers through. */
const BEND_REACH = 12;

export interface RacingLine {
  /** Lateral offset from the centerline sample, along its normal. */
  offset: number[];
  points: Vec2[];
  /** 1 / radius of the line at each sample. */
  curvature: number[];
  /** Signed curvature: positive bends right (clockwise on the map). */
  bend: number[];
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
  // On a corner tighter than the road is wide, the inside edge folds over
  // itself: keep the line well short of the corner's centre there.
  const lo = new Array<number>(n).fill(-limit);
  const hi = new Array<number>(n).fill(limit);
  for (let i = 0; i < n; i++) {
    let k = 0;
    for (let d = -6; d <= 6; d++) {
      const c = signedCurvature(s[(i + d - 2 + n * 2) % n], s[(i + d + n) % n], s[(i + d + 2 + n) % n]);
      if (Math.abs(c) > Math.abs(k)) k = c;
    }
    const inside = Math.abs(k) > 1e-6 ? INSIDE_SHARE / Math.abs(k) : Infinity;
    if (k > 0) hi[i] = Math.min(limit, inside);
    else if (k < 0) lo[i] = Math.max(-limit, -inside);
  }
  // Ease the limits in and out, so the line is never forced to jump sideways.
  const seg = track.segmentLengths;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      const p = (i - 1 + n) % n;
      hi[i] = Math.min(hi[i], hi[p] + BOUND_SLOPE * seg[p]);
      lo[i] = Math.max(lo[i], lo[p] - BOUND_SLOPE * seg[p]);
    }
    for (let i = n - 1; i >= 0; i--) {
      const q = (i + 1) % n;
      hi[i] = Math.min(hi[i], hi[q] + BOUND_SLOPE * seg[i]);
      lo[i] = Math.max(lo[i], lo[q] - BOUND_SLOPE * seg[i]);
    }
  }
  const spacing = (track.segmentLengths.reduce((a, b) => a + b, 0) / n) || 1;
  const samplesFor = (units: number) => Math.max(1, Math.round(units / spacing));
  const offset = new Array<number>(n).fill(0);
  const at = (i: number) => {
    const k = ((i % n) + n) % n;
    return { x: s[k].x + nrm[k].x * offset[k], y: s[k].y + nrm[k].y * offset[k] };
  };
  for (const span of LINE_SCALES.map(samplesFor)) {
    for (let it = 0; it < LINE_ITERATIONS; it++) {
      for (let i = 0; i < n; i++) {
        const a = at(i - span);
        const b = at(i + span);
        const mx = (a.x + b.x) / 2 - s[i].x;
        const my = (a.y + b.y) / 2 - s[i].y;
        const want = mx * nrm[i].x + my * nrm[i].y;
        const next = offset[i] + (want - offset[i]) * LINE_STEP;
        offset[i] = next < lo[i] ? lo[i] : next > hi[i] ? hi[i] : next;
      }
    }
  }
  // Then even out the bending (K1999-style): nudge each point sideways until
  // its curvature is the average of its neighbours'. Smoothing alone hugs the
  // inside of a long hairpin and leaves a very tight kink at its end; evening
  // out the curvature takes that kink wide instead.
  for (const span of EVEN_SCALES.map(samplesFor)) {
    for (let it = 0; it < EVEN_ITERATIONS; it++) {
      for (let i = 0; i < n; i++) {
        const prev = at(i - span);
        const next = at(i + span);
        const want = (signedCurvature(at(i - 2 * span), prev, at(i)) + signedCurvature(at(i), next, at(i + 2 * span))) / 2;
        const o = offset[i];
        const k = ((i % n) + n) % n;
        const here = signedCurvature(prev, at(i), next);
        offset[k] = o + EVEN_PROBE;
        const probe = signedCurvature(prev, at(i), next);
        offset[k] = o;
        const slope = (probe - here) / EVEN_PROBE;
        if (Math.abs(slope) < 1e-9) continue;
        const moved = o + ((want - here) / slope) * EVEN_STEP;
        offset[k] = moved < lo[k] ? lo[k] : moved > hi[k] ? hi[k] : moved;
      }
    }
  }
  const points = offset.map((_, i) => at(i));
  const reach = samplesFor(BEND_REACH);
  // Never tighter than the road's own centre there: where the line pinches
  // round the inside of a hairpin, a car rounds that pinch off anyway.
  const curvature = points.map((_, i) => {
    const line = circleCurvature(points[(i - reach + n) % n], points[i], points[(i + reach) % n]);
    const road = circleCurvature(s[(i - reach + n) % n], s[i], s[(i + reach) % n]);
    return Math.min(line, Math.max(road, 1e-4));
  });
  const bend = points.map((_, i) => signedCurvature(points[(i - reach + n) % n], points[i], points[(i + reach) % n]));
  const arc = [0];
  for (let i = 1; i < n; i++) arc.push(arc[i - 1] + track.segmentLengths[i - 1]);
  const length = arc[n - 1] + track.segmentLengths[n - 1];
  const gateIndex = track.gates.map((g) => g.index);
  const line = { offset, points, curvature, bend, arc, length, gateIndex };
  lines.set(track, line);
  return line;
}

/** Curvature through three points, positive when turning toward the normal side. */
function signedCurvature(a: Vec2, b: Vec2, c: Vec2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const bcx = c.x - b.x;
  const bcy = c.y - b.y;
  const acx = c.x - a.x;
  const acy = c.y - a.y;
  const d = Math.sqrt((abx * abx + aby * aby) * (bcx * bcx + bcy * bcy) * (acx * acx + acy * acy));
  return d > 0 ? (2 * (abx * bcy - aby * bcx)) / d : 0;
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

/**
 * How much of the car the speed plan dares to use: share of the tyres'
 * lateral grip, of the brakes, and of the yaw (above 1 because a sliding car
 * rotates more than its steering alone allows). AI levels up to `from` plan
 * with the careful set; from there to level 1 they blend into the full set.
 */
export const PLAN_TUNE = {
  from: 0.7,
  careful: { grip: 0.9, brake: 0.75, steer: 1.1 },
  full: { grip: 1.05, brake: 1.0, steer: 1.3 },
};
const MAX_PLAN_SPEED = 900;

export interface PlanMargins {
  grip: number;
  brake: number;
  steer: number;
}

/** Plan margins for an AI level 0..1, in steps of 0.05 so plans can be cached. */
export function planMargins(level = 0): PlanMargins {
  const { from, careful, full } = PLAN_TUNE;
  const step = Math.round(Math.min(1, Math.max(0, level)) * 20) / 20;
  const t = step <= from ? 0 : (step - from) / (1 - from);
  const mix = (a: number, b: number) => a + (b - a) * t;
  return { grip: mix(careful.grip, full.grip), brake: mix(careful.brake, full.brake), steer: mix(careful.steer, full.steer) };
}

/** Per track (so an edited track gets fresh plans), then per kind + setup + margins. */
const profiles = new WeakMap<Track, Map<string, number[]>>();

/** Fastest a car may go at a sample before its yaw rate runs out. */
function steerLimit(C: CarStats, kappa: number, yawShare: number): number {
  if (kappa <= 1e-6) return MAX_PLAN_SPEED;
  // Yaw rate at speed v (above steerFullSpeed) is steerRate / (1 + v / steerDampSpeed);
  // a corner needs v * kappa of it.
  const a = kappa / C.steerDampSpeed;
  const v = (-kappa + Math.sqrt(kappa * kappa + 4 * a * C.steerRate * yawShare)) / (2 * a);
  return Math.max(30, v);
}

/**
 * Target speed at each sample for one car kind and setup on fresh tyres:
 * the corner limit (grip on this car's tyres for the surface, and steering),
 * then a backward pass so the car can brake down to every corner in time.
 * `level` (AI level 0..1) sets how close to the limit the plan goes, and
 * `wear` (tyre wear 0..1, in steps of 0.1) how much grip and braking the
 * tyres have left.
 */
export function speedProfile(track: Track, car: { kind?: CarKind; setup?: CarSetup }, level = 0, wear = 0): number[] {
  const C = carStats(car);
  const m = planMargins(level);
  const w = Math.round(Math.min(1, Math.max(0, wear)) * 10) / 10;
  const gripLeft = tyreFactor(w, TYRE.wornGrip);
  const brakeLeft = tyreFactor(w, TYRE.wornBrake);
  const key = `${car.kind}|${car.setup?.gearing ?? 0},${car.setup?.steering ?? 0},${car.setup?.grip ?? 0}|${m.grip},${m.brake},${m.steer}|${w}`;
  let perTrack = profiles.get(track);
  if (!perTrack) {
    perTrack = new Map();
    profiles.set(track, perTrack);
  }
  const cached = perTrack.get(key);
  if (cached) return cached;
  const line = racingLine(track);
  const n = line.points.length;
  const v = line.points.map((p, i) => {
    const k = line.curvature[i];
    const surface = surfaceFor(C, surfaceAt(track, p.x, p.y));
    const lat = k > 1e-6 ? Math.sqrt((C.lateralGrip * surface.grip * m.grip * gripLeft) / k) : MAX_PLAN_SPEED;
    return Math.min(MAX_PLAN_SPEED, lat, steerLimit(C, k, m.steer));
  });
  const brake = (C.brakeDecel / C.mass) * m.brake * brakeLeft;
  // Two laps backward so braking zones wrap past the start line.
  for (let pass = 0; pass < 2; pass++) {
    for (let k = n - 1; k >= 0; k--) {
      const next = v[(k + 1) % n];
      const ds = track.segmentLengths[k];
      const reach = Math.sqrt(next * next + 2 * brake * ds);
      if (reach < v[k]) v[k] = reach;
    }
  }
  perTrack.set(key, v);
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
