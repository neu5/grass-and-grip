import { statsFor, type CarState, type GameState, type Surface, type Track } from '../sim';
import { themeLook, type EdgeStyle, type GroundPattern } from './themes';

/** Paints the ground, road, edges and the finish line in world units times `res`. */
export function paintTrackSurface(track: Track, res: number): HTMLCanvasElement {
  const { width, height } = track.def;
  const c = document.createElement('canvas');
  c.width = width * res;
  c.height = height * res;
  const ctx = c.getContext('2d')!;
  ctx.scale(res, res);
  const look = themeLook(track.def);

  const groundSurface = track.def.ground ?? 'grass';
  const ground = look.ground[groundSurface] ?? GROUND_LOOK[groundSurface] ?? GRASS_LOOK;
  ctx.fillStyle = ground.base;
  ctx.fillRect(0, 0, width, height);
  paintGroundPattern(ctx, width, height, look.pattern, ground.stripe);

  paintPatches(ctx, track, false);
  paintWater(ctx, track);
  paintPitLane(ctx, track);

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  paintRoad(ctx, track);
  // Under each flyover: bare ground, then just the road that runs underneath.
  for (const f of track.flyovers) {
    const b = f.bridge;
    ctx.save();
    ctx.beginPath();
    ctx.rect(b.x, b.y, b.w, b.h);
    ctx.clip();
    ctx.fillStyle = ground.base;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    paintRoad(ctx, track, (i) => !f.raised[i]);
    ctx.restore();
  }

  const g = track.gates[0];
  const steps = 10;
  const sq = 7;
  for (let i = 0; i < steps; i++) {
    for (let r = 0; r < 2; r++) {
      const t0 = 0.12 + (i / steps) * 0.76;
      const t1 = 0.12 + ((i + 1) / steps) * 0.76;
      const ax = g.a.x + (g.b.x - g.a.x) * t0 + g.tx * sq * (r - 1);
      const ay = g.a.y + (g.b.y - g.a.y) * t0 + g.ty * sq * (r - 1);
      const bx = g.a.x + (g.b.x - g.a.x) * t1 + g.tx * sq * (r - 1);
      const by = g.a.y + (g.b.y - g.a.y) * t1 + g.ty * sq * (r - 1);
      ctx.fillStyle = (i + r) % 2 === 0 ? '#fff' : '#111';
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.lineTo(bx + g.tx * sq, by + g.ty * sq);
      ctx.lineTo(ax + g.tx * sq, ay + g.ty * sq);
      ctx.fill();
    }
  }
  paintPatches(ctx, track, true);
  paintPitBoxes(ctx, track);
  return c;
}

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** The road in the map's style; `keep` paints only part of it. */
function paintRoad(ctx: CanvasRenderingContext2D, track: Track, keep?: Keep) {
  const look = themeLook(track.def);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (track.def.road === 'dirt') paintDirtRoad(ctx, track, keep);
  else paintAsphaltRoad(ctx, track, look.edge, look.pattern === 'tiles', keep);
}

/** Texture over the plain ground colour. Fixed seeds, so it looks the same every load. */
function paintGroundPattern(ctx: CanvasRenderingContext2D, width: number, height: number, pattern: GroundPattern, detail: string) {
  const rand = seeded(11);
  ctx.save();
  ctx.fillStyle = detail;
  ctx.strokeStyle = detail;
  if (pattern === 'stripes') {
    for (let x = 0; x < width; x += 80) ctx.fillRect(x, 0, 40, height);
  } else if (pattern === 'speckle') {
    for (let i = 0; i < (width * height) / 260; i++) ctx.fillRect(rand() * width, rand() * height, 3 + rand() * 4, 2 + rand() * 3);
  } else if (pattern === 'tiles') {
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.7;
    for (let x = 0; x < width; x += 36) ctx.strokeRect(x, 0, 36, height);
    for (let y = 0; y < height; y += 36) ctx.strokeRect(0, y, width, 36);
  } else if (pattern === 'ripples') {
    ctx.lineWidth = 3;
    for (let y = 0; y < height + 40; y += 22) {
      ctx.beginPath();
      for (let x = 0; x <= width; x += 20) ctx.lineTo(x, y + Math.sin(x / 70 + y * 0.13) * 8);
      ctx.stroke();
    }
  } else {
    // Leaf litter: dark and light blobs.
    for (let i = 0; i < (width * height) / 420; i++) {
      ctx.globalAlpha = 0.5 + rand() * 0.5;
      ctx.fillStyle = rand() < 0.5 ? detail : '#26562a';
      ctx.beginPath();
      ctx.ellipse(rand() * width, rand() * height, 3 + rand() * 6, 2 + rand() * 4, rand() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** Points along the centreline pushed sideways by `off` (positive to the left of travel). */
function offsetLine(track: Track, off: number): { x: number; y: number }[] {
  return track.samples.map((p, i) => ({ x: p.x + track.normals[i].x * off, y: p.y + track.normals[i].y * off }));
}

/** Which samples to paint: all of them, or only some (the deck of a flyover, or the road under it). */
type Keep = ((i: number) => boolean) | undefined;

/** Path through `pts`: the closed loop, or open runs of kept samples. */
function tracePoints(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[], keep: Keep) {
  ctx.beginPath();
  if (!keep) {
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    return;
  }
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    if (!keep(i)) continue;
    const next = pts[(i + 1) % n];
    if (!keep((i - 1 + n) % n)) ctx.moveTo(pts[i].x, pts[i].y);
    ctx.lineTo(next.x, next.y);
  }
}

function strokeLine(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[], keep?: Keep) {
  tracePoints(ctx, pts, keep);
  ctx.stroke();
}

function paintAsphaltRoad(ctx: CanvasRenderingContext2D, track: Track, edge: EdgeStyle, centreLine: boolean, keep?: Keep) {
  const hw = track.def.halfWidth;
  tracePoints(ctx, track.samples, keep);
  if (edge === 'curbs') {
    // Painted red and white curbs the whole way round.
    ctx.strokeStyle = '#f4f4f4';
    ctx.lineWidth = hw * 2 + 18;
    ctx.stroke();
    ctx.setLineDash([22, 22]);
    ctx.strokeStyle = '#d0302a';
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = '#5d5f64';
    ctx.lineWidth = hw * 2;
    ctx.stroke();
    ctx.setLineDash([24, 28]);
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);
    return;
  }
  // A darker shoulder, the tarmac, then solid white edge lines.
  ctx.strokeStyle = 'rgba(40,40,44,0.35)';
  ctx.lineWidth = hw * 2 + 10;
  ctx.stroke();
  ctx.strokeStyle = '#f2f2f2';
  ctx.lineWidth = hw * 2;
  ctx.stroke();
  ctx.strokeStyle = edge === 'kerbs' ? '#55575c' : '#5d5f64';
  ctx.lineWidth = hw * 2 - 8;
  ctx.stroke();
  if (centreLine) {
    ctx.setLineDash([26, 26]);
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (edge === 'kerbs') paintKerbs(ctx, track, keep);
}

/** Red and white kerbs on both edges wherever the road bends. */
function paintKerbs(ctx: CanvasRenderingContext2D, track: Track, keep?: Keep) {
  const hw = track.def.halfWidth;
  const s = track.samples;
  const n = s.length;
  // Smooth curvature a little so kerbs run through a whole corner.
  const bend = s.map((_, i) => {
    let k = 0;
    for (let d = -6; d <= 6; d++) k = Math.max(k, track.curvature[(i + d + n) % n]);
    return k;
  });
  let arc = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const len = track.segmentLengths[i];
    if (bend[i] > 1 / 420 && (!keep || keep(i))) {
      for (const side of [1, -1]) {
        const a0 = hw - 9;
        const a1 = hw + 4;
        const ni = track.normals[i];
        const nj = track.normals[j];
        ctx.fillStyle = Math.floor(arc / 14) % 2 ? '#f4f4f4' : '#d0302a';
        ctx.beginPath();
        ctx.moveTo(s[i].x + ni.x * a0 * side, s[i].y + ni.y * a0 * side);
        ctx.lineTo(s[j].x + nj.x * a0 * side, s[j].y + nj.y * a0 * side);
        ctx.lineTo(s[j].x + nj.x * a1 * side, s[j].y + nj.y * a1 * side);
        ctx.lineTo(s[i].x + ni.x * a1 * side, s[i].y + ni.y * a1 * side);
        ctx.closePath();
        ctx.fill();
      }
    }
    arc += len;
  }
}

/** A rally stage: packed earth with soft edges, two worn ruts and loose stones. */
function paintDirtRoad(ctx: CanvasRenderingContext2D, track: Track, keep?: Keep) {
  const hw = track.def.halfWidth;
  tracePoints(ctx, track.samples, keep);
  ctx.strokeStyle = 'rgba(122, 94, 62, 0.55)';
  ctx.lineWidth = hw * 2 + 18;
  ctx.stroke();
  ctx.strokeStyle = '#8f7150';
  ctx.lineWidth = hw * 2;
  ctx.stroke();
  ctx.strokeStyle = '#7b5d3f';
  ctx.lineWidth = 8;
  for (const off of [-hw * 0.38, hw * 0.38]) strokeLine(ctx, offsetLine(track, off), keep);
  ctx.strokeStyle = 'rgba(160, 128, 92, 0.6)';
  ctx.lineWidth = 3;
  strokeLine(ctx, offsetLine(track, 0), keep);
  const rand = seeded(5);
  ctx.fillStyle = '#a58660';
  track.samples.forEach((p, i) => {
    if (i % 2 || (keep && !keep(i))) return;
    const nrm = track.normals[i];
    for (let k = 0; k < 3; k++) {
      const off = (rand() * 2 - 1) * hw * 0.95;
      ctx.fillRect(p.x + nrm.x * off, p.y + nrm.y * off, 2.5, 2.5);
    }
  });
}

/** Base fill and mowing stripe for the open ground. */
const GRASS_LOOK = { base: '#4a9a3f', stripe: '#52a546' };
const GROUND_LOOK: Partial<Record<Surface, { base: string; stripe: string }>> = {
  grass: GRASS_LOOK,
  snow: { base: '#e6edf2', stripe: '#eef3f6' },
  sand: { base: '#c4a35a', stripe: '#cdae66' },
  gravel: { base: '#9a9387', stripe: '#a39c90' },
  dirt: { base: '#8f7150', stripe: '#977856' },
  asphalt: { base: '#a3a5a8', stripe: '#9a9ca0' },
};

const PATCH_LOOK: Record<Surface, { fill: string; detail: string; alpha?: number }> = {
  grass: { fill: '#4a9a3f', detail: '#52a546' },
  sand: { fill: '#c4a35a', detail: '#d4b36a' },
  gravel: { fill: '#948d81', detail: '#aaa397' },
  snow: { fill: '#eef3f7', detail: '#dce7ee' },
  ice: { fill: '#bfe2f2', detail: '#e8f6fc' },
  dirt: { fill: '#8f7150', detail: '#a58660' },
  mud: { fill: '#5b4330', detail: '#4a3524' },
  water: { fill: '#2a6fa8', detail: '#3480b8' },
  asphalt: { fill: '#5d5f64', detail: '#66686d' },
};

/** Patches under the road first, then the ones painted over it (half see-through so lines show). */
function paintPatches(ctx: CanvasRenderingContext2D, track: Track, overRoad: boolean) {
  for (const p of track.patches) {
    if (!!p.overRoad !== overRoad || p.points.length < 3) continue;
    const look = PATCH_LOOK[p.surface];
    ctx.save();
    ctx.beginPath();
    p.points.forEach((q, i) => (i === 0 ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y)));
    ctx.closePath();
    ctx.globalAlpha = overRoad ? 0.78 : 1;
    ctx.fillStyle = look.fill;
    ctx.fill();
    ctx.clip();
    ctx.fillStyle = look.detail;
    const b = p.box;
    if (p.surface === 'asphalt') {
      // Paved run-off: plain, with a faint edge.
    } else if (p.surface === 'mud') {
      // Furrows: dark rows with a wet sheen.
      for (let y = b.y; y < b.y + b.h; y += 12) ctx.fillRect(b.x, y, b.w, 5);
      ctx.fillStyle = 'rgba(150, 170, 190, 0.18)';
      for (let y = b.y + 6; y < b.y + b.h; y += 24) ctx.fillRect(b.x, y, b.w, 2);
    } else if (p.surface === 'gravel' || p.surface === 'snow' || p.surface === 'dirt') {
      // Speckles, placed by a fixed pattern so the texture is the same every load.
      for (let y = b.y; y < b.y + b.h; y += 9) {
        for (let x = b.x + ((y * 7) % 11); x < b.x + b.w; x += 13) ctx.fillRect(x, y, 3, 3);
      }
    } else if (p.surface === 'ice') {
      for (let k = -b.h; k < b.w; k += 26) {
        ctx.fillRect(b.x + k, b.y, 6, 2);
        ctx.beginPath();
        ctx.moveTo(b.x + k, b.y + b.h);
        ctx.lineTo(b.x + k + b.h * 0.6, b.y);
        ctx.lineTo(b.x + k + b.h * 0.6 + 5, b.y);
        ctx.lineTo(b.x + k + 5, b.y + b.h);
        ctx.fill();
      }
    } else {
      for (let x = b.x; x < b.x + b.w; x += 36) ctx.fillRect(x, b.y, 18, b.h);
    }
    ctx.restore();
  }
}

/**
 * Lifts the road paint under each bridge into its own canvas (for the deck)
 * and paints water back over the ground below, so no asphalt shows through.
 */
export function splitBridgeDecks(surface: HTMLCanvasElement, track: Track, res: number): HTMLCanvasElement[] {
  const ctx = surface.getContext('2d')!;
  return (track.def.bridges ?? []).map((b) => {
    const deck = document.createElement('canvas');
    deck.width = Math.round(b.w * res);
    deck.height = Math.round(b.h * res);
    const fly = track.flyovers.find((f) => f.bridge === b);
    if (fly) {
      const dctx = deck.getContext('2d')!;
      dctx.setTransform(res, 0, 0, res, -b.x * res, -b.y * res);
      paintRoad(dctx, track, (i) => !!fly.raised[i]);
      return deck;
    }
    deck.getContext('2d')!.drawImage(surface, b.x * res, b.y * res, b.w * res, b.h * res, 0, 0, deck.width, deck.height);
    ctx.save();
    ctx.setTransform(res, 0, 0, res, 0, 0);
    ctx.beginPath();
    ctx.rect(b.x, b.y, b.w, b.h);
    ctx.clip();
    paintWater(ctx, track);
    ctx.restore();
    return deck;
  });
}

function paintWater(ctx: CanvasRenderingContext2D, track: Track) {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const r of track.rivers) {
    ctx.beginPath();
    r.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.strokeStyle = '#2a6fa8';
    ctx.lineWidth = r.halfWidth * 2;
    ctx.stroke();
    ctx.setLineDash([46, 34]);
    ctx.strokeStyle = '#3480b8';
    ctx.lineWidth = r.halfWidth * 0.9;
    ctx.stroke();
    ctx.setLineDash([14, 70]);
    ctx.strokeStyle = 'rgba(180, 220, 255, 0.22)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}

function paintPitLane(ctx: CanvasRenderingContext2D, track: Track) {
  const lane = track.def.pitLane;
  ctx.fillStyle = '#6a6d73';
  ctx.fillRect(lane.x, lane.y, lane.w, lane.h);
  ctx.strokeStyle = '#cfd3d8';
  ctx.lineWidth = 3;
  ctx.strokeRect(lane.x + 1.5, lane.y + 1.5, lane.w - 3, lane.h - 3);
}

function paintPitBoxes(ctx: CanvasRenderingContext2D, track: Track) {
  track.def.pitBoxes.forEach((b, i) => {
    ctx.fillStyle = '#575a60';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = '#f4f4f4';
    ctx.lineWidth = 3.5;
    ctx.strokeRect(b.x + 2, b.y + 2, b.w - 4, b.h - 4);
    ctx.setLineDash([7, 5]);
    ctx.strokeStyle = '#f0d24a';
    ctx.lineWidth = 2;
    ctx.strokeRect(b.x + 9, b.y + 9, b.w - 18, b.h - 18);
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = '700 26px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), b.x + b.w / 2, b.y + b.h / 2);
  });
}

/** Accumulates tyre marks from sliding cars onto a transparent canvas. */
export class SkidMarks {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private last = new Map<number, { x: number; y: number }[]>();
  dirty = false;

  constructor(width: number, height: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d')!;
  }

  update(state: GameState) {
    const ctx = this.ctx;
    for (const car of state.cars) {
      const sliding = car.slip > 95 || car.handbrake;
      const wheels = rearWheels(car);
      const prev = this.last.get(car.id);
      if (sliding && prev) {
        ctx.strokeStyle = car.onGrass ? 'rgba(70,45,20,0.3)' : 'rgba(20,20,20,0.35)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let i = 0; i < 2; i++) {
          ctx.moveTo(prev[i].x, prev[i].y);
          ctx.lineTo(wheels[i].x, wheels[i].y);
        }
        ctx.stroke();
        this.dirty = true;
      }
      if (sliding) this.last.set(car.id, wheels);
      else this.last.delete(car.id);
    }
  }
}

function rearWheels(car: CarState) {
  const stats = statsFor(car.kind);
  const ca = Math.cos(car.angle);
  const sa = Math.sin(car.angle);
  const bx = car.x - ca * stats.length * 0.32;
  const by = car.y - sa * stats.length * 0.32;
  const w = stats.width * 0.4;
  return [
    { x: bx - sa * w, y: by + ca * w },
    { x: bx + sa * w, y: by - ca * w },
  ];
}
