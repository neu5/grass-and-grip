import { CAR, getTrack, standings, ticksToTime, TICK_RATE, type CarState, type GameState, type Track } from '../sim';

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function tracePath(ctx: CanvasRenderingContext2D, track: Track) {
  ctx.beginPath();
  track.samples.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
}

function renderTrackLayer(track: Track): HTMLCanvasElement {
  const { width, height, halfWidth } = track.def;
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d')!;

  ctx.fillStyle = '#3f8a3a';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#46953f';
  for (let x = 0; x < width; x += 80) ctx.fillRect(x, 0, 40, height);

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

  ctx.strokeStyle = '#55575c';
  ctx.lineWidth = halfWidth * 2;
  ctx.stroke();

  ctx.setLineDash([24, 28]);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.setLineDash([]);

  const g = track.gates[0];
  const steps = 10;
  const rows = 2;
  const sq = 7;
  for (let i = 0; i < steps; i++) {
    for (let r = 0; r < rows; r++) {
      const t0 = 0.12 + (i / steps) * 0.76;
      const t1 = 0.12 + ((i + 1) / steps) * 0.76;
      ctx.fillStyle = (i + r) % 2 === 0 ? '#fff' : '#111';
      ctx.beginPath();
      const ax = g.a.x + (g.b.x - g.a.x) * t0 + g.tx * sq * (r - 1);
      const ay = g.a.y + (g.b.y - g.a.y) * t0 + g.ty * sq * (r - 1);
      const bx = g.a.x + (g.b.x - g.a.x) * t1 + g.tx * sq * (r - 1);
      const by = g.a.y + (g.b.y - g.a.y) * t1 + g.ty * sq * (r - 1);
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.lineTo(bx + g.tx * sq, by + g.ty * sq);
      ctx.lineTo(ax + g.tx * sq, ay + g.ty * sq);
      ctx.fill();
    }
  }

  for (const o of track.def.obstacles) {
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      ctx.arc(o.x, o.y, o.r - k * 5, 0, Math.PI * 2);
      ctx.fillStyle = k % 2 === 0 ? '#1d1d1f' : '#c8c8c8';
      ctx.fill();
    }
  }
  return c;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private track: Track;
  private trackLayer: HTMLCanvasElement;
  private skidLayer: HTMLCanvasElement;
  private skidCtx: CanvasRenderingContext2D;
  private lastSkid = new Map<number, { x: number; y: number }[]>();

  constructor(private canvas: HTMLCanvasElement, trackId: string) {
    this.ctx = canvas.getContext('2d')!;
    this.track = getTrack(trackId);
    this.trackLayer = renderTrackLayer(this.track);
    this.skidLayer = document.createElement('canvas');
    this.skidLayer.width = this.track.def.width;
    this.skidLayer.height = this.track.def.height;
    this.skidCtx = this.skidLayer.getContext('2d')!;
  }

  /** Called once per simulated tick to lay down skid marks. */
  onTick(state: GameState) {
    const ctx = this.skidCtx;
    for (const car of state.cars) {
      const sliding = car.slip > 95 || car.handbrake;
      const wheels = this.rearWheels(car);
      const prev = this.lastSkid.get(car.id);
      if (sliding && prev) {
        ctx.strokeStyle = car.onGrass ? 'rgba(60,40,20,0.22)' : 'rgba(20,20,20,0.28)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let i = 0; i < 2; i++) {
          ctx.moveTo(prev[i].x, prev[i].y);
          ctx.lineTo(wheels[i].x, wheels[i].y);
        }
        ctx.stroke();
      }
      if (sliding) this.lastSkid.set(car.id, wheels);
      else this.lastSkid.delete(car.id);
    }
  }

  private rearWheels(car: CarState) {
    const ca = Math.cos(car.angle);
    const sa = Math.sin(car.angle);
    const bx = car.x - ca * CAR.length * 0.32;
    const by = car.y - sa * CAR.length * 0.32;
    const w = CAR.width * 0.4;
    return [
      { x: bx - sa * w, y: by + ca * w },
      { x: bx + sa * w, y: by - ca * w },
    ];
  }

  render(prev: GameState, curr: GameState, alpha: number, humanIds: number[]) {
    const { canvas, ctx, track } = this;
    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#16301a';
    ctx.fillRect(0, 0, cw, ch);

    const scale = Math.min(cw / track.def.width, ch / track.def.height);
    const ox = (cw - track.def.width * scale) / 2;
    const oy = (ch - track.def.height * scale) / 2;
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);
    ctx.drawImage(this.trackLayer, 0, 0);
    ctx.drawImage(this.skidLayer, 0, 0);

    for (let i = 0; i < curr.cars.length; i++) {
      const a = prev.cars[i];
      const b = curr.cars[i];
      this.drawCar(b, a.x + (b.x - a.x) * alpha, a.y + (b.y - a.y) * alpha, lerpAngle(a.angle, b.angle, alpha), humanIds.includes(b.id));
    }
    ctx.restore();

    this.drawHud(curr, humanIds, cw, ch, alpha);
  }

  private drawCar(car: CarState, x: number, y: number, angle: number, isHuman: boolean) {
    const ctx = this.ctx;
    const L = CAR.length;
    const W = CAR.width;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(-L / 2 + 2, -W / 2 + 3, L, W);
    ctx.fillStyle = '#111';
    for (const [wx, wy] of [
      [-L * 0.32, -W / 2 - 1],
      [-L * 0.32, W / 2 - 3],
      [L * 0.28, -W / 2 - 1],
      [L * 0.28, W / 2 - 3],
    ]) {
      ctx.fillRect(wx - 4, wy, 8, 4);
    }
    ctx.fillStyle = car.color;
    ctx.beginPath();
    ctx.roundRect(-L / 2, -W / 2, L, W, 4);
    ctx.fill();
    ctx.fillStyle = 'rgba(20,30,45,0.85)';
    ctx.fillRect(L * 0.02, -W / 2 + 2.5, L * 0.2, W - 5);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillRect(-L / 2 + 2, -1.5, L - 6, 3);
    ctx.restore();

    if (isHuman) {
      ctx.save();
      ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.strokeText(car.name, x, y - 22);
      ctx.fillStyle = '#fff';
      ctx.fillText(car.name, x, y - 22);
      ctx.restore();
    }
  }

  private drawHud(state: GameState, humanIds: number[], cw: number, ch: number, alpha: number) {
    const ctx = this.ctx;
    const order = standings(state);
    const tickNow = state.tick + alpha;

    ctx.save();
    ctx.font = '600 14px ui-monospace, SFMono-Regular, Menlo, monospace';
    const panelW = 230;
    humanIds.forEach((id, k) => {
      const car = state.cars[id];
      const pos = order.findIndex((c) => c.id === id) + 1;
      const x = k === 0 ? 12 : cw - panelW - 12;
      const y = 12;
      ctx.fillStyle = 'rgba(10,14,20,0.72)';
      ctx.beginPath();
      ctx.roundRect(x, y, panelW, 112, 10);
      ctx.fill();
      ctx.fillStyle = car.color;
      ctx.fillRect(x, y + 10, 4, 92);
      ctx.fillStyle = '#fff';
      ctx.font = '700 16px system-ui, sans-serif';
      ctx.fillText(`${car.name}`, x + 14, y + 26);
      ctx.textAlign = 'right';
      ctx.fillText(`P${pos}/${state.cars.length}`, x + panelW - 12, y + 26);
      ctx.textAlign = 'left';
      ctx.font = '500 13px ui-monospace, SFMono-Regular, Menlo, monospace';
      const lap = Math.min(car.lapsCompleted + 1, state.totalLaps);
      const running = car.finishTick !== null ? 0 : Math.max(0, tickNow - car.lapStartTick);
      const rows: [string, string][] = [
        ['Lap', car.finishTick !== null ? 'FINISHED' : `${lap} / ${state.totalLaps}`],
        ['Time', state.phase === 'countdown' ? '0:00.000' : ticksToTime(running)],
        ['Last', car.lastLapTicks !== null ? ticksToTime(car.lastLapTicks) : '–'],
        ['Best', car.bestLapTicks !== null ? ticksToTime(car.bestLapTicks) : '–'],
      ];
      rows.forEach(([label, value], i) => {
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.fillText(label, x + 14, y + 48 + i * 17);
        ctx.fillStyle = label === 'Best' ? '#ffd54a' : '#fff';
        ctx.fillText(value, x + 70, y + 48 + i * 17);
      });
    });

    const boardX = humanIds.length > 1 ? cw / 2 - 90 : cw - 192;
    const boardH = 30 + order.length * 18;
    ctx.fillStyle = 'rgba(10,14,20,0.6)';
    ctx.beginPath();
    ctx.roundRect(boardX, 12, 180, boardH, 10);
    ctx.fill();
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('STANDINGS', boardX + 12, 32);
    order.forEach((c, i) => {
      ctx.fillStyle = c.color;
      ctx.fillRect(boardX + 12, 42 + i * 18, 10, 10);
      ctx.fillStyle = '#fff';
      ctx.fillText(`${i + 1}. ${c.name}`, boardX + 30, 51 + i * 18);
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText(c.finishTick !== null ? 'FIN' : `L${Math.min(c.lapsCompleted + 1, state.totalLaps)}`, boardX + 168, 51 + i * 18);
      ctx.textAlign = 'left';
    });

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (state.phase === 'countdown') {
      const remaining = Math.ceil((state.startTick - state.tick) / TICK_RATE);
      this.bigText(String(remaining), cw / 2, ch / 2);
    } else if (state.tick - state.startTick < TICK_RATE * 0.8) {
      this.bigText('GO!', cw / 2, ch / 2);
    } else if (state.phase === 'finished') {
      const winner = order[0];
      this.bigText(`${winner.name} wins!`, cw / 2, ch / 2 - 20);
      ctx.font = '600 18px system-ui, sans-serif';
      ctx.fillStyle = '#fff';
      ctx.fillText('Press R to race again · Esc for menu', cw / 2, ch / 2 + 36);
    }
    ctx.restore();
  }

  private bigText(text: string, x: number, y: number) {
    const ctx = this.ctx;
    ctx.font = '800 72px system-ui, sans-serif';
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = '#fff';
    ctx.fillText(text, x, y);
  }
}
