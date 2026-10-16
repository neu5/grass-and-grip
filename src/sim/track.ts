import { datan2, normalizeAngle } from './dmath';

export type Vec2 = { x: number; y: number };

export type Surface = 'asphalt' | 'grass';

export interface Obstacle {
  x: number;
  y: number;
  r: number;
  kind: 'tyres' | 'tree';
}

export interface TrackDef {
  id: string;
  name: string;
  width: number;
  height: number;
  /** Closed loop of control points, driven in this order. */
  controlPoints: Vec2[];
  halfWidth: number;
  checkpointCount: number;
  obstacles: Obstacle[];
}

export interface Gate {
  a: Vec2;
  b: Vec2;
  center: Vec2;
  /** Unit tangent: direction of travel through the gate. */
  tx: number;
  ty: number;
}

export interface Track {
  def: TrackDef;
  /** Dense, closed centerline. samples[0] lies on the finish line. */
  samples: Vec2[];
  tangentAngles: number[];
  normals: Vec2[];
  /** Distance from samples[i] to samples[i+1]. */
  segmentLengths: number[];
  /** Local curvature (1/radius) at each sample. */
  curvature: number[];
  /** gates[0] is the start/finish line. */
  gates: Gate[];
}

const SAMPLES_PER_SEGMENT = 16;

function catmullRom(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x:
      0.5 *
      (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y:
      0.5 *
      (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  };
}

export function buildTrack(def: TrackDef): Track {
  const cp = def.controlPoints;
  const n = cp.length;
  const samples: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = cp[(i - 1 + n) % n];
    const p1 = cp[i];
    const p2 = cp[(i + 1) % n];
    const p3 = cp[(i + 2) % n];
    for (let s = 0; s < SAMPLES_PER_SEGMENT; s++) {
      samples.push(catmullRom(p0, p1, p2, p3, s / SAMPLES_PER_SEGMENT));
    }
  }
  const m = samples.length;
  const tangentAngles: number[] = [];
  const normals: Vec2[] = [];
  for (let i = 0; i < m; i++) {
    const prev = samples[(i - 1 + m) % m];
    const next = samples[(i + 1) % m];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    tangentAngles.push(datan2(dy, dx));
    normals.push({ x: -dy / len, y: dx / len });
  }
  const segmentLengths: number[] = [];
  for (let i = 0; i < m; i++) {
    const a = samples[i];
    const b = samples[(i + 1) % m];
    segmentLengths.push(Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y)));
  }
  const curvature: number[] = [];
  const span = 2;
  for (let i = 0; i < m; i++) {
    let arc = 0;
    for (let k = -span; k < span; k++) arc += segmentLengths[(i + k + m) % m];
    const turn = normalizeAngle(tangentAngles[(i + span) % m] - tangentAngles[(i - span + m) % m]);
    curvature.push((turn < 0 ? -turn : turn) / arc);
  }
  const gates: Gate[] = [];
  const gateHalf = def.halfWidth + 30;
  for (let g = 0; g < def.checkpointCount; g++) {
    const idx = Math.floor((g * m) / def.checkpointCount);
    const c = samples[idx];
    const nrm = normals[idx];
    gates.push({
      a: { x: c.x - nrm.x * gateHalf, y: c.y - nrm.y * gateHalf },
      b: { x: c.x + nrm.x * gateHalf, y: c.y + nrm.y * gateHalf },
      center: { x: c.x, y: c.y },
      tx: nrm.y,
      ty: -nrm.x,
    });
  }
  return { def, samples, tangentAngles, normals, segmentLengths, curvature, gates };
}

export function distToSegmentSq(px: number, py: number, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  let t = len2 > 0 ? ((px - a.x) * abx + (py - a.y) * aby) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = a.x + abx * t - px;
  const dy = a.y + aby * t - py;
  return dx * dx + dy * dy;
}

export function distanceToCenterline(track: Track, x: number, y: number): number {
  const s = track.samples;
  let best = Infinity;
  for (let i = 0; i < s.length; i++) {
    const d = distToSegmentSq(x, y, s[i], s[(i + 1) % s.length]);
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

export function surfaceAt(track: Track, x: number, y: number): Surface {
  return distanceToCenterline(track, x, y) <= track.def.halfWidth ? 'asphalt' : 'grass';
}

export function nearestSampleIndex(track: Track, x: number, y: number): number {
  const s = track.samples;
  let best = Infinity;
  let bi = 0;
  for (let i = 0; i < s.length; i++) {
    const dx = s[i].x - x;
    const dy = s[i].y - y;
    const d = dx * dx + dy * dy;
    if (d < best) {
      best = d;
      bi = i;
    }
  }
  return bi;
}

/** True if segment p->q crosses segment a->b. */
export function segmentsIntersect(p: Vec2, q: Vec2, a: Vec2, b: Vec2): boolean {
  const d1x = q.x - p.x;
  const d1y = q.y - p.y;
  const d2x = b.x - a.x;
  const d2y = b.y - a.y;
  const denom = d1x * d2y - d1y * d2x;
  if (denom === 0) return false;
  const ex = a.x - p.x;
  const ey = a.y - p.y;
  const t = (ex * d2y - ey * d2x) / denom;
  const u = (ex * d1y - ey * d1x) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

export const TRACKS: Record<string, TrackDef> = {
  meadow: {
    id: 'meadow',
    name: 'Meadow Ring',
    width: 1600,
    height: 1000,
    halfWidth: 58,
    checkpointCount: 8,
    controlPoints: [
      { x: 420, y: 170 },
      { x: 800, y: 150 },
      { x: 1150, y: 165 },
      { x: 1420, y: 260 },
      { x: 1440, y: 450 },
      { x: 1250, y: 530 },
      { x: 990, y: 470 },
      { x: 790, y: 540 },
      { x: 800, y: 720 },
      { x: 1080, y: 720 },
      { x: 1380, y: 770 },
      { x: 1330, y: 890 },
      { x: 1000, y: 890 },
      { x: 560, y: 870 },
      { x: 260, y: 800 },
      { x: 150, y: 560 },
      { x: 190, y: 290 },
    ],
    obstacles: [
      { x: 520, y: 520, r: 20, kind: 'tyres' },
      { x: 600, y: 450, r: 16, kind: 'tyres' },
      { x: 1180, y: 360, r: 18, kind: 'tyres' },
      { x: 1580, y: 600, r: 18, kind: 'tyres' },
      { x: 1480, y: 100, r: 16, kind: 'tree' },
      { x: 130, y: 940, r: 18, kind: 'tree' },
      { x: 100, y: 160, r: 15, kind: 'tree' },
      { x: 430, y: 310, r: 17, kind: 'tree' },
      { x: 1510, y: 880, r: 16, kind: 'tree' },
      { x: 400, y: 640, r: 18, kind: 'tree' },
      { x: 310, y: 520, r: 15, kind: 'tree' },
      { x: 1390, y: 640, r: 16, kind: 'tree' },
      { x: 730, y: 340, r: 17, kind: 'tree' },
      { x: 640, y: 670, r: 15, kind: 'tree' },
      { x: 1300, y: 70, r: 14, kind: 'tree' },
      { x: 970, y: 340, r: 16, kind: 'tree' },
    ],
  },
};

const cache = new Map<string, Track>();

export function getTrack(id: string): Track {
  let t = cache.get(id);
  if (!t) {
    const def = TRACKS[id];
    if (!def) throw new Error(`Unknown track: ${id}`);
    t = buildTrack(def);
    cache.set(id, t);
  }
  return t;
}
