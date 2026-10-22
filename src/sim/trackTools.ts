import {
  buildTrack,
  distanceToCenterline,
  inBridge,
  inWater,
  pitComplex,
  PATCH_SURFACES,
  type Bridge,
  type Surface,
  type Track,
  type TrackDef,
  type Vec2,
} from './track';

/** Every track shares the map size, so the pit complex and walls line up. */
export const MAP_WIDTH = 1600;
export const MAP_HEIGHT = 1050;
export const CUSTOM_PREFIX = 'custom-';
export const MIN_HALF_WIDTH = 40;
export const MAX_HALF_WIDTH = 70;
/** Clearance from the road to the water under an auto bridge deck. */
const BRIDGE_CLEARANCE = 16;
const MIN_DECK_HEIGHT = 22;
/** Road samples kept on the deck past each bank. */
const BRIDGE_OVERHANG = 7;

const LIMITS = {
  controlPoints: 80,
  hills: 40,
  rivers: 4,
  riverPoints: 60,
  patches: 40,
  patchPoints: 60,
  obstacles: 120,
  barriers: 60,
  name: 24,
};

const GROUNDS: readonly Surface[] = ['grass', 'snow', 'sand', 'gravel'];

/** A starter layout: the shared start straight and pits, and a plain loop. */
export function starterTrack(id: string, name: string): TrackDef {
  return finalizeTrack({
    id,
    name,
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    halfWidth: 54,
    checkpointCount: 8,
    controlPoints: [
      { x: 400, y: 210 },
      { x: 700, y: 200 },
      { x: 1000, y: 210 },
      { x: 1300, y: 280 },
      { x: 1420, y: 520 },
      { x: 1300, y: 800 },
      { x: 900, y: 880 },
      { x: 500, y: 870 },
      { x: 220, y: 720 },
      { x: 180, y: 430 },
      { x: 250, y: 260 },
    ],
    terrain: { base: 10, hills: [] },
    obstacles: [],
    ...pitComplex(480),
  });
}

/**
 * Fill in what the editor does not let you touch: map size, checkpoints,
 * the shared pit complex, and bridges wherever the road crosses a river.
 */
export function finalizeTrack(def: TrackDef): TrackDef {
  const base: TrackDef = {
    ...def,
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    checkpointCount: 8,
    halfWidth: Math.min(MAX_HALF_WIDTH, Math.max(MIN_HALF_WIDTH, def.halfWidth)),
    ...pitComplex(480),
    bridges: [],
  };
  return { ...base, bridges: autoBridges(base) };
}

/** One deck per stretch of road over water, at road height plus clearance. */
export function autoBridges(def: TrackDef): Bridge[] {
  if (!def.rivers?.length) return [];
  const t = buildTrack({ ...def, bridges: [] }, { grid: false });
  const s = t.samples;
  const n = s.length;
  const wet = s.map((p) => inWater(t, p.x, p.y));
  const bridges: Bridge[] = [];
  for (let i = 0; i < n; i++) {
    if (!wet[i] || wet[(i - 1 + n) % n]) continue;
    let end = i;
    while (wet[(end + 1) % n] && end - i < n) end++;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let top = 0;
    for (let k = i - BRIDGE_OVERHANG; k <= end + BRIDGE_OVERHANG; k++) {
      const j = ((k % n) + n) % n;
      minX = Math.min(minX, s[j].x);
      minY = Math.min(minY, s[j].y);
      maxX = Math.max(maxX, s[j].x);
      maxY = Math.max(maxY, s[j].y);
      top = Math.max(top, t.sampleHeights[j]);
    }
    // Wide enough sideways for the whole deck; a little short along the road
    // so only this stretch's samples fall inside.
    const pad = def.halfWidth + 20;
    bridges.push({
      x: Math.round(minX - pad),
      y: Math.round(minY - pad),
      w: Math.round(maxX - minX + pad * 2),
      h: Math.round(maxY - minY + pad * 2),
      height: Math.round(Math.max(MIN_DECK_HEIGHT, top + BRIDGE_CLEARANCE)),
    });
  }
  return bridges;
}

export interface TrackProblem {
  message: string;
  /** Where to point at, if somewhere in particular. */
  at?: Vec2;
}

/** Everything that would make a track unfair or broken to race. Empty means OK. */
export function validateTrack(def: TrackDef, built?: Track): TrackProblem[] {
  const out: TrackProblem[] = [];
  const cp = def.controlPoints;
  if (cp.length < 4) return [{ message: 'The road needs at least 4 points.' }];
  const edge = def.halfWidth + 10;
  for (const p of cp) {
    if (p.x < edge || p.y < edge || p.x > def.width - edge || p.y > def.height - edge) {
      out.push({ message: 'Road too close to the edge of the map.', at: p });
      break;
    }
  }
  const t = built ?? buildTrack(def, { grid: false });
  const s = t.samples;
  const n = s.length;

  // Start straight: heading east along the top, so the pits fit beside it.
  const a0 = t.tangentAngles[0];
  const start = s[0];
  if (Math.abs(a0) > 0.35 || start.y < 150 || start.y > 280 || start.x < 300 || start.x > 700) {
    out.push({ message: 'Start line must be on an east-going straight near the top, beside the pits.', at: start });
  }

  // The road must not overlap itself.
  const arc = [0];
  for (let i = 1; i < n; i++) arc.push(arc[i - 1] + t.segmentLengths[i - 1]);
  const lap = arc[n - 1] + t.segmentLengths[n - 1];
  const clear = def.halfWidth * 2 + 20;
  let overlap: Vec2 | null = null;
  for (let i = 0; i < n && !overlap; i += 2) {
    for (let j = i + 2; j < n; j += 2) {
      const along = Math.min(arc[j] - arc[i], lap - (arc[j] - arc[i]));
      if (along < clear * 2.5) continue;
      if (Math.hypot(s[i].x - s[j].x, s[i].y - s[j].y) < clear) {
        overlap = s[i];
        break;
      }
    }
  }
  if (overlap) out.push({ message: 'The road runs into itself here.', at: overlap });

  let tight = 0;
  for (let i = 1; i < n; i++) if (t.curvature[i] > t.curvature[tight]) tight = i;
  if (t.curvature[tight] > 1 / 35) out.push({ message: 'A corner is too tight to drive.', at: s[tight] });

  for (let i = 0; i < n; i++) {
    if (inWater(t, s[i].x, s[i].y) && !inBridge(t, s[i].x, s[i].y)) {
      out.push({ message: 'The road goes through water without a bridge.', at: s[i] });
      break;
    }
  }

  for (const o of def.obstacles) {
    const d = distanceToCenterline(t, o.x, o.y);
    if (o.kind !== 'cone' && d < def.halfWidth + o.r) {
      out.push({ message: `A ${o.kind === 'tree' ? 'tree' : 'tyre stack'} is on the road.`, at: o });
      break;
    }
    if (o.kind === 'cone' && d < def.halfWidth * 0.5) {
      out.push({ message: 'A cone is in the middle of the road.', at: o });
      break;
    }
  }
  for (const b of def.pitBoxes) {
    if (distanceToCenterline(t, b.x + b.w / 2, b.y + b.h / 2) <= def.halfWidth) {
      out.push({ message: 'The road runs over the pit boxes.', at: { x: b.x + b.w / 2, y: b.y + b.h / 2 } });
      break;
    }
  }
  return out;
}

const num = (v: unknown, lo: number, hi: number, fallback = lo): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

function points(v: unknown, max: number): Vec2[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, max).map((p) => ({ x: num(p?.x, 0, MAP_WIDTH), y: num(p?.y, 0, MAP_HEIGHT) }));
}

/**
 * Turn untrusted JSON (an import, or a track sent to an online room) into a
 * clean, finalized custom track, or null when it is not one.
 */
export function parseTrackDef(raw: unknown): TrackDef | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = String(o.id ?? '');
  if (!id.startsWith(CUSTOM_PREFIX) || id.length > 64 || !/^[a-z0-9-]+$/.test(id)) return null;
  const controlPoints = points(o.controlPoints, LIMITS.controlPoints);
  if (controlPoints.length < 4) return null;
  const terrain = o.terrain && typeof o.terrain === 'object' ? (o.terrain as Record<string, unknown>) : null;
  const surface = (v: unknown, allowed: readonly Surface[], fallback: Surface): Surface =>
    allowed.includes(v as Surface) ? (v as Surface) : fallback;
  const def: TrackDef = {
    id,
    name: String(o.name ?? 'Custom track').trim().slice(0, LIMITS.name) || 'Custom track',
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    halfWidth: num(o.halfWidth, MIN_HALF_WIDTH, MAX_HALF_WIDTH, 54),
    checkpointCount: 8,
    controlPoints,
    ground: surface(o.ground, GROUNDS, 'grass'),
    terrain: {
      base: num(terrain?.base, 0, 60, 10),
      hills: (Array.isArray(terrain?.hills) ? terrain.hills : []).slice(0, LIMITS.hills).map((h) => ({
        x: num(h?.x, -200, MAP_WIDTH + 200),
        y: num(h?.y, -200, MAP_HEIGHT + 200),
        r: num(h?.r, 30, 400, 140),
        h: num(h?.h, -40, 140, 50),
      })),
    },
    rivers: (Array.isArray(o.rivers) ? o.rivers : [])
      .slice(0, LIMITS.rivers)
      .map((r) => ({ halfWidth: num(r?.halfWidth, 12, 70, 30), points: pointsLoose(r?.points, LIMITS.riverPoints) }))
      .filter((r) => r.points.length >= 2),
    patches: (Array.isArray(o.patches) ? o.patches : [])
      .slice(0, LIMITS.patches)
      .map((p) => ({ surface: surface(p?.surface, PATCH_SURFACES, 'sand'), points: points(p?.points, LIMITS.patchPoints), overRoad: !!p?.overRoad }))
      .filter((p) => p.points.length >= 3),
    barriers: (Array.isArray(o.barriers) ? o.barriers : []).slice(0, LIMITS.barriers).map((b) => ({
      a: { x: num(b?.a?.x, 0, MAP_WIDTH), y: num(b?.a?.y, 0, MAP_HEIGHT) },
      b: { x: num(b?.b?.x, 0, MAP_WIDTH), y: num(b?.b?.y, 0, MAP_HEIGHT) },
    })),
    obstacles: (Array.isArray(o.obstacles) ? o.obstacles : []).slice(0, LIMITS.obstacles).map((ob) => {
      const kind = ob?.kind === 'tree' || ob?.kind === 'cone' ? ob.kind : 'tyres';
      return {
        x: num(ob?.x, 0, MAP_WIDTH),
        y: num(ob?.y, 0, MAP_HEIGHT),
        r: kind === 'cone' ? 6 : num(ob?.r, 8, 30, 16),
        kind,
      };
    }),
    pitLane: { x: 0, y: 0, w: 0, h: 0 },
    pitBoxes: [],
  };
  return finalizeTrack(def);
}

/** River points may run off the map so the water flows out of sight. */
function pointsLoose(v: unknown, max: number): Vec2[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, max).map((p) => ({ x: num(p?.x, -300, MAP_WIDTH + 300), y: num(p?.y, -300, MAP_HEIGHT + 300) }));
}
