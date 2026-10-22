import './editor.css';
import { deleteCustomTrack, loadCustomTracks, saveCustomTrack } from './client/customTracks';
import { Renderer3D } from './client/renderer3d';
import {
  buildTrack,
  createRace,
  CUSTOM_PREFIX,
  finalizeTrack,
  mapSizeOf,
  parseTrackDef,
  PATCH_SURFACES,
  registerTrack,
  resizeTrack,
  starterTrack,
  validateTrack,
  type MapSize,
  type Obstacle,
  type Surface,
  type Track,
  type TrackDef,
  type TrackProblem,
  type Vec2,
} from './sim';

type Tool = 'road' | 'hills' | 'river' | 'paint' | 'objects' | 'barriers';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const canvas = $<HTMLCanvasElement>('#map');
const ctx = canvas.getContext('2d')!;

const SURFACE_COLORS: Record<Surface, string> = {
  grass: '#4a9a3f',
  snow: '#e6edf2',
  sand: '#c4a35a',
  gravel: '#948d81',
  ice: '#bfe2f2',
  water: '#2a6fa8',
  asphalt: '#5d5f64',
};

const HELP: Record<Tool, string> = {
  road: 'Click to add a point where it fits best. Drag points to shape the road. Right-click a point to remove it. Point 1 is the start line: keep it on the straight by the pits.',
  hills: 'Click to add a hill. Drag to move it. Scroll to change its size, Shift+scroll to raise or lower it (below zero makes a dip). Right-click to remove.',
  river: 'Click to add points to the selected river (end it off the map edge to let it flow away). Drag points. Right-click a point to remove it. Bridges appear where the road crosses.',
  paint: 'Pick a surface, then click the corners of an area. Click the first corner or press Enter to finish, Esc to cancel. Drag corners to adjust. Right-click an area to remove it.',
  objects: 'Pick an object and click to place it. Drag to move. Right-click to remove. Cones may sit on the road edge; trees and tyres must stay off it.',
  barriers: 'Drag to draw a barrier wall. Right-click one to remove it.',
};

let def: TrackDef = starterTrack(newId('Track'), 'My track');
let built: Track = buildTrack(def, { grid: false });
let problems: TrackProblem[] = [];
let tool: Tool = 'road';
let history: string[] = [];
let dirty = false;
let paintSurface: Surface = 'sand';
let paintOverRoad = false;
let objectKind: Obstacle['kind'] = 'tree';
let riverIndex = 0;
let drawing: Vec2[] | null = null;
let barrierStart: Vec2 | null = null;
let hover: Vec2 | null = null;

type Drag = { kind: 'point' | 'hill' | 'river' | 'patch' | 'object'; i: number; j?: number } | null;
let drag: Drag = null;

function newId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'track';
  return `${CUSTOM_PREFIX}${slug}-${Date.now().toString(36)}`;
}

// ---- view transform ----
let scale = 1;
let ox = 0;
let oy = 0;

function layout() {
  const r = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  scale = Math.min((r.width - 24) / def.width, (r.height - 24) / def.height) * dpr;
  ox = (canvas.width - def.width * scale) / 2;
  oy = (canvas.height - def.height * scale) / 2;
  draw();
}

function toWorld(e: MouseEvent): Vec2 {
  const r = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  return { x: ((e.clientX - r.left) * dpr - ox) / scale, y: ((e.clientY - r.top) * dpr - oy) / scale };
}

/** Pick radius in world units (a fixed size on screen). */
function pickRadius(): number {
  return (14 * (window.devicePixelRatio || 1)) / scale;
}

// ---- edits ----
function snapshot() {
  history.push(JSON.stringify(def));
  if (history.length > 80) history.shift();
}

/** Re-finalize (bridges, pits), rebuild and re-check after any change. */
function changed(record = true) {
  if (record) dirty = true;
  def = finalizeTrack(def);
  built = buildTrack(def, { grid: false });
  problems = validateTrack(def, built);
  renderProblems();
  draw();
}

function undo() {
  const prev = history.pop();
  if (!prev) return;
  def = JSON.parse(prev);
  syncFields();
  changed();
  layout();
}

function dist(a: Vec2, b: Vec2) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function nearest<T extends Vec2>(list: T[], p: Vec2, within: number): number {
  let best = -1;
  let bestD = within;
  list.forEach((q, i) => {
    const d = dist(q, p);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

function segDist(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  let t = len2 > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(a.x + abx * t - p.x, a.y + aby * t - p.y);
}

function pointInPoly(p: Vec2, pts: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Insert a road point where it lengthens the loop least. */
function insertRoadPoint(p: Vec2) {
  const cp = def.controlPoints;
  let best = 0;
  let bestCost = Infinity;
  for (let i = 0; i < cp.length; i++) {
    const a = cp[i];
    const b = cp[(i + 1) % cp.length];
    const cost = dist(a, p) + dist(p, b) - dist(a, b);
    if (cost < bestCost) {
      bestCost = cost;
      best = i;
    }
  }
  cp.splice(best + 1, 0, p);
}

function hills() {
  def.terrain ??= { base: 10, hills: [] };
  return def.terrain.hills;
}

function rivers() {
  def.rivers ??= [];
  return def.rivers;
}

function round(p: Vec2): Vec2 {
  return { x: Math.round(p.x), y: Math.round(p.y) };
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('pointerdown', (e) => {
  const p = toWorld(e);
  const pick = pickRadius();
  const right = e.button === 2;
  canvas.setPointerCapture(e.pointerId);

  if (tool === 'road') {
    const i = nearest(def.controlPoints, p, pick);
    if (right) {
      if (i >= 0 && def.controlPoints.length > 4) {
        snapshot();
        def.controlPoints.splice(i, 1);
        changed();
      }
      return;
    }
    snapshot();
    if (i >= 0) drag = { kind: 'point', i };
    else {
      insertRoadPoint(round(p));
      changed();
      drag = { kind: 'point', i: def.controlPoints.findIndex((q) => q.x === Math.round(p.x) && q.y === Math.round(p.y)) };
    }
    return;
  }

  if (tool === 'hills') {
    const list = hills();
    const i = nearest(list, p, Math.max(pick, 20));
    snapshot();
    if (right) {
      if (i >= 0) list.splice(i, 1);
      changed();
      return;
    }
    if (i >= 0) drag = { kind: 'hill', i };
    else {
      list.push({ ...round(p), r: 140, h: 60 });
      changed();
      drag = { kind: 'hill', i: list.length - 1 };
    }
    return;
  }

  if (tool === 'river') {
    const list = rivers();
    for (let r = 0; r < list.length; r++) {
      const j = nearest(list[r].points, p, pick);
      if (j < 0) continue;
      snapshot();
      riverIndex = r;
      if (right) {
        list[r].points.splice(j, 1);
        if (list[r].points.length < 2) list.splice(r, 1);
        riverIndex = Math.max(0, Math.min(riverIndex, list.length - 1));
        changed();
      } else drag = { kind: 'river', i: r, j };
      renderToolOptions();
      return;
    }
    if (right) return;
    snapshot();
    if (!list[riverIndex]) {
      list.push({ halfWidth: 30, points: [] });
      riverIndex = list.length - 1;
    }
    list[riverIndex].points.push(round(p));
    changed();
    renderToolOptions();
    return;
  }

  if (tool === 'paint') {
    def.patches ??= [];
    if (right) {
      const i = def.patches.findLastIndex((pt) => pointInPoly(p, pt.points));
      if (i >= 0) {
        snapshot();
        def.patches.splice(i, 1);
        changed();
      }
      drawing = null;
      return;
    }
    if (drawing) {
      if (drawing.length >= 3 && dist(drawing[0], p) < pick) finishPatch();
      else drawing.push(round(p));
      draw();
      return;
    }
    for (let i = def.patches.length - 1; i >= 0; i--) {
      const j = nearest(def.patches[i].points, p, pick);
      if (j >= 0) {
        snapshot();
        drag = { kind: 'patch', i, j };
        return;
      }
    }
    drawing = [round(p)];
    draw();
    return;
  }

  if (tool === 'objects') {
    const i = nearest(def.obstacles, p, Math.max(pick, 16));
    snapshot();
    if (right) {
      if (i >= 0) def.obstacles.splice(i, 1);
      changed();
      return;
    }
    if (i >= 0) drag = { kind: 'object', i };
    else {
      const r = objectKind === 'cone' ? 6 : objectKind === 'tree' ? 16 : 16;
      def.obstacles.push({ ...round(p), r, kind: objectKind });
      changed();
    }
    return;
  }

  if (tool === 'barriers') {
    def.barriers ??= [];
    if (right) {
      const i = def.barriers.findIndex((b) => segDist(p, b.a, b.b) < pick);
      if (i >= 0) {
        snapshot();
        def.barriers.splice(i, 1);
        changed();
      }
      return;
    }
    barrierStart = round(p);
  }
});

canvas.addEventListener('pointermove', (e) => {
  const p = round(toWorld(e));
  hover = p;
  $('#status').textContent = `x ${p.x}  y ${p.y}`;
  if (drag) {
    if (drag.kind === 'point') def.controlPoints[drag.i] = p;
    else if (drag.kind === 'hill') Object.assign(hills()[drag.i], p);
    else if (drag.kind === 'river') rivers()[drag.i].points[drag.j!] = p;
    else if (drag.kind === 'patch') def.patches![drag.i].points[drag.j!] = p;
    else if (drag.kind === 'object') Object.assign(def.obstacles[drag.i], p);
    // Cheap redraw while dragging; full check on release.
    built = buildTrack(def, { grid: false });
    draw();
    return;
  }
  if (drawing || barrierStart) draw();
});

canvas.addEventListener('pointerup', (e) => {
  if (drag) {
    drag = null;
    changed();
  }
  if (barrierStart) {
    const end = round(toWorld(e));
    if (dist(barrierStart, end) > 15) {
      snapshot();
      def.barriers ??= [];
      def.barriers.push({ a: barrierStart, b: end });
      changed();
    }
    barrierStart = null;
    draw();
  }
});

canvas.addEventListener(
  'wheel',
  (e) => {
    if (tool !== 'hills' || !hover) return;
    const i = nearest(hills(), hover, Math.max(pickRadius() * 3, 60));
    if (i < 0) return;
    e.preventDefault();
    snapshot();
    const h = hills()[i];
    const step = e.deltaY > 0 ? -1 : 1;
    if (e.shiftKey) h.h = Math.max(-40, Math.min(140, h.h + step * 5));
    else h.r = Math.max(30, Math.min(400, h.r + step * 10));
    changed();
  },
  { passive: false },
);

function finishPatch() {
  if (!drawing || drawing.length < 3) return;
  snapshot();
  def.patches ??= [];
  def.patches.push({ surface: paintSurface, points: drawing, overRoad: paintOverRoad || undefined });
  drawing = null;
  changed();
}

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
    e.preventDefault();
    undo();
  }
  if (e.code === 'Enter') finishPatch();
  if (e.code === 'Escape') {
    drawing = null;
    barrierStart = null;
    draw();
  }
});

// ---- drawing ----
function draw() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0d1116';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(scale, 0, 0, scale, ox, oy);
  const px = 1 / scale;

  ctx.fillStyle = SURFACE_COLORS[def.ground ?? 'grass'];
  ctx.fillRect(0, 0, def.width, def.height);

  for (const h of def.terrain?.hills ?? []) {
    const g = ctx.createRadialGradient(h.x, h.y, 0, h.x, h.y, h.r * 1.6);
    const up = h.h >= 0;
    const a = Math.min(0.5, Math.abs(h.h) / 160);
    g.addColorStop(0, up ? `rgba(255,236,170,${a})` : `rgba(0,30,40,${a})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(h.x, h.y, h.r * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const p of def.patches ?? []) {
    if (p.overRoad) continue;
    polygon(p.points, SURFACE_COLORS[p.surface]);
  }

  for (const r of built.rivers) {
    ctx.strokeStyle = SURFACE_COLORS.water;
    ctx.lineWidth = r.halfWidth * 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    r.points.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.stroke();
  }

  ctx.fillStyle = '#6a6d73';
  const lane = def.pitLane;
  ctx.fillRect(lane.x, lane.y, lane.w, lane.h);
  ctx.strokeStyle = '#f2c230';
  ctx.lineWidth = 2 * px;
  for (const b of def.pitBoxes) ctx.strokeRect(b.x, b.y, b.w, b.h);

  // Road with curbs.
  const s = built.samples;
  const loop = () => {
    ctx.beginPath();
    s.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.closePath();
  };
  ctx.lineJoin = 'round';
  loop();
  ctx.strokeStyle = '#d0302a';
  ctx.lineWidth = def.halfWidth * 2 + 14;
  ctx.stroke();
  loop();
  ctx.strokeStyle = SURFACE_COLORS.asphalt;
  ctx.lineWidth = def.halfWidth * 2;
  ctx.stroke();
  // Driving direction.
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  for (let i = 12; i < s.length; i += 36) {
    const a = built.tangentAngles[i];
    ctx.save();
    ctx.translate(s[i].x, s[i].y);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(12, 0);
    ctx.lineTo(-8, -9);
    ctx.lineTo(-8, 9);
    ctx.fill();
    ctx.restore();
  }
  // Start line.
  const g0 = built.gates[0];
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(g0.a.x, g0.a.y);
  ctx.lineTo(g0.b.x, g0.b.y);
  ctx.stroke();

  for (const p of def.patches ?? []) if (p.overRoad) polygon(p.points, SURFACE_COLORS[p.surface], 0.75);

  for (const b of def.bridges ?? []) {
    ctx.strokeStyle = '#ff9f43';
    ctx.lineWidth = 3 * px;
    ctx.setLineDash([10 * px, 6 * px]);
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.setLineDash([]);
    label(`bridge ${b.height}`, b.x + 4 * px, b.y - 6 * px, '#ff9f43');
  }

  for (const b of def.barriers ?? []) {
    ctx.strokeStyle = '#c9372c';
    ctx.lineWidth = 10;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(b.a.x, b.a.y);
    ctx.lineTo(b.b.x, b.b.y);
    ctx.stroke();
    ctx.strokeStyle = '#eee';
    ctx.setLineDash([11, 11]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (barrierStart && hover) {
    ctx.strokeStyle = '#ffd54a';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(barrierStart.x, barrierStart.y);
    ctx.lineTo(hover.x, hover.y);
    ctx.stroke();
  }

  for (const o of def.obstacles) {
    ctx.beginPath();
    if (o.kind === 'cone') {
      ctx.fillStyle = '#ff6a1a';
      ctx.moveTo(o.x, o.y - 9);
      ctx.lineTo(o.x + 7, o.y + 6);
      ctx.lineTo(o.x - 7, o.y + 6);
      ctx.fill();
    } else {
      ctx.fillStyle = o.kind === 'tree' ? '#2f6e2a' : '#1a1a1a';
      ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
      ctx.fill();
      if (o.kind === 'tyres') {
        ctx.strokeStyle = '#ddd';
        ctx.lineWidth = 3;
        ctx.stroke();
      }
    }
  }

  // Handles for the active tool.
  if (tool === 'road') {
    def.controlPoints.forEach((p, i) => handle(p, i === 0 ? '#fff' : '#ffd54a', String(i + 1)));
  }
  if (tool === 'hills') {
    for (const h of def.terrain?.hills ?? []) {
      ctx.strokeStyle = 'rgba(255,213,74,0.8)';
      ctx.lineWidth = 2 * px;
      ctx.beginPath();
      ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2);
      ctx.stroke();
      handle(h, '#ffd54a', `${h.h > 0 ? '+' : ''}${h.h}`);
    }
  }
  if (tool === 'river') {
    (def.rivers ?? []).forEach((r, k) => r.points.forEach((p) => handle(p, k === riverIndex ? '#8cc8ff' : '#4d7aa0')));
  }
  if (tool === 'paint') {
    for (const p of def.patches ?? []) p.points.forEach((q) => handle(q, '#ffd54a'));
    if (drawing) {
      ctx.strokeStyle = '#ffd54a';
      ctx.lineWidth = 3 * px;
      ctx.beginPath();
      drawing.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      if (hover) ctx.lineTo(hover.x, hover.y);
      ctx.stroke();
      drawing.forEach((q, i) => handle(q, i === 0 ? '#fff' : '#ffd54a'));
    }
  }

  for (const pr of problems) {
    if (!pr.at) continue;
    ctx.strokeStyle = '#ff4d3d';
    ctx.lineWidth = 4 * px;
    ctx.beginPath();
    ctx.arc(pr.at.x, pr.at.y, 26 * px * 2, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function polygon(pts: Vec2[], color: string, alpha = 1) {
  if (pts.length < 3) return;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
}

function handle(p: Vec2, color: string, text?: string) {
  const r = 7 / scale;
  ctx.fillStyle = color;
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 2 / scale;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r * (window.devicePixelRatio || 1), 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  if (text) label(text, p.x + 10 / scale, p.y - 10 / scale, '#fff');
}

function label(text: string, x: number, y: number, color: string) {
  const size = (12 * (window.devicePixelRatio || 1)) / scale;
  ctx.font = `600 ${size}px system-ui, sans-serif`;
  ctx.lineWidth = 3 / scale;
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

// ---- panel ----
function renderProblems() {
  const ul = $('#problems');
  ul.innerHTML = problems.length
    ? problems.map((p) => `<li>${p.message}</li>`).join('')
    : '<li class="ok">Ready to race.</li>';
  $<HTMLButtonElement>('#play').disabled = problems.length > 0;
}

function choiceRow(items: [string, string][], current: string, pick: (v: string) => void): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'choices';
  for (const [value, text] of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.classList.toggle('on', value === current);
    b.addEventListener('click', () => {
      pick(value);
      renderToolOptions();
    });
    row.append(b);
  }
  return row;
}

function renderToolOptions() {
  const box = $('#tool-options');
  box.innerHTML = '';
  if (tool === 'paint') {
    const names: Record<string, string> = { grass: 'Grass', sand: 'Sand', gravel: 'Gravel', snow: 'Snow', ice: 'Ice' };
    box.append(choiceRow(PATCH_SURFACES.map((k) => [k, names[k]]), paintSurface, (v) => (paintSurface = v as Surface)));
    const l = document.createElement('label');
    l.innerHTML = `<input type="checkbox" ${paintOverRoad ? 'checked' : ''} /> Paint over the road too`;
    l.querySelector('input')!.addEventListener('change', (e) => (paintOverRoad = (e.target as HTMLInputElement).checked));
    box.append(l);
  }
  if (tool === 'objects') {
    box.append(
      choiceRow(
        [
          ['tree', 'Tree'],
          ['tyres', 'Tyres'],
          ['cone', 'Cone'],
        ],
        objectKind,
        (v) => (objectKind = v as Obstacle['kind']),
      ),
    );
  }
  if (tool === 'river') {
    const list = def.rivers ?? [];
    const row = document.createElement('div');
    row.className = 'choices';
    list.forEach((_, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = `River ${i + 1}`;
      b.classList.toggle('on', i === riverIndex);
      b.addEventListener('click', () => {
        riverIndex = i;
        renderToolOptions();
        draw();
      });
      row.append(b);
    });
    const add = document.createElement('button');
    add.type = 'button';
    add.textContent = '+ New river';
    add.addEventListener('click', () => {
      riverIndex = list.length;
      renderToolOptions();
    });
    row.append(add);
    box.append(row);
    const r = list[riverIndex];
    if (r) {
      const w = document.createElement('label');
      w.className = 'row';
      w.innerHTML = `<span>River width</span><input type="range" min="12" max="70" value="${r.halfWidth}" />`;
      w.querySelector('input')!.addEventListener('change', (e) => {
        snapshot();
        r.halfWidth = Number((e.target as HTMLInputElement).value);
        changed();
      });
      box.append(w);
    }
  }
  $('#tool-help').textContent = HELP[tool];
  for (const b of document.querySelectorAll<HTMLButtonElement>('#tools button')) b.classList.toggle('on', b.dataset.tool === tool);
}

for (const b of document.querySelectorAll<HTMLButtonElement>('#tools button')) {
  b.addEventListener('click', () => {
    tool = b.dataset.tool as Tool;
    drawing = null;
    renderToolOptions();
    draw();
  });
}

function syncFields() {
  $<HTMLInputElement>('#name').value = def.name;
  $<HTMLInputElement>('#width').value = String(def.halfWidth);
  $('#width-val').textContent = String(def.halfWidth * 2);
  $<HTMLSelectElement>('#ground').value = def.ground ?? 'grass';
  $<HTMLSelectElement>('#size').value = mapSizeOf(def);
}

$<HTMLInputElement>('#name').addEventListener('change', (e) => {
  snapshot();
  def.name = (e.target as HTMLInputElement).value.trim().slice(0, 24) || 'My track';
  changed();
});
$<HTMLInputElement>('#width').addEventListener('input', (e) => {
  def.halfWidth = Number((e.target as HTMLInputElement).value);
  $('#width-val').textContent = String(def.halfWidth * 2);
  changed();
});
$<HTMLInputElement>('#width').addEventListener('pointerdown', snapshot);
$<HTMLSelectElement>('#size').addEventListener('change', (e) => {
  snapshot();
  // Stretch or shrink the design to the new map; the start and pits stay put.
  def = resizeTrack(def, (e.target as HTMLSelectElement).value as MapSize);
  changed();
  layout();
});
$<HTMLSelectElement>('#ground').addEventListener('change', (e) => {
  snapshot();
  def.ground = (e.target as HTMLSelectElement).value as Surface;
  changed();
});

function refreshList() {
  const sel = $<HTMLSelectElement>('#track-list');
  const saved = loadCustomTracks();
  sel.innerHTML =
    `<option value="">${saved.length ? 'Open a saved track…' : 'No saved tracks yet'}</option>` +
    saved.map((d) => `<option value="${d.id}"${d.id === def.id ? ' selected' : ''}>${escapeHtml(d.name)}</option>`).join('');
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function open(next: TrackDef) {
  def = finalizeTrack(structuredClone(next));
  history = [];
  dirty = false;
  riverIndex = 0;
  drawing = null;
  syncFields();
  changed(false);
  refreshList();
  layout();
}

function confirmDiscard(): boolean {
  return !dirty || window.confirm('Discard unsaved changes to this track?');
}

$<HTMLSelectElement>('#track-list').addEventListener('change', (e) => {
  const id = (e.target as HTMLSelectElement).value;
  const found = loadCustomTracks().find((d) => d.id === id);
  if (found && confirmDiscard()) open(found);
  else refreshList();
});

$('#new').addEventListener('click', () => {
  if (!confirmDiscard()) return;
  open(starterTrack(newId('Track'), 'My track', mapSizeOf(def)));
});
$('#undo').addEventListener('click', undo);
$('#delete').addEventListener('click', () => {
  if (!window.confirm(`Delete "${def.name}" from this browser?`)) return;
  deleteCustomTrack(def.id);
  open(starterTrack(newId('Track'), 'My track'));
});

function save(): boolean {
  saveCustomTrack(def);
  dirty = false;
  refreshList();
  $('#status').textContent = `Saved "${def.name}".`;
  return true;
}

$('#save').addEventListener('click', save);
$('#play').addEventListener('click', () => {
  if (problems.length) return;
  save();
  location.href = `/?track=${encodeURIComponent(def.id)}`;
});

$('#export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(def, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${def.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'track'}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$<HTMLInputElement>('#import').addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  (e.target as HTMLInputElement).value = '';
  if (!file || !confirmDiscard()) return;
  try {
    const raw = JSON.parse(await file.text());
    // A fresh id, so an import never overwrites a track already here.
    const parsed = parseTrackDef({ ...raw, id: newId(String(raw?.name ?? 'Imported')) });
    if (!parsed) throw new Error('not a track');
    open(parsed);
    dirty = true;
    $('#status').textContent = `Imported "${parsed.name}". Save to keep it.`;
  } catch {
    $('#status').textContent = 'That file is not a Grass & Grip track.';
  }
});

// ---- 3D view ----
let preview: Renderer3D | null = null;
let previewRaf = 0;
$('#preview').addEventListener('click', () => {
  registerTrack(def);
  const pane = $('#preview-pane');
  pane.hidden = false;
  if (!preview) preview = new Renderer3D($<HTMLCanvasElement>('#preview-canvas'), $<HTMLCanvasElement>('#preview-hud'), def.id);
  preview.keyHints = false;
  preview.cameraMode = 'overview';
  preview.setTrack(def.id, true);
  const state = createRace({ trackId: def.id, totalLaps: 1, cars: [], countdownSeconds: 0 });
  state.phase = 'racing';
  state.startTick = -1000;
  const frame = () => {
    preview!.render(state, state, 0, []);
    previewRaf = requestAnimationFrame(frame);
  };
  cancelAnimationFrame(previewRaf);
  frame();
});
$('#preview-close').addEventListener('click', () => {
  cancelAnimationFrame(previewRaf);
  $('#preview-pane').hidden = true;
});

window.addEventListener('beforeunload', (e) => {
  if (dirty) e.preventDefault();
});
window.addEventListener('resize', layout);

syncFields();
renderToolOptions();
refreshList();
changed(false);
layout();
