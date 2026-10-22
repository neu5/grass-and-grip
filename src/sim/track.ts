import { datan2, normalizeAngle } from './dmath';

export type Vec2 = { x: number; y: number };

export type Surface = 'asphalt' | 'grass' | 'sand' | 'water';

export const TRACK_IDS = ['meadow', 'harbor'] as const;
export type TrackId = (typeof TRACK_IDS)[number];

/** Marked stalls on tracks that have a pit lane. */
export const PIT_STALLS = 4;
const PIT_BOX_W = 90;
const PIT_BOX_H = 54;
const PIT_BOX_GAP = 12;
const PIT_BOX_Y = 32;
const PIT_LANE_PAD = 20;

function pitComplex(firstBoxX: number): { pitLane: Rect; pitBoxes: Rect[] } {
  const pitBoxes: Rect[] = [];
  for (let i = 0; i < PIT_STALLS; i++) {
    pitBoxes.push({
      x: firstBoxX + i * (PIT_BOX_W + PIT_BOX_GAP),
      y: PIT_BOX_Y,
      w: PIT_BOX_W,
      h: PIT_BOX_H,
    });
  }
  const last = pitBoxes[PIT_STALLS - 1];
  return {
    pitLane: {
      x: firstBoxX - PIT_LANE_PAD,
      y: 12,
      w: last.x + last.w + PIT_LANE_PAD - (firstBoxX - PIT_LANE_PAD),
      h: 180,
    },
    pitBoxes,
  };
}

export const TRACK_NAMES: Record<TrackId, string> = {
  meadow: 'Meadow Ring',
  harbor: 'Harbor Bridge',
};

export function isTrackId(id: string | undefined): id is TrackId {
  return !!id && (TRACK_IDS as readonly string[]).includes(id);
}

/** Axis-aligned rectangle in world units. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Elevated asphalt deck over water. */
export interface Bridge {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Deck height in world units. */
  height: number;
}

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
  /** Paved apron connecting the racing surface to the stall boxes. */
  pitLane: Rect;
  /** Marked stalls. Service only while a car is stopped inside one. */
  pitBoxes: Rect[];
  /** Off-track sand (beaches, runoff). Track/bridge still win. */
  sand?: Rect[];
  /** Lakes / rivers. Bridge and racing line stay asphalt. */
  water?: Rect[];
  /** Elevated decks over water. */
  bridges?: Bridge[];
  /** Height at each control point (same length). Default 0. */
  controlHeights?: number[];
}

export interface Gate {
  a: Vec2;
  b: Vec2;
  center: Vec2;
  /** Unit tangent: direction of travel through the gate. */
  tx: number;
  ty: number;
}

export interface HeightGrid {
  cols: number;
  rows: number;
  step: number;
  data: Float32Array;
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
  /** Height at each sample, matching `samples`. */
  sampleHeights: number[];
  /** Dense 2D height field. Null when the track is flat. */
  heightGrid: HeightGrid | null;
  /** gates[0] is the start/finish line. */
  gates: Gate[];
}

const SAMPLES_PER_SEGMENT = 24;
const HEIGHT_GRID_STEP = 4;
const HEIGHT_SMOOTH_PASSES = 8;

function catmullRom1(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

function catmullRom(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
  return { x: catmullRom1(p0.x, p1.x, p2.x, p3.x, t), y: catmullRom1(p0.y, p1.y, p2.y, p3.y, t) };
}

export function buildTrack(def: TrackDef): Track {
  const cp = def.controlPoints;
  const n = cp.length;
  const hz = def.controlHeights ?? cp.map(() => 0);
  const samples: Vec2[] = [];
  const sampleHeights: number[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = cp[(i - 1 + n) % n];
    const p1 = cp[i];
    const p2 = cp[(i + 1) % n];
    const p3 = cp[(i + 2) % n];
    const h0 = hz[(i - 1 + n) % n];
    const h1 = hz[i];
    const h2 = hz[(i + 1) % n];
    const h3 = hz[(i + 2) % n];
    for (let s = 0; s < SAMPLES_PER_SEGMENT; s++) {
      const t = s / SAMPLES_PER_SEGMENT;
      samples.push(catmullRom(p0, p1, p2, p3, t));
      sampleHeights.push(catmullRom1(h0, h1, h2, h3, t));
    }
  }
  if (def.controlHeights) smoothClosed(sampleHeights, HEIGHT_SMOOTH_PASSES);
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
  const heightGrid = def.controlHeights ? buildHeightGrid(def, samples, sampleHeights) : null;
  return { def, samples, tangentAngles, normals, segmentLengths, curvature, sampleHeights, heightGrid, gates };
}

function smoothClosed(values: number[], passes: number): void {
  const n = values.length;
  const tmp = new Array<number>(n);
  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < n; i++) {
      tmp[i] = 0.25 * values[(i - 1 + n) % n] + 0.5 * values[i] + 0.25 * values[(i + 1) % n];
    }
    for (let i = 0; i < n; i++) values[i] = tmp[i];
  }
}

function projectCenterline(
  samples: Vec2[],
  heights: number[],
  x: number,
  y: number,
): { dist: number; height: number } {
  const n = samples.length;
  let best = Infinity;
  let height = heights[0] ?? 0;
  let seg = 0;
  let along = 0;
  for (let i = 0; i < n; i++) {
    const a = samples[i];
    const b = samples[(i + 1) % n];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const len2 = abx * abx + aby * aby;
    let t = len2 > 0 ? ((x - a.x) * abx + (y - a.y) * aby) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = a.x + abx * t - x;
    const dy = a.y + aby * t - y;
    const d = dx * dx + dy * dy;
    if (d < best) {
      best = d;
      seg = i;
      along = t;
    }
  }
  const h0 = heights[(seg - 1 + n) % n];
  const h1 = heights[seg];
  const h2 = heights[(seg + 1) % n];
  const h3 = heights[(seg + 2) % n];
  height = catmullRom1(h0, h1, h2, h3, along);
  return { dist: Math.sqrt(best), height };
}

function buildHeightGrid(def: TrackDef, samples: Vec2[], heights: number[]): HeightGrid {
  const step = HEIGHT_GRID_STEP;
  const cols = Math.floor(def.width / step) + 1;
  const rows = Math.floor(def.height / step) + 1;
  const data = new Float32Array(cols * rows);
  let base = heights[0] ?? 0;
  for (const h of heights) if (h < base) base = h;
  const inner = def.halfWidth + 6;
  const outer = def.halfWidth + 220;
  const span = outer - inner;
  for (let r = 0; r < rows; r++) {
    const y = r * step;
    for (let c = 0; c < cols; c++) {
      const x = c * step;
      const hit = projectCenterline(samples, heights, x, y);
      let t = (hit.dist - inner) / span;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const s = t * t * (3 - 2 * t);
      data[r * cols + c] = hit.height * (1 - s) + base * s;
    }
  }
  blurHeightGrid(data, cols, rows, 2);
  return { cols, rows, step, data };
}

function blurHeightGrid(data: Float32Array, cols: number, rows: number, passes: number): void {
  const tmp = new Float32Array(data.length);
  const at = (c: number, r: number) =>
    data[(r < 0 ? 0 : r >= rows ? rows - 1 : r) * cols + (c < 0 ? 0 : c >= cols ? cols - 1 : c)];
  for (let p = 0; p < passes; p++) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        tmp[r * cols + c] =
          at(c, r) * 0.25 +
          (at(c - 1, r) + at(c + 1, r) + at(c, r - 1) + at(c, r + 1)) * 0.125 +
          (at(c - 1, r - 1) + at(c + 1, r - 1) + at(c - 1, r + 1) + at(c + 1, r + 1)) * 0.0625;
      }
    }
    data.set(tmp);
  }
}

function sampleHeightGrid(grid: HeightGrid, x: number, y: number): number {
  const { cols, rows, step, data } = grid;
  const fx = x / step;
  const fy = y / step;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fx - ix;
  const ty = fy - iy;
  const at = (c: number, r: number) => {
    const cc = c < 0 ? 0 : c >= cols ? cols - 1 : c;
    const rr = r < 0 ? 0 : r >= rows ? rows - 1 : r;
    return data[rr * cols + cc];
  };
  const col: number[] = [];
  for (let j = -1; j <= 2; j++) {
    col.push(catmullRom1(at(ix - 1, iy + j), at(ix, iy + j), at(ix + 1, iy + j), at(ix + 2, iy + j), tx));
  }
  return catmullRom1(col[0], col[1], col[2], col[3], ty);
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

export function pointInRect(x: number, y: number, r: Rect): boolean {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

export function pitBoxIndex(track: Track, x: number, y: number): number {
  const boxes = track.def.pitBoxes;
  for (let i = 0; i < boxes.length; i++) {
    if (pointInRect(x, y, boxes[i])) return i;
  }
  return -1;
}

export function inPitLane(track: Track, x: number, y: number): boolean {
  return pointInRect(x, y, track.def.pitLane) || pitBoxIndex(track, x, y) >= 0;
}

function inAnyRect(x: number, y: number, rects: Rect[] | undefined): boolean {
  if (!rects) return false;
  for (const r of rects) if (pointInRect(x, y, r)) return true;
  return false;
}

export function inWater(track: Track, x: number, y: number): boolean {
  return inAnyRect(x, y, track.def.water);
}

export function inSand(track: Track, x: number, y: number): boolean {
  return inAnyRect(x, y, track.def.sand);
}

export function bridgeAt(track: Track, x: number, y: number): Bridge | null {
  const bridges = track.def.bridges;
  if (!bridges) return null;
  for (const b of bridges) if (pointInRect(x, y, b)) return b;
  return null;
}

export function inBridge(track: Track, x: number, y: number): boolean {
  return bridgeAt(track, x, y) !== null;
}

export function onRacingSurface(track: Track, x: number, y: number): boolean {
  return inPitLane(track, x, y) || inBridge(track, x, y) || distanceToCenterline(track, x, y) <= track.def.halfWidth;
}

export function surfaceAt(track: Track, x: number, y: number): Surface {
  if (onRacingSurface(track, x, y)) return 'asphalt';
  if (inWater(track, x, y)) return 'water';
  if (inSand(track, x, y)) return 'sand';
  return 'grass';
}

/** Lake surface (world Y). Cars in water sit below this so hull/wheels are in it. */
export const WATER_SURFACE = 0;
/** Visual lake bed. */
export const WATER_BED = -16;
/** Car origin while swimming: wheels/hull in the surface, not hovering on it. */
export const WATER_FLOAT = -7;

function fieldHeight(track: Track, x: number, y: number): number {
  if (track.heightGrid) return sampleHeightGrid(track.heightGrid, x, y);
  return 0;
}

/** Ground height under a point. Smooth along the road; water sits below the surface. */
export function heightAt(track: Track, x: number, y: number): number {
  if (surfaceAt(track, x, y) === 'water') return WATER_FLOAT;
  return fieldHeight(track, x, y);
}

/** Visual terrain, including a sloped lake bed. Cars use `heightAt`. */
export function terrainHeightAt(track: Track, x: number, y: number): number {
  const h = fieldHeight(track, x, y);
  if (onRacingSurface(track, x, y)) return h;
  if (!inWater(track, x, y)) return h;
  const d = distanceToCenterline(track, x, y);
  const t = Math.min(1, Math.max(0, (d - track.def.halfWidth) / 56));
  const s = t * t * (3 - 2 * t);
  return h + (WATER_BED - h) * s;
}

/** Pitch (nose) and roll from the height field. Continuous — no per-tile snaps. */
export function slopeAttitude(
  track: Track,
  x: number,
  y: number,
  angle: number,
): { pitch: number; roll: number } {
  if (surfaceAt(track, x, y) === 'water') return { pitch: 0, roll: 0 };
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const along = 18;
  const across = 14;
  const hF = fieldHeight(track, x + along * ca, y + along * sa);
  const hB = fieldHeight(track, x - along * ca, y - along * sa);
  const hL = fieldHeight(track, x - across * sa, y + across * ca);
  const hR = fieldHeight(track, x + across * sa, y - across * ca);
  return {
    pitch: Math.max(-0.38, Math.min(0.38, Math.atan2(hB - hF, along * 2))),
    roll: Math.max(-0.28, Math.min(0.28, Math.atan2(hL - hR, across * 2))),
  };
}

/** Cars this far apart in height do not collide (bridge vs water). */
export const HEIGHT_SEPARATION = 22;

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
    height: 1050,
    halfWidth: 58,
    checkpointCount: 8,
    // Shifted south a bit vs the original layout so four pit stalls fit
    // off the racing line, outside the start/finish straight.
    controlPoints: [
      { x: 420, y: 220 },
      { x: 800, y: 200 },
      { x: 1150, y: 215 },
      { x: 1420, y: 310 },
      { x: 1440, y: 500 },
      { x: 1250, y: 580 },
      { x: 990, y: 520 },
      { x: 790, y: 590 },
      { x: 800, y: 770 },
      { x: 1080, y: 770 },
      { x: 1380, y: 820 },
      { x: 1330, y: 940 },
      { x: 1000, y: 940 },
      { x: 560, y: 920 },
      { x: 260, y: 850 },
      { x: 150, y: 610 },
      { x: 190, y: 340 },
    ],
    obstacles: [
      { x: 520, y: 570, r: 20, kind: 'tyres' },
      { x: 600, y: 500, r: 16, kind: 'tyres' },
      { x: 1180, y: 410, r: 18, kind: 'tyres' },
      { x: 1580, y: 650, r: 18, kind: 'tyres' },
      { x: 1480, y: 150, r: 16, kind: 'tree' },
      { x: 130, y: 990, r: 18, kind: 'tree' },
      { x: 100, y: 210, r: 15, kind: 'tree' },
      { x: 430, y: 360, r: 17, kind: 'tree' },
      { x: 1510, y: 930, r: 16, kind: 'tree' },
      { x: 400, y: 690, r: 18, kind: 'tree' },
      { x: 310, y: 570, r: 15, kind: 'tree' },
      { x: 1390, y: 690, r: 16, kind: 'tree' },
      { x: 730, y: 390, r: 17, kind: 'tree' },
      { x: 640, y: 720, r: 15, kind: 'tree' },
      { x: 1300, y: 120, r: 14, kind: 'tree' },
      { x: 970, y: 390, r: 16, kind: 'tree' },
    ],
    // After the S/F line (x≈420), outside the racing line (smaller y).
    ...pitComplex(500),
  },
  harbor: {
    id: 'harbor',
    name: 'Harbor Bridge',
    width: 1600,
    height: 1050,
    halfWidth: 54,
    checkpointCount: 8,
    controlPoints: [
      { x: 400, y: 210 },
      { x: 620, y: 196 },
      { x: 840, y: 190 },
      { x: 1060, y: 205 },
      { x: 1240, y: 248 },
      { x: 1365, y: 310 },
      { x: 1434, y: 385 },
      { x: 1466, y: 460 },
      { x: 1476, y: 535 },
      { x: 1466, y: 610 },
      { x: 1424, y: 688 },
      { x: 1335, y: 768 },
      { x: 1180, y: 845 },
      { x: 960, y: 902 },
      { x: 720, y: 914 },
      { x: 480, y: 880 },
      { x: 280, y: 790 },
      { x: 168, y: 640 },
      { x: 158, y: 470 },
      { x: 190, y: 330 },
      { x: 280, y: 235 },
    ],
    // Long gentle grade onto the deck — climb starts on the north straight.
    controlHeights: [6, 8, 11, 15, 20, 26, 33, 41, 48, 52, 48, 40, 31, 23, 16, 12, 9, 7, 6, 6, 6],
    water: [
      { x: 360, y: 390, w: 640, h: 300 },
      { x: 980, y: 405, w: 600, h: 285 },
    ],
    bridges: [{ x: 1408, y: 488, w: 130, h: 120, height: 52 }],
    sand: [
      { x: 1080, y: 720, w: 380, h: 155 },
      { x: 180, y: 730, w: 270, h: 130 },
    ],
    obstacles: [
      { x: 620, y: 430, r: 16, kind: 'tyres' },
      { x: 860, y: 360, r: 18, kind: 'tyres' },
      { x: 1180, y: 360, r: 16, kind: 'tyres' },
      { x: 1540, y: 180, r: 16, kind: 'tree' },
      { x: 120, y: 120, r: 15, kind: 'tree' },
      { x: 90, y: 980, r: 18, kind: 'tree' },
      { x: 1520, y: 980, r: 16, kind: 'tree' },
      { x: 430, y: 340, r: 15, kind: 'tree' },
      { x: 980, y: 980, r: 17, kind: 'tree' },
      { x: 250, y: 980, r: 14, kind: 'tree' },
      { x: 1240, y: 115, r: 16, kind: 'tree' },
      { x: 1550, y: 780, r: 15, kind: 'tree' },
    ],
    ...pitComplex(480),
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
