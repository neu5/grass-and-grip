import { CAR_KIND_SHORT, DEFAULT_RULES, standings, ticksToTime, TICK_RATE, toCarKind, type CarState, type GameState } from '../sim';
import { cameraHudHint } from './touchMap';

export interface Label {
  text: string;
  x: number;
  y: number;
  /** Screen direction to a checkpoint this car drove past, if any. */
  missed?: { dx: number; dy: number };
}

export function drawHud(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  humanIds: number[],
  cw: number,
  ch: number,
  alpha: number,
  labels: Label[],
  cameraName: string,
  finishHint: string,
  keyHints = true,
) {
  const order = standings(state);
  const tickNow = state.tick + alpha;
  ctx.save();

  ctx.font = 'bold 13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.lineWidth = 3;
  for (const l of labels) {
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeText(l.text, l.x, l.y);
    ctx.fillStyle = '#fff';
    ctx.fillText(l.text, l.x, l.y);
    if (l.missed) drawMissedGate(ctx, l);
  }
  ctx.textAlign = 'left';

  const rules = state.rules ?? DEFAULT_RULES;
  // Bars only for systems this race uses.
  const bars: ('Tyres' | 'Fuel' | 'Damage')[] = [];
  if (rules.tyreWear) bars.push('Tyres');
  if (rules.fuel) bars.push('Fuel');
  if (rules.damage) bars.push('Damage');
  // Short (phone) screens get small panels so the track stays visible.
  const compact = ch < 520;
  if (compact) {
    drawCompact(ctx, state, humanIds, order, bars, cw, tickNow);
  }
  const panelW = 230;
  const panelH = 120 + bars.length * 17;
  if (!compact) humanIds.forEach((id, k) => {
    const car = state.cars[id];
    const pos = order.findIndex((c) => c.id === id) + 1;
    const x = k === 0 ? 12 : cw - panelW - 12;
    const y = 12;
    ctx.fillStyle = 'rgba(10,14,20,0.72)';
    ctx.beginPath();
    ctx.roundRect(x, y, panelW, panelH, 10);
    ctx.fill();
    ctx.fillStyle = car.color;
    ctx.fillRect(x, y + 10, 4, panelH - 20);
    ctx.fillStyle = '#fff';
    ctx.font = '700 16px system-ui, sans-serif';
    ctx.fillText(car.name, x + 14, y + 26);
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
    const tyreLeft = 1 - Math.min(1, Math.max(0, car.tyreWear ?? 0));
    const fuelLeft = Math.min(1, Math.max(0, car.fuel ?? 1));
    const bodyLeft = 1 - Math.min(1, Math.max(0, car.damage ?? 0));
    const left = { Tyres: tyreLeft, Fuel: fuelLeft, Damage: bodyLeft };
    bars.forEach((label, i) => drawRemainBar(ctx, label, left[label], x, y + 48 + (4 + i) * 17, panelW));
  });

  if (!compact) drawBoards(ctx, state, humanIds, order, cw);

  ctx.font = '500 12px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.textAlign = keyHints ? 'right' : 'center';
  ctx.fillText(cameraHudHint(cameraName, keyHints), keyHints ? cw - 12 : cw / 2, ch - 12);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const big = compact ? 48 : 72;
  if (state.phase === 'countdown') {
    bigText(ctx, String(Math.ceil((state.startTick - state.tick) / TICK_RATE)), cw / 2, ch / 2, big);
  } else if (state.tick - state.startTick < TICK_RATE * 0.8) {
    bigText(ctx, 'GO!', cw / 2, ch / 2, big);
  } else if (state.phase === 'finished') {
    bigText(ctx, `${order[0].name} wins!`, cw / 2, ch / 2 - 20, big);
    ctx.font = `600 ${compact ? 14 : 18}px system-ui, sans-serif`;
    ctx.fillStyle = '#fff';
    ctx.fillText(finishHint, cw / 2, ch / 2 + 36);
  }
  ctx.restore();
}

function drawFastestBoard(ctx: CanvasRenderingContext2D, state: GameState, x: number, y: number) {
  const laps = state.fastestLaps ?? [];
  const rowH = 18;
  const h = 30 + 3 * rowH;
  ctx.fillStyle = 'rgba(10,14,20,0.6)';
  ctx.beginPath();
  ctx.roundRect(x, y, 248, h, 10);
  ctx.fill();
  ctx.font = '600 12px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.textAlign = 'left';
  ctx.fillText('FASTEST', x + 12, y + 20);
  for (let i = 0; i < 3; i++) {
    const e = laps[i];
    const rowY = y + 38 + i * rowH;
    if (!e) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillText(`${i + 1}. –`, x + 12, rowY);
      continue;
    }
    ctx.fillStyle = e.color || '#888';
    ctx.fillRect(x + 12, rowY - 9, 10, 10);
    ctx.fillStyle = i === 0 ? '#ffd54a' : '#fff';
    ctx.fillText(`${i + 1}. ${e.name}`, x + 30, rowY);
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText(CAR_KIND_SHORT[toCarKind(e.car)], x + 168, rowY);
    ctx.fillStyle = i === 0 ? '#ffd54a' : '#fff';
    ctx.fillText(ticksToTime(e.ticks), x + 236, rowY);
    ctx.textAlign = 'left';
  }
}

/** Pointer from the car label toward the checkpoint it skipped. */
function drawMissedGate(ctx: CanvasRenderingContext2D, l: Label) {
  const { dx, dy } = l.missed!;
  const cx = l.x + dx * 46;
  const cy = l.y - 20 + dy * 46;
  const a = Math.atan2(dy, dx);
  const blink = Math.floor(performance.now() / 300) % 2 === 0;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(a);
  ctx.beginPath();
  ctx.moveTo(16, 0);
  ctx.lineTo(-10, -11);
  ctx.lineTo(-4, 0);
  ctx.lineTo(-10, 11);
  ctx.closePath();
  ctx.fillStyle = blink ? '#ffd54a' : '#ff6b4a';
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fill();
  ctx.restore();
  ctx.font = 'bold 13px system-ui, sans-serif';
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.strokeText('Missed checkpoint — go back', l.x, l.y + 64);
  ctx.fillStyle = '#ffd54a';
  ctx.fillText('Missed checkpoint — go back', l.x, l.y + 64);
}

/** Desktop standings (with tyre, fuel and body per car) and the fastest-laps board. */
function drawBoards(ctx: CanvasRenderingContext2D, state: GameState, humanIds: number[], order: CarState[], cw: number) {
  const boardX = humanIds.length > 1 ? cw / 2 - 124 : cw - 260;
  ctx.fillStyle = 'rgba(10,14,20,0.6)';
  ctx.beginPath();
  ctx.roundRect(boardX, 12, 248, 30 + order.length * 18, 10);
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
    const wearPct = Math.round((1 - Math.min(1, Math.max(0, c.tyreWear ?? 0))) * 100);
    const fuelPct = Math.round(Math.min(1, Math.max(0, c.fuel ?? 1)) * 100);
    const bodyPct = Math.round((1 - Math.min(1, Math.max(0, c.damage ?? 0))) * 100);
    ctx.fillStyle = wearPct > 60 ? '#6ee07a' : wearPct > 30 ? '#ffd54a' : '#ff6b4a';
    ctx.fillText(`${wearPct}%`, boardX + 118, 51 + i * 18);
    ctx.fillStyle = fuelPct > 60 ? '#6ee07a' : fuelPct > 30 ? '#ffd54a' : '#ff6b4a';
    ctx.fillText(`${fuelPct}%`, boardX + 152, 51 + i * 18);
    ctx.fillStyle = bodyPct > 60 ? '#6ee07a' : bodyPct > 30 ? '#ffd54a' : '#ff6b4a';
    ctx.fillText(`${bodyPct}%`, boardX + 186, 51 + i * 18);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText(c.finishTick !== null ? 'FIN' : `L${Math.min(c.lapsCompleted + 1, state.totalLaps)}`, boardX + 236, 51 + i * 18);
    ctx.textAlign = 'left';
  });

  drawFastestBoard(ctx, state, boardX, 12 + 30 + order.length * 18 + 8);
}

/** Fit text into `max` px, ending in an ellipsis if it doesn't. */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

/**
 * Phone HUD: a small driver card (name, position, lap and time, best, thin
 * tyre/fuel/body bars) and a slim standings list with names and laps only.
 */
function drawCompact(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  humanIds: number[],
  order: CarState[],
  bars: ('Tyres' | 'Fuel' | 'Damage')[],
  cw: number,
  tickNow: number,
) {
  const w = 172;
  const h = 58 + (bars.length ? 14 : 0);
  humanIds.forEach((id, k) => {
    const car = state.cars[id];
    const pos = order.findIndex((c) => c.id === id) + 1;
    const x = k === 0 ? 8 : cw - w - 8;
    const y = 8;
    ctx.fillStyle = 'rgba(10,14,20,0.66)';
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 8);
    ctx.fill();
    ctx.fillStyle = car.color;
    ctx.fillRect(x, y + 8, 3, h - 16);
    ctx.font = '700 12px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillStyle = '#fff';
    const posText = `P${pos}/${state.cars.length}`;
    ctx.fillText(posText, x + w - 8, y + 17);
    const posW = ctx.measureText(posText).width;
    ctx.textAlign = 'left';
    ctx.fillText(fit(ctx, car.name, w - 26 - posW), x + 10, y + 17);
    ctx.font = '500 11px ui-monospace, SFMono-Regular, Menlo, monospace';
    const lap = Math.min(car.lapsCompleted + 1, state.totalLaps);
    const running = car.finishTick !== null ? 0 : Math.max(0, tickNow - car.lapStartTick);
    ctx.fillStyle = '#fff';
    ctx.fillText(car.finishTick !== null ? 'FINISHED' : `Lap ${lap}/${state.totalLaps}`, x + 10, y + 34);
    ctx.textAlign = 'right';
    ctx.fillText(state.phase === 'countdown' ? '0:00.000' : ticksToTime(running), x + w - 8, y + 34);
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('Best', x + 10, y + 50);
    ctx.fillStyle = '#ffd54a';
    ctx.textAlign = 'right';
    ctx.fillText(car.bestLapTicks !== null ? ticksToTime(car.bestLapTicks) : '–', x + w - 8, y + 50);
    ctx.textAlign = 'left';
    const left = {
      Tyres: 1 - Math.min(1, Math.max(0, car.tyreWear ?? 0)),
      Fuel: Math.min(1, Math.max(0, car.fuel ?? 1)),
      Damage: 1 - Math.min(1, Math.max(0, car.damage ?? 0)),
    };
    const slot = (w - 20) / Math.max(1, bars.length);
    bars.forEach((label, i) => {
      const bx = x + 10 + i * slot;
      ctx.font = '600 9px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillText(label[0], bx, y + 66);
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(bx + 9, y + 60, slot - 14, 5);
      ctx.fillStyle = remainColor(left[label]);
      ctx.fillRect(bx + 9, y + 60, (slot - 14) * left[label], 5);
    });
  });

  const bw = 148;
  const row = 14;
  const bx = humanIds.length > 1 ? cw / 2 - bw / 2 : cw - bw - 8;
  ctx.fillStyle = 'rgba(10,14,20,0.55)';
  ctx.beginPath();
  ctx.roundRect(bx, 8, bw, 8 + order.length * row, 8);
  ctx.fill();
  ctx.font = '600 11px system-ui, sans-serif';
  order.forEach((c, i) => {
    const ry = 8 + 4 + i * row;
    ctx.fillStyle = c.color;
    ctx.fillRect(bx + 8, ry + 3, 8, 8);
    ctx.fillStyle = humanIds.includes(c.id) ? '#ffd54a' : '#fff';
    ctx.fillText(fit(ctx, `${i + 1}. ${c.name}`, bw - 56), bx + 21, ry + 11);
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText(c.finishTick !== null ? 'FIN' : `L${Math.min(c.lapsCompleted + 1, state.totalLaps)}`, bx + bw - 8, ry + 11);
    ctx.textAlign = 'left';
  });
}

function remainColor(left: number): string {
  return left > 0.6 ? '#6ee07a' : left > 0.3 ? '#ffd54a' : '#ff6b4a';
}

function drawRemainBar(
  ctx: CanvasRenderingContext2D,
  label: string,
  left: number,
  x: number,
  rowY: number,
  panelW: number,
) {
  const pct = Math.round(left * 100);
  const barX = x + 70;
  const barY = rowY - 10;
  const barW = 90;
  const barH = 10;
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText(label, x + 14, rowY);
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.fillRect(barX, barY, barW, barH);
  ctx.fillStyle = remainColor(left);
  ctx.fillRect(barX, barY, barW * left, barH);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#fff';
  ctx.fillText(`${pct}%`, x + panelW - 12, rowY);
  ctx.textAlign = 'left';
}

function bigText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size = 72) {
  ctx.font = `800 ${size}px system-ui, sans-serif`;
  ctx.lineWidth = 8;
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = '#fff';
  ctx.fillText(text, x, y);
}
