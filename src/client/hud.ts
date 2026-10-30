import { CAR_KIND_SHORT, DEFAULT_RULES, getTrack, newTrackRecord, raceProgress, standings, ticksToTime, TICK_RATE, toCarKind, type CarState, type GameState } from '../sim';
import { cameraHudHint } from './touchMap';

export interface Label {
  text: string;
  x: number;
  y: number;
  /** Screen direction to a checkpoint this car drove past, if any. */
  missed?: { dx: number; dy: number };
}

/** How long the FINAL LAP banner stays up after crossing the line. */
export const FINAL_LAP_SECONDS = 2.5;

/** True while this car is on the last lap of a race longer than one lap. */
export function onFinalLap(state: GameState, car: CarState): boolean {
  return state.totalLaps > 1 && car.finishTick === null && car.lapsCompleted === state.totalLaps - 1;
}

/** Humans who started their last lap within the last `FINAL_LAP_SECONDS`, with the banner's remaining seconds. */
export function finalLapBanners(state: GameState, humanIds: number[], tickNow: number): { car: CarState; left: number }[] {
  if (state.phase !== 'racing') return [];
  return humanIds
    .map((id) => state.cars[id])
    .filter((car) => car && onFinalLap(state, car))
    .map((car) => ({ car, left: FINAL_LAP_SECONDS - (tickNow - car.lapStartTick) / TICK_RATE }))
    .filter((b) => b.left > 0);
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
  const panelH = 154 + bars.length * 17;
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
    const last = lapColour(car, state);
    const near = intervals(state, order, id);
    const final = onFinalLap(state, car);
    const rows: [string, string, string, string?][] = [
      ['Lap', car.finishTick !== null ? 'FINISHED' : `${lap} / ${state.totalLaps}${final ? '  FINAL' : ''}`, final ? '#ffd54a' : '#fff'],
      ['Time', state.phase === 'countdown' ? '0:00.000' : ticksToTime(running), '#fff'],
      ['Last', car.lastLapTicks !== null ? ticksToTime(car.lastLapTicks) : '–', last.color, last.delta],
      ['Best', car.bestLapTicks !== null ? ticksToTime(car.bestLapTicks) : '–', bestColour(car, state)],
      ['Ahead', near.ahead, '#fff'],
      ['Behind', near.behind, '#fff'],
    ];
    rows.forEach(([label, value, color, extra], i) => {
      const ry = y + 48 + i * 17;
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillText(label, x + 14, ry);
      ctx.fillStyle = color;
      ctx.fillText(fit(ctx, value, panelW - 82), x + 70, ry);
      if (extra) {
        ctx.fillStyle = YELLOW;
        ctx.fillText(extra, x + 78 + ctx.measureText(value).width, ry);
      }
    });
    const tyreLeft = 1 - Math.min(1, Math.max(0, car.tyreWear ?? 0));
    const fuelLeft = Math.min(1, Math.max(0, car.fuel ?? 1));
    const bodyLeft = 1 - Math.min(1, Math.max(0, car.damage ?? 0));
    const left = { Tyres: tyreLeft, Fuel: fuelLeft, Damage: bodyLeft };
    bars.forEach((label, i) => drawRemainBar(ctx, label, left[label], x, y + 48 + (6 + i) * 17, panelW));
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
  }
  // Crossing the line onto the last lap.
  const banners = finalLapBanners(state, humanIds, tickNow);
  banners.forEach(({ car, left }, i) => {
    ctx.save();
    ctx.globalAlpha = Math.min(1, left / 0.5);
    const size = compact ? 34 : 52;
    const y = ch * 0.28 + i * (size + 14);
    bigText(ctx, humanIds.length > 1 ? `FINAL LAP — ${car.name}` : 'FINAL LAP', cw / 2, y, size, '#ffd54a');
    ctx.restore();
  });
  if (state.phase === 'finished') {
    ctx.font = `600 ${compact ? 14 : 18}px system-ui, sans-serif`;
    ctx.fillStyle = '#fff';
    ctx.fillText(finishHint, cw / 2, ch / 2 + 36);
  }
  ctx.restore();
}

function drawFastestBoard(ctx: CanvasRenderingContext2D, state: GameState, x: number, y: number) {
  const laps = state.fastestLaps ?? [];
  const rowH = 18;
  const h = 30 + 3 * rowH + 26;
  ctx.fillStyle = 'rgba(10,14,20,0.6)';
  ctx.beginPath();
  ctx.roundRect(x, y, 248, h, 10);
  ctx.fill();
  ctx.font = '600 12px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.textAlign = 'left';
  ctx.fillText('FASTEST THIS RACE', x + 12, y + 20);
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

  // All-time track record under the race's own times.
  const ry = y + 38 + 3 * rowH + 8;
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(x + 12, ry - 17, 224, 1);
  const fresh = newTrackRecord(state);
  const rec = fresh ?? state.trackRecord;
  ctx.fillStyle = fresh ? '#ffd54a' : RECORD_COLOR;
  ctx.fillText(fresh ? 'NEW RECORD' : 'RECORD', x + 12, ry);
  if (rec) {
    ctx.fillStyle = '#fff';
    ctx.fillText(fit(ctx, rec.name, 72), x + 100, ry);
    ctx.textAlign = 'right';
    ctx.fillStyle = fresh ? '#ffd54a' : RECORD_COLOR;
    ctx.fillText(ticksToTime(rec.ticks), x + 236, ry);
    ctx.textAlign = 'left';
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillText('–', x + 100, ry);
  }
}

const RECORD_COLOR = '#c9a0ff';

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

const PURPLE = '#b36cff';
const GREEN = '#6ee07a';
const YELLOW = '#ffd54a';
const DIM = 'rgba(255,255,255,0.6)';

/** Seconds like F1 timing: "1.234", or "1:02.345" past a minute. */
function secs(ticks: number): string {
  const s = Math.abs(ticks) / TICK_RATE;
  return s < 60 ? s.toFixed(3) : `${Math.floor(s / 60)}:${(s % 60).toFixed(3).padStart(6, '0')}`;
}

function lapsText(n: number): string {
  return `+${n} LAP${n > 1 ? 'S' : ''}`;
}

/**
 * Standings time for a car, like a TV timing tower: "Leader" for P1, the
 * gap to the leader at the last checkpoint ("+1.234"), "+1 LAP" once lapped,
 * "–" before the first checkpoint.
 */
export function gapCell(c: CarState, order: CarState[], state: GameState): { text: string; color: string } {
  const leader = order[0];
  if (c === leader) return { text: 'Leader', color: DIM };
  const g = getTrack(state.trackId).gates.length;
  const down = raceProgress(leader, g) - raceProgress(c, g);
  if (down >= g) return { text: lapsText(Math.floor(down / g)), color: '#fff' };
  if (c.gapTicks == null) return { text: '–', color: DIM };
  return { text: `+${secs(c.gapTicks)}`, color: '#fff' };
}

/**
 * Time to the car ahead and from the car behind, at the last checkpoint both
 * crossed: "+0.812 Rosa" (we are that far behind), "−1.204 Kenji".
 */
export function intervals(state: GameState, order: CarState[], id: number): { ahead: string; behind: string } {
  const g = getTrack(state.trackId).gates.length;
  const at = order.findIndex((c) => c.id === id);
  const me = order[at];
  const gap = (front: CarState, back: CarState, sign: string) => {
    const down = raceProgress(front, g) - raceProgress(back, g);
    if (down >= g) return `${lapsText(Math.floor(down / g)).replace('+', sign)} ${front === me ? back.name : front.name}`;
    const gate = (back.nextCheckpoint - 1 + g) % g;
    const tf = front.gateTicks?.[gate] ?? -1;
    const tb = back.gateTicks?.[gate] ?? -1;
    const other = front === me ? back.name : front.name;
    return tf < 0 || tb < 0 ? `– ${other}` : `${sign}${secs(tb - tf)} ${other}`;
  };
  return {
    ahead: at > 0 ? gap(order[at - 1], me, '+') : '–',
    behind: at >= 0 && at < order.length - 1 ? gap(me, order[at + 1], '−') : '–',
  };
}

/**
 * Last lap colour like F1 timing: purple for the fastest lap of the race,
 * green for a personal best, yellow otherwise, with how far off the best it was.
 */
export function lapColour(car: CarState, state: GameState): { color: string; delta?: string } {
  const last = car.lastLapTicks;
  if (last === null) return { color: '#fff' };
  const fastest = state.fastestLaps?.[0];
  if (fastest && fastest.ticks === last && fastest.name === car.name) return { color: PURPLE };
  if (last === car.bestLapTicks) return { color: GREEN };
  return { color: YELLOW, delta: car.bestLapTicks !== null ? `+${secs(last - car.bestLapTicks)}` : undefined };
}

/** Best lap: purple while it is the fastest of the race. */
export function bestColour(car: CarState, state: GameState): string {
  const fastest = state.fastestLaps?.[0];
  return fastest && car.bestLapTicks !== null && fastest.ticks === car.bestLapTicks && fastest.name === car.name ? PURPLE : '#fff';
}

/** Header of the timing tower: the leader's lap, or FINISH once the flag is out. */
function raceLapText(order: CarState[], state: GameState): string {
  const leader = order[0];
  if (!leader) return '';
  if (leader.finishTick !== null) return 'FINISH';
  return `LAP ${Math.min(leader.lapsCompleted + 1, state.totalLaps)}/${state.totalLaps}`;
}

/**
 * Desktop standings (gap to the leader per car, plus tyre, fuel and body
 * when the race shows car details) and the fastest-laps board.
 */
function drawBoards(ctx: CanvasRenderingContext2D, state: GameState, humanIds: number[], order: CarState[], cw: number) {
  const details = !!(state.rules ?? DEFAULT_RULES).carDetails;
  const boardW = details ? 360 : 248;
  const boardX = humanIds.length > 1 ? cw / 2 - boardW / 2 : cw - boardW - 12;
  ctx.fillStyle = 'rgba(10,14,20,0.6)';
  ctx.beginPath();
  ctx.roundRect(boardX, 12, boardW, 30 + order.length * 18, 10);
  ctx.fill();
  ctx.font = '600 12px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText('STANDINGS', boardX + 12, 32);
  ctx.textAlign = 'right';
  ctx.fillText(raceLapText(order, state), boardX + boardW - 12, 32);
  ctx.textAlign = 'left';
  order.forEach((c, i) => {
    const y = 51 + i * 18;
    ctx.fillStyle = c.color;
    ctx.fillRect(boardX + 12, y - 9, 10, 10);
    ctx.fillStyle = humanIds.includes(c.id) ? '#ffd54a' : '#fff';
    ctx.fillText(fit(ctx, `${i + 1}. ${c.name}`, details ? 92 : 130), boardX + 30, y);
    ctx.textAlign = 'right';
    if (details) {
      const wearPct = Math.round((1 - Math.min(1, Math.max(0, c.tyreWear ?? 0))) * 100);
      const fuelPct = Math.round(Math.min(1, Math.max(0, c.fuel ?? 1)) * 100);
      const bodyPct = Math.round((1 - Math.min(1, Math.max(0, c.damage ?? 0))) * 100);
      ctx.fillStyle = wearPct > 60 ? '#6ee07a' : wearPct > 30 ? '#ffd54a' : '#ff6b4a';
      ctx.fillText(`${wearPct}%`, boardX + 164, y);
      ctx.fillStyle = fuelPct > 60 ? '#6ee07a' : fuelPct > 30 ? '#ffd54a' : '#ff6b4a';
      ctx.fillText(`${fuelPct}%`, boardX + 204, y);
      ctx.fillStyle = bodyPct > 60 ? '#6ee07a' : bodyPct > 30 ? '#ffd54a' : '#ff6b4a';
      ctx.fillText(`${bodyPct}%`, boardX + 244, y);
    }
    const gap = gapCell(c, order, state);
    ctx.fillStyle = gap.color;
    ctx.fillText(gap.text, boardX + boardW - 12, y);
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
 * tyre/fuel/body bars) and a slim standings list with names, gaps and laps.
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
    const final = onFinalLap(state, car);
    ctx.fillStyle = final ? '#ffd54a' : '#fff';
    ctx.fillText(car.finishTick !== null ? 'FINISHED' : final ? 'FINAL LAP' : `Lap ${lap}/${state.totalLaps}`, x + 10, y + 34);
    ctx.fillStyle = '#fff';
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

  const bw = 190;
  const row = 14;
  const bx = humanIds.length > 1 ? cw / 2 - bw / 2 : cw - bw - 8;
  ctx.fillStyle = 'rgba(10,14,20,0.55)';
  ctx.beginPath();
  ctx.roundRect(bx, 8, bw, 8 + (order.length + 2) * row + 4, 8);
  ctx.fill();
  ctx.font = '600 11px system-ui, sans-serif';
  order.forEach((c, i) => {
    const ry = 8 + 4 + i * row;
    ctx.fillStyle = c.color;
    ctx.fillRect(bx + 8, ry + 3, 8, 8);
    ctx.fillStyle = humanIds.includes(c.id) ? '#ffd54a' : '#fff';
    ctx.fillText(fit(ctx, `${i + 1}. ${c.name}`, bw - 100), bx + 21, ry + 11);
    ctx.textAlign = 'right';
    const gap = gapCell(c, order, state);
    ctx.fillStyle = gap.color;
    ctx.fillText(gap.text, bx + bw - 8, ry + 11);
    ctx.textAlign = 'left';
  });

  // Race fastest lap and the all-time record.
  const best = state.fastestLaps?.[0];
  const fresh = newTrackRecord(state);
  const rec = fresh ?? state.trackRecord;
  const lines: [string, string, string][] = [
    ['FL', best ? `${best.name}` : '–', best ? ticksToTime(best.ticks) : ''],
    [fresh ? 'NEW' : 'REC', rec ? rec.name : '–', rec ? ticksToTime(rec.ticks) : ''],
  ];
  lines.forEach(([tag, name, time], i) => {
    const ry = 8 + 8 + (order.length + i) * row;
    const color = i === 0 ? '#ffd54a' : fresh ? '#ffd54a' : RECORD_COLOR;
    ctx.font = '700 9px system-ui, sans-serif';
    ctx.fillStyle = color;
    ctx.fillText(tag, bx + 8, ry + 11);
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(fit(ctx, name, bw - 96), bx + 32, ry + 11);
    ctx.textAlign = 'right';
    ctx.fillStyle = color;
    ctx.fillText(time, bx + bw - 8, ry + 11);
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

function bigText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size = 72, color = '#fff') {
  ctx.font = `800 ${size}px system-ui, sans-serif`;
  ctx.lineWidth = 8;
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}
