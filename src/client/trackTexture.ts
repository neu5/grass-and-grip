import { statsFor, type CarState, type GameState, type Track } from '../sim';

function tracePath(ctx: CanvasRenderingContext2D, track: Track) {
  ctx.beginPath();
  track.samples.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
}

/** Paints grass, asphalt, curbs and the finish line in world units times `res`. */
export function paintTrackSurface(track: Track, res: number): HTMLCanvasElement {
  const { width, height, halfWidth } = track.def;
  const c = document.createElement('canvas');
  c.width = width * res;
  c.height = height * res;
  const ctx = c.getContext('2d')!;
  ctx.scale(res, res);

  ctx.fillStyle = '#4a9a3f';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#52a546';
  for (let x = 0; x < width; x += 80) ctx.fillRect(x, 0, 40, height);

  paintPitLane(ctx, track);

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  tracePath(ctx, track);
  ctx.strokeStyle = '#f4f4f4';
  ctx.lineWidth = halfWidth * 2 + 18;
  ctx.stroke();
  ctx.setLineDash([22, 22]);
  ctx.strokeStyle = '#d0302a';
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = '#5d5f64';
  ctx.lineWidth = halfWidth * 2;
  ctx.stroke();

  ctx.setLineDash([24, 28]);
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.setLineDash([]);

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
  paintPitBoxes(ctx, track);
  return c;
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
