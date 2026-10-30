import { datan2, normalizeAngle } from './dmath';
import type { MapDesign } from './maps/design';
import { ALPINE } from './maps/alpine';
import { GRAND_PRIX } from './maps/grandPrix';
import { HARBOR } from './maps/harbor';
import { HARVEST_RALLY } from './maps/harvestRally';
import { JUNGLE } from './maps/jungle';
import { MEADOW } from './maps/meadow';
import { OLD_TOWN } from './maps/oldTown';
import { RED_CANYON } from './maps/redCanyon';

export type Vec2 = { x: number; y: number };

export type Surface = 'asphalt' | 'grass' | 'sand' | 'water' | 'gravel' | 'snow' | 'ice' | 'dirt' | 'mud';

/** Surfaces a patch can paint. Asphalt paints paved run-off; mud ploughed fields and puddles. */
export const PATCH_SURFACES = ['grass', 'sand', 'gravel', 'snow', 'ice', 'asphalt', 'dirt', 'mud'] as const;

/** What the road itself is made of. */
export type RoadSurface = 'asphalt' | 'dirt';
export const ROAD_SURFACES: readonly RoadSurface[] = ['asphalt', 'dirt'];

/**
 * Look and feel of a map: ground colours, tree types, sky, barrier style.
 * Purely visual; the surfaces decide how cars drive.
 */
export type Theme = 'meadow' | 'winter' | 'jungle' | 'desert' | 'city' | 'farm' | 'circuit';
export const THEMES: readonly Theme[] = ['meadow', 'winter', 'jungle', 'desert', 'city', 'farm', 'circuit'];

/** Scenery that is only drawn: cars never touch it, so keep it out of reach (behind barriers or off the road). */
export type DecorKind = 'grandstand' | 'building' | 'house' | 'barn' | 'hut' | 'ruin' | 'billboard' | 'mesa' | 'tent';
export const DECOR_KINDS: readonly DecorKind[] = ['grandstand', 'building', 'house', 'barn', 'hut', 'ruin', 'billboard', 'mesa', 'tent'];

export interface Decor {
  kind: DecorKind;
  x: number;
  y: number;
  /** Footprint along its own axes, in world units. */
  w: number;
  d: number;
  /** Turn about the vertical axis, radians. 0 means the long side runs along x. */
  angle?: number;
  /** Height for buildings and mesas. Each kind has a default. */
  h?: number;
}

export const TRACK_IDS = ['oldtown', 'canyon', 'meadow', 'harbor', 'jungle', 'harvest', 'alpine', 'grandprix'] as const;
export type TrackId = (typeof TRACK_IDS)[number];

/** Marked stalls on tracks that have a pit lane. */
export const PIT_STALLS = 4;
const PIT_BOX_W = 90;
const PIT_BOX_H = 54;
const PIT_BOX_GAP = 12;
const PIT_LANE_PAD = 20;

/** The shared start and pits of custom tracks: an east-going straight at the top. */
export const DEFAULT_START: Vec2 = { x: 400, y: 210 };

export type Heading = 'east' | 'west' | 'north' | 'south';
const HEADING_VEC: Record<Heading, Vec2> = { east: { x: 1, y: 0 }, west: { x: -1, y: 0 }, north: { x: 0, y: -1 }, south: { x: 0, y: 1 } };

/** Where the stalls start after the line, how far they sit from the road centre, and the lane around them. */
const PIT_FIRST_ALONG = 80;
const PIT_BOX_NEAR = 124;
const PIT_LANE_NEAR = 18;
const PIT_LANE_FAR = 198;

/**
 * Pit lane and four stalls beside the start straight. `heading` is the way
 * cars drive over the line (an axis, so stalls stay plain rectangles) and
 * `side` which side of the road the pits are on.
 */
export function pitComplexAt(start: Vec2, heading: Heading, side: 'left' | 'right'): { pitLane: Rect; pitBoxes: Rect[] } {
  const u = HEADING_VEC[heading];
  // Left of travel with y pointing down the screen.
  const l = side === 'left' ? { x: u.y, y: -u.x } : { x: -u.y, y: u.x };
  const rect = (a0: number, a1: number, d0: number, d1: number): Rect => {
    const xs = [start.x + u.x * a0 + l.x * d0, start.x + u.x * a1 + l.x * d1];
    const ys = [start.y + u.y * a0 + l.y * d0, start.y + u.y * a1 + l.y * d1];
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  };
  const pitBoxes: Rect[] = [];
  for (let i = 0; i < PIT_STALLS; i++) {
    const a = PIT_FIRST_ALONG + i * (PIT_BOX_W + PIT_BOX_GAP);
    pitBoxes.push(rect(a, a + PIT_BOX_W, PIT_BOX_NEAR, PIT_BOX_NEAR + PIT_BOX_H));
  }
  const end = PIT_FIRST_ALONG + PIT_STALLS * (PIT_BOX_W + PIT_BOX_GAP) - PIT_BOX_GAP;
  return { pitLane: rect(PIT_FIRST_ALONG - PIT_LANE_PAD, end + PIT_LANE_PAD, PIT_LANE_NEAR, PIT_LANE_FAR), pitBoxes };
}

/** The classic layout: stalls along the top, first one at `firstBoxX`. */
export function pitComplex(firstBoxX: number): { pitLane: Rect; pitBoxes: Rect[] } {
  return pitComplexAt({ x: firstBoxX - PIT_FIRST_ALONG, y: DEFAULT_START.y }, 'east', 'left');
}

/** The axis heading from the first control point toward the second. */
export function startHeading(points: Vec2[]): Heading {
  const dx = points[1].x - points[0].x;
  const dy = points[1].y - points[0].y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'east' : 'west';
  return dy >= 0 ? 'south' : 'north';
}

/** Unit direction of travel over the start line, snapped to the nearest axis. */
export function startAxis(track: Track): Vec2 {
  const a = track.tangentAngles[0];
  const c = Math.cos(a);
  const s = Math.sin(a);
  return Math.abs(c) >= Math.abs(s) ? { x: Math.sign(c), y: 0 } : { x: 0, y: Math.sign(s) };
}

export const TRACK_NAMES: Record<TrackId, string> = {
  meadow: 'Meadow Ring',
  harbor: 'Harbor Bridge',
  alpine: 'Alpine Pass',
  oldtown: 'Old Town',
  canyon: 'Red Canyon',
  jungle: 'Jungle Temple',
  harvest: 'Harvest Rally',
  grandprix: 'Grand Prix',
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
  /**
   * Set for a flyover: the heading (radians) of the stretch of road that runs
   * over the deck. Another stretch of the same road passes underneath.
   */
  over?: number;
}

export interface Obstacle {
  x: number;
  y: number;
  r: number;
  /**
   * Trees, tyre stacks, rocks and hay bales are fixed; cones get knocked about
   * (see `GameState.props`). `solid` is never drawn: it makes a building or ruin
   * from `decor` something cars hit.
   */
  kind: 'tyres' | 'tree' | 'cone' | 'rock' | 'hay' | 'solid';
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
  /** The road: asphalt (default) or a dirt rally stage. */
  road?: RoadSurface;
  /** Visual theme. Default follows the ground: snow is winter, anything else meadow. */
  theme?: Theme;
  /** Buildings, grandstands and other drawn-only scenery. */
  decor?: Decor[];
  /** Which side of the start straight the pits are on. Default left. */
  pitSide?: 'left' | 'right';
}

/** The theme a map is drawn with. */
export function themeOf(def: Pick<TrackDef, 'theme' | 'ground'>): Theme {
  return def.theme ?? (def.ground === 'snow' ? 'winter' : 'meadow');
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
  /** Road-over-road bridges and the stretches that climb onto them. */
  flyovers: Flyover[];
}

/** A flyover as built: which samples are on the deck and which climb to it. */
export interface Flyover {
  bridge: Bridge;
  /** Samples on the deck, in driving order. */
  deck: number[];
  /** Raised samples (deck and ramps): `true` where the road is lifted. */
  raised: Uint8Array;
  /** Ramp samples well clear of the deck: driving here means you are going over. */
  climb: number[];
  /** Railing lines along both deck edges. */
  rails: { a: Vec2; b: Vec2 }[];
}

const SAMPLES_PER_SEGMENT = 24;
const HEIGHT_GRID_STEP = 4;
const HEIGHT_SMOOTH_PASSES = 8;
/** Arc length over which the road eases onto a flat bridge deck. */
const BRIDGE_RAMP = 220;
/** A flyover climbs over this distance, so the slope stays gentle. */
const FLYOVER_RAMP = 300;
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
  // Road lookups everywhere on the map go through this grid.
  segmentGrid(samples, { x: 0, y: 0, w: def.width, h: def.height });
  const rivers = (def.rivers ?? []).map(buildRiverLine);
  const sampleHeights = samples.map((p) => (def.terrain ? landHeight(def, rivers, p.x, p.y) : 0));
  if (def.terrain) {
    smoothAlongArc(samples, sampleHeights, ROAD_GRADE_SMOOTH);
    smoothClosed(sampleHeights, HEIGHT_SMOOTH_PASSES);
    for (const b of def.bridges ?? []) easeOntoBridge(samples, sampleHeights, b, flyoverDeck(samples, b));
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
    const idx = gateSample(g, def.checkpointCount, curvature, (i) => nearPits(def, samples[i]));
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
  const flyovers = (def.bridges ?? []).filter((b) => b.over !== undefined).map((b) => buildFlyover(def, samples, normals, b));
  const heightGrid = def.terrain && opts.grid !== false ? buildHeightGrid(def, samples, sampleHeights, rivers, flyovers) : null;
  const patches = (def.patches ?? []).map(patchShape);
  return { def, samples, tangentAngles, normals, segmentLengths, curvature, sampleHeights, heightGrid, rivers, patches, gates, flyovers };
}

/** Samples on a flyover deck: inside its rect and heading its way. All of them for a water bridge. */
function flyoverDeck(samples: Vec2[], b: Bridge): boolean[] {
  const n = samples.length;
  return samples.map((p, i) => {
    if (!pointInRect(p.x, p.y, b)) return false;
    if (b.over === undefined) return true;
    const q = samples[(i + 1) % n];
    const r = samples[(i - 1 + n) % n];
    const a = Math.atan2(q.y - r.y, q.x - r.x);
    return Math.abs(Math.cos(a - b.over)) > 0.6;
  });
}

/** Arc distance from each sample to the nearest marked one, both ways round the loop. */
function arcDistance(samples: Vec2[], marked: boolean[]): number[] {
  const n = samples.length;
  const dist = marked.map((m) => (m ? 0 : Infinity));
  for (let pass = 0; pass < 2; pass++) {
    for (let k = 0; k < n * 2; k++) {
      const i = pass === 0 ? k % n : (n * 2 - 1 - k) % n;
      const j = pass === 0 ? (i - 1 + n) % n : (i + 1) % n;
      const d = dist[j] + Math.hypot(samples[i].x - samples[j].x, samples[i].y - samples[j].y);
      if (d < dist[i]) dist[i] = d;
    }
  }
  return dist;
}

function buildFlyover(def: TrackDef, samples: Vec2[], normals: Vec2[], b: Bridge): Flyover {
  const n = samples.length;
  const onDeck = flyoverDeck(samples, b);
  const dist = arcDistance(samples, onDeck);
  const deck: number[] = [];
  // Deck samples in driving order, starting where the road comes onto it.
  let start = 0;
  while (start < n && !(onDeck[start] && !onDeck[(start - 1 + n) % n])) start++;
  for (let k = 0; k < n && onDeck[(start + k) % n]; k++) deck.push((start + k) % n);
  const raised = new Uint8Array(n);
  const climb: number[] = [];
  for (let i = 0; i < n; i++) {
    if (dist[i] <= FLYOVER_RAMP) raised[i] = 1;
    if (dist[i] > def.halfWidth + 20 && dist[i] <= FLYOVER_RAMP && !pointInRect(samples[i].x, samples[i].y, b)) climb.push(i);
  }
  const rails: { a: Vec2; b: Vec2 }[] = [];
  const off = def.halfWidth + BRIDGE_DECK_MARGIN - 2;
  for (const side of [-1, 1]) {
    for (let k = 0; k + 1 < deck.length; k += 2) {
      const i = deck[k];
      const j = deck[Math.min(deck.length - 1, k + 2)];
      rails.push({
        a: { x: samples[i].x + normals[i].x * off * side, y: samples[i].y + normals[i].y * off * side },
        b: { x: samples[j].x + normals[j].x * off * side, y: samples[j].y + normals[j].y * off * side },
      });
    }
  }
  return { bridge: b, deck, raised, climb, rails };
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

/** True when a gate on this centerline point would reach into the pit lane. */
function nearPits(def: TrackDef, p: Vec2): boolean {
  const l = def.pitLane;
  const dx = Math.max(l.x - p.x, 0, p.x - (l.x + l.w));
  const dy = Math.max(l.y - p.y, 0, p.y - (l.y + l.h));
  return Math.hypot(dx, dy) < def.halfWidth + GATE_SPILL + 40;
}

/**
 * Sample for gate `g`: spread evenly round the lap, but nudged to the
 * straightest spot nearby so no gate sits on a hairpin apex, and kept clear
 * of the pit lane so cars driving through the pits can't slip past it.
 * Gate 0 (the finish line) stays at sample 0.
 */
function gateSample(g: number, count: number, curvature: number[], blocked: (i: number) => boolean): number {
  const m = curvature.length;
  let ideal = Math.floor((g * m) / count);
  if (g === 0) return 0;
  // Pits in the way: start the search just past them.
  while (blocked(ideal) && ideal < Math.floor(((g + 1) * m) / count)) ideal++;
  const window = Math.floor(m / count / 3);
  let best = ideal;
  let bestScore = Infinity;
  for (let k = -window; k <= window; k++) {
    const i = (ideal + k + m) % m;
    if (blocked(i)) continue;
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

/** Holds the road at deck height on the bridge and eases it in over the ramp length. */
function easeOntoBridge(samples: Vec2[], heights: number[], b: Bridge, deck: boolean[]): void {
  const n = samples.length;
  const dist = arcDistance(samples, deck);
  const ramp = b.over === undefined ? BRIDGE_RAMP : FLYOVER_RAMP;
  for (let i = 0; i < n; i++) {
    const t = Math.min(1, dist[i] / ramp);
    const w = 1 - t * t * (3 - 2 * t);
    heights[i] += (b.height - heights[i]) * w;
  }
}

/** Cell size of the centerline lookup grid. */
const SEG_CELL = 64;

/** Centerline segments bucketed by the grid cells their bounding boxes touch, lowest index first. */
interface SegmentGrid {
  x0: number;
  y0: number;
  cols: number;
  rows: number;
  cells: number[][];
}

const segmentGrids = new WeakMap<Vec2[], SegmentGrid>();

/** The lookup grid for a closed centerline, covering it and `bounds` (where it will be asked about). */
function segmentGrid(samples: Vec2[], bounds?: Rect): SegmentGrid {
  const known = segmentGrids.get(samples);
  if (known) return known;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of samples) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  if (bounds) {
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.w);
    maxY = Math.max(maxY, bounds.y + bounds.h);
  }
  const x0 = minX - SEG_CELL;
  const y0 = minY - SEG_CELL;
  const cols = Math.floor((maxX + SEG_CELL - x0) / SEG_CELL) + 1;
  const rows = Math.floor((maxY + SEG_CELL - y0) / SEG_CELL) + 1;
  const cells: number[][] = Array.from({ length: cols * rows }, () => []);
  const n = samples.length;
  for (let i = 0; i < n; i++) {
    const a = samples[i];
    const b = samples[(i + 1) % n];
    const c0 = Math.floor((Math.min(a.x, b.x) - x0) / SEG_CELL);
    const c1 = Math.floor((Math.max(a.x, b.x) - x0) / SEG_CELL);
    const r0 = Math.floor((Math.min(a.y, b.y) - y0) / SEG_CELL);
    const r1 = Math.floor((Math.max(a.y, b.y) - y0) / SEG_CELL);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) cells[r * cols + c].push(i);
  }
  const grid = { x0, y0, cols, rows, cells };
  segmentGrids.set(samples, grid);
  return grid;
}

/**
 * The segment index with the smallest `cost` (a squared distance from x, y to
 * something on that segment), the lowest index on a tie: exactly what a loop
 * over every segment gives, but looking only at nearby grid cells.
 */
function nearestOnGrid(samples: Vec2[], x: number, y: number, cost: (i: number) => number): { d: number; i: number } {
  const g = segmentGrid(samples);
  const cx = Math.floor((x - g.x0) / SEG_CELL);
  const cy = Math.floor((y - g.y0) / SEG_CELL);
  let best = Infinity;
  let bi = -1;
  if (cx < 0 || cy < 0 || cx >= g.cols || cy >= g.rows) {
    // Off the grid: look at everything.
    for (let i = 0; i < samples.length; i++) {
      const d = cost(i);
      if (d < best) {
        best = d;
        bi = i;
      }
    }
    return { d: best, i: bi };
  }
  const visit = (c: number, r: number) => {
    if (c < 0 || r < 0 || c >= g.cols || r >= g.rows) return;
    for (const i of g.cells[r * g.cols + c]) {
      const d = cost(i);
      if (d < best || (d === best && i < bi)) {
        best = d;
        bi = i;
      }
    }
  };
  const most = Math.max(g.cols, g.rows);
  for (let ring = 0; ring <= most; ring++) {
    if (ring === 0) visit(cx, cy);
    else {
      for (let k = -ring; k <= ring; k++) {
        visit(cx + k, cy - ring);
        visit(cx + k, cy + ring);
      }
      for (let k = -ring + 1; k <= ring - 1; k++) {
        visit(cx - ring, cy + k);
        visit(cx + ring, cy + k);
      }
    }
    // Anything not looked at yet is at least ring cells away.
    const reach = ring * SEG_CELL;
    if (best < reach * reach) break;
  }
  return { d: best, i: bi };
}

function projectCenterline(
  samples: Vec2[],
  heights: number[],
  x: number,
  y: number,
  skip?: Uint8Array,
): { dist: number; height: number; seg: number } {
  const n = samples.length;
  const along = (i: number) => {
    const a = samples[i];
    const b = samples[(i + 1) % n];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const len2 = abx * abx + aby * aby;
    const t = len2 > 0 ? ((x - a.x) * abx + (y - a.y) * aby) / len2 : 0;
    return t < 0 ? 0 : t > 1 ? 1 : t;
  };
  const hit = nearestOnGrid(samples, x, y, (i) => {
    if (skip && (skip[i] || skip[(i + 1) % n])) return Infinity;
    const a = samples[i];
    const b = samples[(i + 1) % n];
    const t = along(i);
    const dx = a.x + (b.x - a.x) * t - x;
    const dy = a.y + (b.y - a.y) * t - y;
    return dx * dx + dy * dy;
  });
  const best = hit.d;
  const seg = Math.max(0, hit.i);
  const h0 = heights[(seg - 1 + n) % n];
  const h1 = heights[seg];
  const h2 = heights[(seg + 1) % n];
  const h3 = heights[(seg + 2) % n];
  const height = catmullRom1(h0, h1, h2, h3, hit.i < 0 ? 0 : along(seg));
  return { dist: Math.sqrt(best), height, seg };
}

function buildHeightGrid(def: TrackDef, samples: Vec2[], heights: number[], rivers: RiverLine[], flyovers: Flyover[] = []): HeightGrid {
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
      // Under a flyover the ground follows the road below, not the deck.
      const fly = flyovers.find((f) => pointInRect(x, y, f.bridge));
      const hit = projectCenterline(samples, heights, x, y, fly?.raised);
      let t = (hit.dist - inner) / span;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const s = t * t * (3 - 2 * t);
      const edge = riverEdge(rivers, x, y);
      target[i] = hit.height * (1 - s) + landHeight(def, rivers, x, y, edge) * s;
      const wet = edge <= 0;
      // Road over water is a bridge deck; on land it is solid (the abutments).
      // Flyover ramps get a wide flat top so their walls stand at road height.
      const ramp = !fly && flyovers.some((f) => f.raised[hit.seg]);
      if (hit.dist <= def.halfWidth + (ramp ? 34 : 4) && !(wet && inAnyRect(x, y, def.bridges))) {
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

function gridAt(grid: HeightGrid, c: number, r: number): number {
  const cc = c < 0 ? 0 : c >= grid.cols ? grid.cols - 1 : c;
  const rr = r < 0 ? 0 : r >= grid.rows ? grid.rows - 1 : r;
  return grid.data[rr * grid.cols + cc];
}

/** One grid row (r) blended across at fraction tx past column c. */
function gridRow(grid: HeightGrid, c: number, r: number, tx: number): number {
  return catmullRom1(gridAt(grid, c - 1, r), gridAt(grid, c, r), gridAt(grid, c + 1, r), gridAt(grid, c + 2, r), tx);
}

function sampleHeightGrid(grid: HeightGrid, x: number, y: number): number {
  const fx = x / grid.step;
  const fy = y / grid.step;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fx - ix;
  const ty = fy - iy;
  return catmullRom1(gridRow(grid, ix, iy - 1, tx), gridRow(grid, ix, iy, tx), gridRow(grid, ix, iy + 1, tx), gridRow(grid, ix, iy + 2, tx), ty);
}

const groundCache = new WeakMap<Track, { obstacles: number[]; barriers: number[] }>();

/** Ground height under each obstacle and at each barrier's midpoint: fixed, so worked out once per track. */
export function obstacleGround(track: Track): { obstacles: number[]; barriers: number[] } {
  let g = groundCache.get(track);
  if (!g) {
    g = {
      obstacles: track.def.obstacles.map((o) => terrainHeightAt(track, o.x, o.y)),
      barriers: (track.def.barriers ?? []).map((b) => terrainHeightAt(track, (b.a.x + b.b.x) / 2, (b.a.y + b.b.y) / 2)),
    };
    groundCache.set(track, g);
  }
  return g;
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
  return Math.sqrt(nearestOnGrid(s, x, y, (i) => distToSegmentSq(x, y, s[i], s[(i + 1) % s.length])).d);
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

/** A water bridge's deck under this point, if any (flyovers need the car's level: see `carHeightAt`). */
export function bridgeAt(track: Track, x: number, y: number): Bridge | null {
  const bridges = track.def.bridges;
  if (!bridges) return null;
  for (const b of bridges) {
    if (b.over !== undefined) continue;
    if (pointInRect(x, y, b) && distanceToCenterline(track, x, y) <= track.def.halfWidth + BRIDGE_DECK_MARGIN) return b;
  }
  return null;
}

/** The flyover whose deck covers this point, if any. */
export function flyoverAt(track: Track, x: number, y: number): Flyover | null {
  for (const f of track.flyovers) if (pointInRect(x, y, f.bridge)) return f;
  return null;
}

/**
 * Keep a car's level up to date: on a flyover's ramp it is going over; well
 * away from the ramps it is on the ground; on and near the deck it keeps
 * whichever it was, so a car under the bridge stays under it.
 */
export function updateDeck(track: Track, car: { x: number; y: number; onDeck?: boolean }): void {
  if (!track.flyovers.length) return;
  const hw = track.def.halfWidth;
  const s = track.samples;
  for (const f of track.flyovers) {
    if (pointInRect(car.x, car.y, f.bridge)) return;
    let near = Infinity;
    for (const i of f.climb) near = Math.min(near, distToSegmentSq(car.x, car.y, s[i], s[(i + 1) % s.length]));
    if (near <= (hw + 10) * (hw + 10)) {
      car.onDeck = true;
      return;
    }
  }
  // Clear of every ramp and deck: back on the ground.
  for (const f of track.flyovers) {
    const b = f.bridge;
    const cx = Math.max(b.x, Math.min(b.x + b.w, car.x));
    const cy = Math.max(b.y, Math.min(b.y + b.h, car.y));
    if (Math.hypot(car.x - cx, car.y - cy) < FLYOVER_RAMP + hw) {
      let near = Infinity;
      for (let i = 0; i < s.length; i++) if (f.raised[i]) near = Math.min(near, distToSegmentSq(car.x, car.y, s[i], s[(i + 1) % s.length]));
      if (near < (hw + 30) * (hw + 30)) return;
    }
  }
  if (car.onDeck) car.onDeck = false;
}

/** What a car's wheels roll on, taking its level at a flyover into account. */
export function carHeightAt(track: Track, x: number, y: number, onDeck?: boolean): number {
  if (onDeck) {
    const f = flyoverAt(track, x, y);
    if (f) return f.bridge.height;
  }
  return heightAt(track, x, y);
}

/** Nearest centerline sample to a car, picking the right road where two cross. */
export function carSampleIndex(track: Track, car: { x: number; y: number; onDeck?: boolean }): number {
  if (track.flyovers.length) {
    const hw = track.def.halfWidth;
    for (const f of track.flyovers) {
      const b = f.bridge;
      if (car.x < b.x - hw * 2 || car.x > b.x + b.w + hw * 2 || car.y < b.y - hw * 2 || car.y > b.y + b.h + hw * 2) continue;
      // Near the crossing: only the stretch on this car's level.
      const s = track.samples;
      const hit = nearestOnGrid(s, car.x, car.y, (i) => (!!f.raised[i] !== !!car.onDeck ? Infinity : (s[i].x - car.x) ** 2 + (s[i].y - car.y) ** 2));
      return Math.max(0, hit.i);
    }
  }
  return nearestSampleIndex(track, car.x, car.y);
}

/** Centerline sample indices on a bridge, in driving order. */
export function bridgeSpan(track: Track, b: Bridge): number[] {
  const fly = track.flyovers.find((f) => f.bridge === b);
  if (fly) return fly.deck;
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
  // Pit lane and bridge decks are always paved; the road may be dirt.
  if (inPitLane(track, x, y) || inBridge(track, x, y)) return 'asphalt';
  if (distanceToCenterline(track, x, y) <= track.def.halfWidth) return track.def.road ?? 'asphalt';
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

/** Where a car's wheels touch the ground, in its own frame (units from its centre). */
export interface WheelBase {
  /** Front and rear axle, ahead of / behind the centre (both positive). */
  front: number;
  rear: number;
  /** Half the distance between left and right wheels. */
  half: number;
  radius: number;
}

export interface CarPose {
  /** Ground height under the car's centre, on the plane through its wheels. */
  height: number;
  /** Nose up is positive. */
  pitch: number;
  /** Positive when the right side (+90° from the heading) is higher. */
  roll: number;
}

const MAX_POSE_PITCH = 0.3;
const MAX_POSE_ROLL = 0.2;

/**
 * Body pose from the ground under each of the four wheels. A wheel far off
 * the others (hanging over a kerb, a wall or an embankment edge) is ignored,
 * so one wheel cannot tip the car over.
 */
export function carPose(track: Track, x: number, y: number, angle: number, onDeck: boolean | undefined, w: WheelBase): CarPose {
  if (surfaceAt(track, x, y) === 'water' && !onDeck) return { height: carHeightAt(track, x, y, onDeck), pitch: 0, roll: 0 };
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  // Right of travel is (-sa, ca) with y pointing down the map.
  const at = (along: number, side: number) => carHeightAt(track, x + along * ca - side * sa, y + along * sa + side * ca, onDeck);
  const h = [at(w.front, -w.half), at(w.front, w.half), at(-w.rear, -w.half), at(-w.rear, w.half)];
  const sorted = [...h].sort((a, b) => a - b);
  const mid = (sorted[1] + sorted[2]) / 2;
  const limit = Math.max(3, w.radius * 1.2);
  for (let i = 0; i < 4; i++) if (Math.abs(h[i] - mid) > limit) h[i] = mid;
  const [fl, fr, rl, rr] = h;
  const frontH = (fl + fr) / 2;
  const rearH = (rl + rr) / 2;
  const base = w.front + w.rear;
  const pitch = clampPose(Math.atan2(frontH - rearH, base), MAX_POSE_PITCH);
  const roll = clampPose(Math.atan2((fr + rr) / 2 - (fl + rl) / 2, w.half * 2), MAX_POSE_ROLL);
  // The plane through the axles, at the centre.
  const height = rearH + (frontH - rearH) * (w.rear / base);
  return { height, pitch, roll };
}

function clampPose(v: number, max: number): number {
  return v > max ? max : v < -max ? -max : v;
}

/** Cars this far apart in height do not collide (bridge vs water). */
export const HEIGHT_SEPARATION = 22;

export function nearestSampleIndex(track: Track, x: number, y: number): number {
  const s = track.samples;
  // Each sample starts its own segment, so it sits in that segment's cells.
  const hit = nearestOnGrid(s, x, y, (i) => (s[i].x - x) ** 2 + (s[i].y - y) ** 2);
  return Math.max(0, hit.i);
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
  meadow: withPits(MEADOW),
  harbor: withPits(HARBOR),
  alpine: withPits(ALPINE),
  oldtown: withPits(OLD_TOWN),
  canyon: withPits(RED_CANYON),
  jungle: withPits(JUNGLE),
  harvest: withPits(HARVEST_RALLY),
  grandprix: withPits(GRAND_PRIX),
};

/** A design with its pit complex laid out beside the start line. */
function withPits(d: MapDesign): TrackDef {
  const { pits, ...def } = d;
  return { ...def, pitSide: pits.side, ...pitComplexAt(def.controlPoints[0], pits.heading, pits.side) };
}

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
