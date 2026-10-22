import { datan2, normalizeAngle } from './dmath';

export type Vec2 = { x: number; y: number };

export type Surface = 'asphalt' | 'grass' | 'sand' | 'water' | 'gravel' | 'snow' | 'ice';

/** Surfaces a patch can paint. */
export const PATCH_SURFACES = ['grass', 'sand', 'gravel', 'snow', 'ice'] as const;

export const TRACK_IDS = ['meadow', 'harbor', 'alpine'] as const;
export type TrackId = (typeof TRACK_IDS)[number];

/** Marked stalls on tracks that have a pit lane. */
export const PIT_STALLS = 4;
const PIT_BOX_W = 90;
const PIT_BOX_H = 54;
const PIT_BOX_GAP = 12;
const PIT_BOX_Y = 32;
const PIT_LANE_PAD = 20;

export function pitComplex(firstBoxX: number): { pitLane: Rect; pitBoxes: Rect[] } {
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
  alpine: 'Alpine Pass',
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

/**
 * Elevated deck over water. The rect marks which stretch of road is bridged;
 * the deck itself follows the road, `BRIDGE_DECK_MARGIN` past each edge.
 */
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
  /** Trees and tyre stacks are fixed; cones get knocked about (see `GameState.props`). */
  kind: 'tyres' | 'tree' | 'cone';
}

/** Painted ground: a polygon of one surface. */
export interface SurfacePatch {
  surface: Surface;
  points: Vec2[];
  /** Paints over the road too (an ice sheet across the tarmac). */
  overRoad?: boolean;
}

/** A straight run of concrete barrier blocks. */
export interface Barrier {
  a: Vec2;
  b: Vec2;
}

export interface PatchShape extends SurfacePatch {
  box: Rect;
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
  /** Painted ground (run-offs, snow, ice). Later patches win. */
  patches?: SurfacePatch[];
  /** Ground off the road where nothing is painted. Default grass. */
  ground?: Surface;
  /** Barrier walls along the edge of the run-off. */
  barriers?: Barrier[];
  /** Rivers. Bridge and racing line stay asphalt. */
  rivers?: River[];
  /** Elevated decks over water. */
  bridges?: Bridge[];
  /** Rolling ground. Flat at 0 when absent. */
  terrain?: Terrain;
}

/** Water within `halfWidth` of a smooth line through `points` (may run off the map). */
export interface River {
  points: Vec2[];
  halfWidth: number;
}

/** A round bump of `h` units, falling off over radius `r`. */
export interface Hill {
  x: number;
  y: number;
  r: number;
  h: number;
}

/** Land height: `base` plus hills; valleys dip to the river banks. The road follows it, smoothed. */
export interface Terrain {
  base: number;
  hills: Hill[];
}

export interface RiverLine {
  points: Vec2[];
  halfWidth: number;
  box: Rect;
}

export interface Gate {
  a: Vec2;
  b: Vec2;
  center: Vec2;
  /** Unit tangent: direction of travel through the gate. */
  tx: number;
  ty: number;
  /** Centerline sample the gate stands on. */
  index: number;
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
  /** Dense river center lines. */
  rivers: RiverLine[];
  patches: PatchShape[];
  /** gates[0] is the start/finish line. */
  gates: Gate[];
}

const SAMPLES_PER_SEGMENT = 24;
const HEIGHT_GRID_STEP = 4;
const HEIGHT_SMOOTH_PASSES = 8;
/** Arc length over which the road eases onto a flat bridge deck. */
const BRIDGE_RAMP = 220;
/** How far the land shape may drift from its target; bigger = rounder hills. */
const TERRAIN_SMOOTH_LENGTH = 36;
/** Distance from shore to full river depth. */
const SHORE_SLOPE = 30;
/** Land eases down to the river over this distance from the bank. */
const RIVER_VALLEY = 190;
/** Hills flatten out over this distance from the map edge. */
const EDGE_FADE = 140;
/** Land height right at a river bank. */
const BANK_HEIGHT = 2;
/** Arc length the road grade is averaged over, so it rolls instead of copying every bump. */
const ROAD_GRADE_SMOOTH = 85;

function catmullRom1(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

function catmullRom(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
  return { x: catmullRom1(p0.x, p1.x, p2.x, p3.x, t), y: catmullRom1(p0.y, p1.y, p2.y, p3.y, t) };
}

/** `grid: false` skips the height field: cheap enough for live editor checks. */
export function buildTrack(def: TrackDef, opts: { grid?: boolean } = {}): Track {
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
  const rivers = (def.rivers ?? []).map(buildRiverLine);
  const sampleHeights = samples.map((p) => (def.terrain ? landHeight(def, rivers, p.x, p.y) : 0));
  if (def.terrain) {
    smoothAlongArc(samples, sampleHeights, ROAD_GRADE_SMOOTH);
    smoothClosed(sampleHeights, HEIGHT_SMOOTH_PASSES);
    for (const b of def.bridges ?? []) easeOntoBridge(samples, sampleHeights, b);
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
  for (let g = 0; g < def.checkpointCount; g++) {
    const idx = gateSample(g, def.checkpointCount, curvature);
    const c = samples[idx];
    const nrm = normals[idx];
    const reachA = gateReach(def, samples, segmentLengths, idx, -1);
    const reachB = gateReach(def, samples, segmentLengths, idx, 1);
    gates.push({
      a: { x: c.x - nrm.x * reachA, y: c.y - nrm.y * reachA },
      b: { x: c.x + nrm.x * reachB, y: c.y + nrm.y * reachB },
      center: { x: c.x, y: c.y },
      tx: nrm.y,
      ty: -nrm.x,
      index: idx,
    });
  }
  const heightGrid = def.terrain && opts.grid !== false ? buildHeightGrid(def, samples, sampleHeights, rivers) : null;
  const patches = (def.patches ?? []).map(patchShape);
  return { def, samples, tangentAngles, normals, segmentLengths, curvature, sampleHeights, heightGrid, rivers, patches, gates };
}

function patchShape(p: SurfacePatch): PatchShape {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const q of p.points) {
    minX = Math.min(minX, q.x);
    minY = Math.min(minY, q.y);
    maxX = Math.max(maxX, q.x);
    maxY = Math.max(maxY, q.y);
  }
  return { ...p, box: { x: minX, y: minY, w: maxX - minX, h: maxY - minY } };
}

export function pointInPolygon(x: number, y: number, pts: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Rectangle as a patch polygon. */
export function rectPatch(surface: Surface, r: Rect): SurfacePatch {
  return {
    surface,
    points: [
      { x: r.x, y: r.y },
      { x: r.x + r.w, y: r.y },
      { x: r.x + r.w, y: r.y + r.h },
      { x: r.x, y: r.y + r.h },
    ],
  };
}

/** Topmost patch surface at a point, among patches that go over (or under) the road. */
function patchAt(track: Track, x: number, y: number, overRoad: boolean): Surface | null {
  const list = track.patches;
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    if (!!p.overRoad !== overRoad) continue;
    const b = p.box;
    if (x < b.x || x > b.x + b.w || y < b.y || y > b.y + b.h) continue;
    if (pointInPolygon(x, y, p.points)) return p.surface;
  }
  return null;
}

/** How far a gate reaches past the road edge, so a car running a bit wide still counts. */
const GATE_SPILL = 30;
/** A gate stops this far short of any other stretch of road. */
const GATE_CLEARANCE = 12;

/**
 * Sample for gate `g`: spread evenly round the lap, but nudged to the
 * straightest spot nearby so no gate sits on a hairpin apex. Gate 0 (the
 * finish line) stays at sample 0.
 */
function gateSample(g: number, count: number, curvature: number[]): number {
  const m = curvature.length;
  const ideal = Math.floor((g * m) / count);
  if (g === 0) return 0;
  const window = Math.floor(m / count / 3);
  let best = ideal;
  let bestScore = Infinity;
  for (let k = -window; k <= window; k++) {
    const i = (ideal + k + m) % m;
    // Mostly how bent the road is; a little for drifting off the even spacing.
    const score = curvature[i] + Math.abs(k) * 0.00002;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/**
 * Half-length of a gate on one side (`side` = -1 or 1 along the normal):
 * past the road edge by GATE_SPILL, but cut short before it reaches another
 * part of the road (the other side of a hairpin, a parallel straight).
 */
function gateReach(def: TrackDef, samples: Vec2[], seg: number[], idx: number, side: number): number {
  const m = samples.length;
  const c = samples[idx];
  const n = samples[(idx + 1) % m];
  const p = samples[(idx - 1 + m) % m];
  const dx = n.x - p.x;
  const dy = n.y - p.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * side;
  const ny = (dx / len) * side;
  // Samples close along the road belong to this stretch; the rest are "other road".
  const near = new Uint8Array(m);
  const span = def.halfWidth * 4;
  for (const dir of [1, -1]) {
    let d = 0;
    for (let k = 0; k < m && d <= span; k++) {
      const i = (idx + dir * k + m * 2) % m;
      near[i] = 1;
      d += seg[dir > 0 ? i : (i - 1 + m) % m];
    }
  }
  const min = def.halfWidth + 4;
  for (let r = def.halfWidth + GATE_SPILL; r > min; r -= 2) {
    const x = c.x + nx * r;
    const y = c.y + ny * r;
    let clear = true;
    for (let i = 0; i < m && clear; i++) {
      if (near[i] || near[(i + 1) % m]) continue;
      if (distToSegmentSq(x, y, samples[i], samples[(i + 1) % m]) < (def.halfWidth + GATE_CLEARANCE) ** 2) clear = false;
    }
    if (clear) return r;
  }
  return min;
}

function buildRiverLine(r: River): RiverLine {
  const cp = r.points;
  const n = cp.length;
  const points: Vec2[] = [];
  for (let i = 0; i < n - 1; i++) {
    const p0 = cp[Math.max(0, i - 1)];
    const p3 = cp[Math.min(n - 1, i + 2)];
    for (let s = 0; s < 16; s++) points.push(catmullRom(p0, cp[i], cp[i + 1], p3, s / 16));
  }
  points.push(cp[n - 1]);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const pad = r.halfWidth;
  return { points, halfWidth: r.halfWidth, box: { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 } };
}

/** Distance from (x, y) to the nearest river bank; negative in the water. */
function riverEdge(rivers: RiverLine[], x: number, y: number, reach = Infinity): number {
  let best = Infinity;
  for (const r of rivers) {
    const b = r.box;
    if (x < b.x - reach || x > b.x + b.w + reach || y < b.y - reach || y > b.y + b.h + reach) continue;
    let d2 = Infinity;
    for (let i = 0; i < r.points.length - 1; i++) {
      const d = distToSegmentSq(x, y, r.points[i], r.points[i + 1]);
      if (d < d2) d2 = d;
    }
    best = Math.min(best, Math.sqrt(d2) - r.halfWidth);
  }
  return best;
}

function landHeight(def: TrackDef, rivers: RiverLine[], x: number, y: number, edge = riverEdge(rivers, x, y)): number {
  const t = def.terrain!;
  let hills = 0;
  for (const k of t.hills) {
    const dx = x - k.x;
    const dy = y - k.y;
    hills += k.h * Math.exp(-(dx * dx + dy * dy) / (k.r * k.r));
  }
  // Hills settle back to base at the map edge, where the boundary wall stands.
  let f = Math.min(1, Math.max(0, Math.min(x, y, def.width - x, def.height - y) / EDGE_FADE));
  f = f * f * (3 - 2 * f);
  const h = t.base + hills * f;
  let s = Math.min(1, Math.max(0, edge / RIVER_VALLEY));
  s = s * s * (3 - 2 * s);
  return BANK_HEIGHT + (h - BANK_HEIGHT) * s;
}

/** Gaussian average along the closed centerline, by arc length rather than sample count. */
function smoothAlongArc(samples: Vec2[], values: number[], sigma: number): void {
  const n = samples.length;
  const step: number[] = samples.map((p, i) => {
    const q = samples[(i + 1) % n];
    return Math.hypot(q.x - p.x, q.y - p.y);
  });
  const src = values.slice();
  const reach = sigma * 3;
  for (let i = 0; i < n; i++) {
    let sum = src[i];
    let wsum = 1;
    for (const dir of [1, -1]) {
      let d = 0;
      for (let k = 1; k < n; k++) {
        const j = (i + dir * k + n * 2) % n;
        d += dir > 0 ? step[(j - 1 + n) % n] : step[j];
        if (d > reach) break;
        const w = Math.exp(-(d * d) / (2 * sigma * sigma));
        sum += src[j] * w;
        wsum += w;
      }
    }
    values[i] = sum / wsum;
  }
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

/** Holds the road at deck height on the bridge and eases it in over `BRIDGE_RAMP`. */
function easeOntoBridge(samples: Vec2[], heights: number[], b: Bridge): void {
  const n = samples.length;
  const dist = samples.map((p) => (pointInRect(p.x, p.y, b) ? 0 : Infinity));
  // Arc distance to the deck, both ways round the closed loop.
  for (let pass = 0; pass < 2; pass++) {
    for (let k = 0; k < n * 2; k++) {
      const i = pass === 0 ? k % n : (n * 2 - 1 - k) % n;
      const j = pass === 0 ? (i - 1 + n) % n : (i + 1) % n;
      const a = samples[i];
      const c = samples[j];
      const d = dist[j] + Math.hypot(a.x - c.x, a.y - c.y);
      if (d < dist[i]) dist[i] = d;
    }
  }
  for (let i = 0; i < n; i++) {
    const t = Math.min(1, dist[i] / BRIDGE_RAMP);
    const w = 1 - t * t * (3 - 2 * t);
    heights[i] += (b.height - heights[i]) * w;
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

function buildHeightGrid(def: TrackDef, samples: Vec2[], heights: number[], rivers: RiverLine[]): HeightGrid {
  const step = HEIGHT_GRID_STEP;
  const cols = Math.floor(def.width / step) + 1;
  const rows = Math.floor(def.height / step) + 1;
  const data = new Float32Array(cols * rows);
  const inner = def.halfWidth + 6;
  const outer = def.halfWidth + 140;
  const span = outer - inner;
  // Rough land shape, plus cells that must keep their height: the road
  // (off the bridge) and the lake bed.
  const target = new Float32Array(cols * rows);
  const pinned = new Uint8Array(cols * rows);
  const water = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    const y = r * step;
    for (let c = 0; c < cols; c++) {
      const x = c * step;
      const i = r * cols + c;
      const hit = projectCenterline(samples, heights, x, y);
      let t = (hit.dist - inner) / span;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const s = t * t * (3 - 2 * t);
      const edge = riverEdge(rivers, x, y);
      target[i] = hit.height * (1 - s) + landHeight(def, rivers, x, y, edge) * s;
      const wet = edge <= 0;
      // Road over water is a bridge deck; on land it is solid (the abutments).
      if (hit.dist <= def.halfWidth + 4 && !(wet && inAnyRect(x, y, def.bridges))) {
        target[i] = hit.height;
        pinned[i] = 1;
      } else if (wet) {
        water[i] = 1;
      }
    }
  }
  const shore = distanceToLand(water, cols, rows, step);
  for (let i = 0; i < data.length; i++) {
    if (!water[i]) continue;
    const t = Math.min(1, shore[i] / SHORE_SLOPE);
    target[i] = WATER_BED * t * (2 - t);
    pinned[i] = 1;
  }
  // Coarse to fine: each level starts from the one below, so hills settle fast.
  let coarse: { h: Float32Array; cols: number; rows: number; f: number } | null = null;
  for (const f of [4, 2, 1]) {
    const lc = Math.floor((cols - 1) / f) + 1;
    const lr = Math.floor((rows - 1) / f) + 1;
    const h = new Float32Array(lc * lr);
    const lt = new Float32Array(lc * lr);
    const lp = new Uint8Array(lc * lr);
    for (let r = 0; r < lr; r++) {
      for (let c = 0; c < lc; c++) {
        const fi = r * f * cols + c * f;
        lt[r * lc + c] = target[fi];
        lp[r * lc + c] = pinned[fi];
        h[r * lc + c] = coarse ? upsample(coarse, (c * f) / coarse.f, (r * f) / coarse.f) : target[fi];
      }
    }
    const k = (step * f) / TERRAIN_SMOOTH_LENGTH;
    relaxTerrain(h, lt, lp, lc, lr, k * k, f === 1 ? 80 : 400);
    coarse = { h, cols: lc, rows: lr, f };
  }
  data.set(coarse!.h);
  blurHeightGrid(data, cols, rows, 2);
  return { cols, rows, step, data };
}

/** Bilinear read of a coarser level at fractional cell (cx, cy). */
function upsample(lv: { h: Float32Array; cols: number; rows: number }, cx: number, cy: number): number {
  cx = Math.min(cx, lv.cols - 1);
  cy = Math.min(cy, lv.rows - 1);
  const c0 = Math.min(lv.cols - 2, Math.floor(cx));
  const r0 = Math.min(lv.rows - 2, Math.floor(cy));
  const tx = cx - c0;
  const ty = cy - r0;
  const a = lv.h[r0 * lv.cols + c0] * (1 - tx) + lv.h[r0 * lv.cols + c0 + 1] * tx;
  const b = lv.h[(r0 + 1) * lv.cols + c0] * (1 - tx) + lv.h[(r0 + 1) * lv.cols + c0 + 1] * tx;
  return a * (1 - ty) + b * ty;
}

/**
 * Smooths free cells toward their neighbours with a light pull to `target`
 * (Gauss-Seidel on a screened Laplace). Pinned cells hold still.
 */
function relaxTerrain(
  h: Float32Array,
  target: Float32Array,
  pinned: Uint8Array,
  cols: number,
  rows: number,
  pull: number,
  iterations: number,
): void {
  for (let it = 0; it < iterations; it++) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (pinned[i]) {
          h[i] = target[i];
          continue;
        }
        // Mirror at the map edge so the border stays flat, not dragged.
        const left = h[c > 0 ? i - 1 : i + 1];
        const right = h[c < cols - 1 ? i + 1 : i - 1];
        const up = h[r > 0 ? i - cols : i + cols];
        const down = h[r < rows - 1 ? i + cols : i - cols];
        h[i] = (left + right + up + down + pull * target[i]) / (4 + pull);
      }
    }
  }
}

/** World distance from each water cell to the nearest dry cell (chamfer). */
function distanceToLand(water: Uint8Array, cols: number, rows: number, step: number): Float32Array {
  const d = new Float32Array(water.length);
  for (let i = 0; i < d.length; i++) d[i] = water[i] ? Infinity : 0;
  const diag = step * Math.SQRT2;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (!water[i]) continue;
      let v = d[i];
      if (c > 0) v = Math.min(v, d[i - 1] + step);
      if (r > 0) v = Math.min(v, d[i - cols] + step);
      if (r > 0 && c > 0) v = Math.min(v, d[i - cols - 1] + diag);
      if (r > 0 && c < cols - 1) v = Math.min(v, d[i - cols + 1] + diag);
      d[i] = v;
    }
  }
  for (let r = rows - 1; r >= 0; r--) {
    for (let c = cols - 1; c >= 0; c--) {
      const i = r * cols + c;
      if (!water[i]) continue;
      let v = d[i];
      if (c < cols - 1) v = Math.min(v, d[i + 1] + step);
      if (r < rows - 1) v = Math.min(v, d[i + cols] + step);
      if (r < rows - 1 && c < cols - 1) v = Math.min(v, d[i + cols + 1] + diag);
      if (r < rows - 1 && c > 0) v = Math.min(v, d[i + cols - 1] + diag);
      d[i] = v;
    }
  }
  return d;
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
  return track.rivers.length > 0 && riverEdge(track.rivers, x, y, 0) <= 0;
}

/** Deck width past each road edge: curb stripe plus a footway under the rail. */
export const BRIDGE_DECK_MARGIN = 15;

export function bridgeAt(track: Track, x: number, y: number): Bridge | null {
  const bridges = track.def.bridges;
  if (!bridges) return null;
  for (const b of bridges) {
    if (pointInRect(x, y, b) && distanceToCenterline(track, x, y) <= track.def.halfWidth + BRIDGE_DECK_MARGIN) return b;
  }
  return null;
}

/** Centerline sample indices on a bridge, in driving order. */
export function bridgeSpan(track: Track, b: Bridge): number[] {
  const s = track.samples;
  const n = s.length;
  const inside = (i: number) => pointInRect(s[i].x, s[i].y, b);
  let start = 0;
  while (start < n && !(inside(start) && !inside((start - 1 + n) % n))) start++;
  const span: number[] = [];
  for (let k = 0; k < n && inside((start + k) % n); k++) span.push((start + k) % n);
  return span;
}

export function inBridge(track: Track, x: number, y: number): boolean {
  return bridgeAt(track, x, y) !== null;
}

export function onRacingSurface(track: Track, x: number, y: number): boolean {
  return inPitLane(track, x, y) || inBridge(track, x, y) || distanceToCenterline(track, x, y) <= track.def.halfWidth;
}

export function surfaceAt(track: Track, x: number, y: number): Surface {
  const over = patchAt(track, x, y, true);
  if (over) return over;
  if (onRacingSurface(track, x, y)) return 'asphalt';
  if (inWater(track, x, y)) return 'water';
  return patchAt(track, x, y, false) ?? track.def.ground ?? 'grass';
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

/** What wheels roll on: the deck on a bridge, the terrain elsewhere. */
function driveHeight(track: Track, x: number, y: number): number {
  const b = bridgeAt(track, x, y);
  return b ? b.height : fieldHeight(track, x, y);
}

/** Ground height under a point. Smooth along the road; water sits below the surface. */
export function heightAt(track: Track, x: number, y: number): number {
  if (surfaceAt(track, x, y) === 'water') return WATER_FLOAT;
  return driveHeight(track, x, y);
}

/** Visual terrain, banks and lake bed included. Under a bridge this is the ground below the deck. */
export function terrainHeightAt(track: Track, x: number, y: number): number {
  return fieldHeight(track, x, y);
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
  const hF = driveHeight(track, x + along * ca, y + along * sa);
  const hB = driveHeight(track, x - along * ca, y - along * sa);
  const hL = driveHeight(track, x - across * sa, y + across * ca);
  const hR = driveHeight(track, x + across * sa, y - across * ca);
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
    // Clockwise, but the south side folds up into the infield: a left-hand
    // hairpin between two right-handers.
    controlPoints: [
      { x: 400, y: 210 },
      { x: 620, y: 196 },
      { x: 840, y: 190 },
      { x: 1060, y: 205 },
      { x: 1260, y: 250 },
      { x: 1400, y: 330 },
      { x: 1470, y: 450 },
      { x: 1478, y: 580 },
      { x: 1435, y: 710 },
      { x: 1335, y: 810 },
      { x: 1190, y: 870 },
      { x: 1070, y: 840 },
      { x: 1000, y: 760 },
      { x: 975, y: 650 },
      { x: 920, y: 560 },
      { x: 830, y: 540 },
      { x: 750, y: 590 },
      { x: 720, y: 700 },
      { x: 690, y: 820 },
      { x: 600, y: 900 },
      { x: 450, y: 930 },
      { x: 300, y: 895 },
      { x: 190, y: 800 },
      { x: 150, y: 660 },
      { x: 160, y: 520 },
      { x: 200, y: 390 },
      { x: 270, y: 270 },
    ],
    // Enters from the east, winds through the infield, leaves to the west.
    rivers: [
      {
        halfWidth: 30,
        points: [
          { x: 1760, y: 560 },
          { x: 1600, y: 535 },
          { x: 1470, y: 515 },
          { x: 1320, y: 470 },
          { x: 1160, y: 405 },
          { x: 1000, y: 372 },
          { x: 850, y: 380 },
          { x: 700, y: 420 },
          { x: 560, y: 485 },
          { x: 420, y: 560 },
          { x: 290, y: 600 },
          { x: 150, y: 605 },
          { x: 0, y: 595 },
          { x: -160, y: 590 },
        ],
      },
    ],
    terrain: {
      base: 12,
      hills: [
        { x: 1215, y: 665, r: 135, h: 115 },
        { x: 470, y: 745, r: 160, h: 105 },
        { x: 860, y: 900, r: 125, h: 95 },
        { x: 1200, y: 320, r: 110, h: 40 },
        { x: 600, y: 330, r: 95, h: 32 },
        { x: 1600, y: 760, r: 170, h: 65 },
        { x: 1580, y: 40, r: 210, h: 90 },
        { x: 1600, y: 1050, r: 270, h: 130 },
        { x: 0, y: 1050, r: 250, h: 120 },
        { x: 0, y: 0, r: 210, h: 85 },
      ],
    },
    bridges: [
      { x: 1385, y: 438, w: 180, h: 160, height: 40 },
      { x: 64, y: 528, w: 176, h: 160, height: 28 },
    ],
    patches: [
      rectPatch('sand', { x: 1440, y: 190, w: 150, h: 150 }),
      rectPatch('sand', { x: 795, y: 610, w: 120, h: 90 }),
      rectPatch('sand', { x: 50, y: 760, w: 110, h: 190 }),
    ],
    obstacles: [
      { x: 1545, y: 300, r: 16, kind: 'tyres' },
      { x: 880, y: 440, r: 16, kind: 'tyres' },
      { x: 60, y: 820, r: 16, kind: 'tyres' },
      { x: 1230, y: 690, r: 17, kind: 'tree' },
      { x: 1290, y: 640, r: 15, kind: 'tree' },
      { x: 470, y: 745, r: 17, kind: 'tree' },
      { x: 410, y: 700, r: 15, kind: 'tree' },
      { x: 860, y: 930, r: 16, kind: 'tree' },
      { x: 1520, y: 980, r: 16, kind: 'tree' },
      { x: 90, y: 990, r: 18, kind: 'tree' },
      { x: 1540, y: 70, r: 16, kind: 'tree' },
      { x: 80, y: 90, r: 15, kind: 'tree' },
      { x: 1225, y: 345, r: 14, kind: 'tree' },
      { x: 430, y: 360, r: 15, kind: 'tree' },
    ],
    ...pitComplex(480),
  },
  alpine: {
    id: 'alpine',
    name: 'Alpine Pass',
    // The big map: a long right-hand sweep, an icy kink, then a left into a tight right.
    width: 2200,
    height: 1450,
    halfWidth: 54,
    checkpointCount: 8,
    controlPoints: [
      { x: 380, y: 210 },
      { x: 730, y: 200 },
      { x: 1090, y: 205 },
      { x: 1420, y: 232 },
      { x: 1720, y: 313 },
      { x: 1930, y: 461 },
      { x: 1990, y: 668 },
      { x: 1900, y: 845 },
      { x: 1690, y: 919 },
      { x: 1465, y: 874 },
      { x: 1270, y: 800 },
      { x: 1075, y: 815 },
      { x: 940, y: 933 },
      { x: 895, y: 1110 },
      { x: 730, y: 1214 },
      { x: 460, y: 1258 },
      { x: 270, y: 1199 },
      { x: 165, y: 1022 },
      { x: 150, y: 771 },
      { x: 190, y: 520 },
      { x: 270, y: 313 },
    ],
    ground: 'snow',
    terrain: {
      base: 10,
      hills: [
        { x: 1600, y: 535, r: 253, h: 70 },
        { x: 1525, y: 1170, r: 283, h: 100 },
        { x: 380, y: 815, r: 283, h: 90 },
        { x: 2200, y: 0, r: 298, h: 60 },
        { x: 0, y: 1450, r: 327, h: 80 },
        { x: 2200, y: 1450, r: 342, h: 90 },
        { x: 0, y: 0, r: 268, h: 50 },
      ],
    },
    patches: [
      // Frozen pond in the infield.
      {
        surface: 'ice',
        points: [
          { x: 730, y: 387 },
          { x: 1000, y: 343 },
          { x: 1240, y: 417 },
          { x: 1285, y: 550 },
          { x: 1150, y: 653 },
          { x: 880, y: 668 },
          { x: 715, y: 579 },
        ],
      },
      // Black ice across the road at the kink.
      {
        surface: 'ice',
        overRoad: true,
        points: [
          { x: 1464, y: 942 },
          { x: 1388, y: 916 },
          { x: 1323, y: 886 },
          { x: 1271, y: 867 },
          { x: 1217, y: 861 },
          { x: 1223, y: 729 },
          { x: 1301, y: 739 },
          { x: 1377, y: 766 },
          { x: 1440, y: 795 },
          { x: 1501, y: 816 },
        ],
      },
      // Gravel traps on the outside of the big corners.
      {
        surface: 'gravel',
        points: [
          { x: 1932, y: 372 },
          { x: 1993, y: 443 },
          { x: 2032, y: 525 },
          { x: 2051, y: 610 },
          { x: 2049, y: 693 },
          { x: 2026, y: 774 },
          { x: 1984, y: 846 },
          { x: 1922, y: 906 },
          { x: 1964, y: 965 },
          { x: 2041, y: 890 },
          { x: 2092, y: 802 },
          { x: 2121, y: 704 },
          { x: 2122, y: 603 },
          { x: 2100, y: 502 },
          { x: 2053, y: 403 },
          { x: 1980, y: 319 },
        ],
      },
      {
        surface: 'gravel',
        points: [
          { x: 984, y: 999 },
          { x: 979, y: 1046 },
          { x: 967, y: 1104 },
          { x: 933, y: 1162 },
          { x: 891, y: 1201 },
          { x: 842, y: 1233 },
          { x: 788, y: 1258 },
          { x: 812, y: 1316 },
          { x: 872, y: 1287 },
          { x: 929, y: 1250 },
          { x: 979, y: 1203 },
          { x: 1025, y: 1125 },
          { x: 1041, y: 1053 },
          { x: 1046, y: 1007 },
        ],
      },
      {
        surface: 'gravel',
        points: [
          { x: 282, y: 1280 },
          { x: 223, y: 1241 },
          { x: 175, y: 1188 },
          { x: 138, y: 1126 },
          { x: 111, y: 1059 },
          { x: 94, y: 984 },
          { x: 86, y: 904 },
          { x: 5, y: 907 },
          { x: 5, y: 998 },
          { x: 24, y: 1087 },
          { x: 56, y: 1167 },
          { x: 101, y: 1242 },
          { x: 163, y: 1310 },
          { x: 240, y: 1362 },
        ],
      },
    ],
    barriers: [
      { a: { x: 1984, y: 314 }, b: { x: 2086, y: 449 } },
      { a: { x: 2086, y: 449 }, b: { x: 2128, y: 602 } },
      { a: { x: 2128, y: 602 }, b: { x: 2115, y: 756 } },
      { a: { x: 2115, y: 756 }, b: { x: 2046, y: 894 } },
      { a: { x: 2046, y: 894 }, b: { x: 1921, y: 998 } },
      { a: { x: 1052, y: 1007 }, b: { x: 1039, y: 1099 } },
      { a: { x: 1039, y: 1099 }, b: { x: 968, y: 1224 } },
      { a: { x: 968, y: 1224 }, b: { x: 875, y: 1292 } },
      { a: { x: 875, y: 1292 }, b: { x: 772, y: 1337 } },
    ],
    obstacles: [
      // Apex cones: clip them and they go flying.
      { x: 1063, y: 880, r: 6, kind: 'cone' },
      { x: 1006, y: 930, r: 6, kind: 'cone' },
      { x: 976, y: 985, r: 6, kind: 'cone' },
      { x: 862, y: 1058, r: 6, kind: 'cone' },
      { x: 850, y: 1083, r: 6, kind: 'cone' },
      { x: 821, y: 1111, r: 6, kind: 'cone' },
      { x: 1600, y: 520, r: 16, kind: 'tree' },
      { x: 1690, y: 594, r: 14, kind: 'tree' },
      { x: 475, y: 786, r: 17, kind: 'tree' },
      { x: 400, y: 904, r: 15, kind: 'tree' },
      { x: 580, y: 727, r: 14, kind: 'tree' },
      { x: 1525, y: 1273, r: 18, kind: 'tree' },
      { x: 1675, y: 1170, r: 15, kind: 'tree' },
      { x: 1360, y: 1317, r: 16, kind: 'tree' },
      { x: 2110, y: 90, r: 16, kind: 'tree' },
      { x: 80, y: 90, r: 15, kind: 'tree' },
      { x: 2080, y: 1317, r: 17, kind: 'tree' },
      { x: 1435, y: 387, r: 15, kind: 'tree' },
      { x: 1900, y: 300, r: 16, kind: 'tree' },
      { x: 1700, y: 1250, r: 16, kind: 'tree' },
      { x: 1250, y: 1300, r: 16, kind: 'tree' },
      { x: 2050, y: 900, r: 16, kind: 'tree' },
      { x: 900, y: 450, r: 16, kind: 'tree' },
    ],
    ...pitComplex(480),
  },
};

const cache = new Map<string, Track>();
/** Tracks added at runtime (editor, online rooms), by id. */
const custom = new Map<string, TrackDef>();

/** Add or replace a track definition. A replaced track is rebuilt on next use. */
export function registerTrack(def: TrackDef): void {
  custom.set(def.id, def);
  cache.delete(def.id);
}

export function hasTrack(id: string | undefined): boolean {
  return !!id && (id in TRACKS || custom.has(id));
}

export function trackDef(id: string): TrackDef | undefined {
  return TRACKS[id] ?? custom.get(id);
}

/** Display name for any known track id. */
export function trackName(id: string): string {
  return trackDef(id)?.name ?? id;
}

export function getTrack(id: string): Track {
  let t = cache.get(id);
  if (!t) {
    const def = trackDef(id);
    if (!def) throw new Error(`Unknown track: ${id}`);
    t = buildTrack(def);
    cache.set(id, t);
  }
  return t;
}
