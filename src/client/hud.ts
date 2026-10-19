import { standings, ticksToTime, TICK_RATE, type GameState } from '../sim';

export interface Label {
  text: string;
  x: number;
  y: number;
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
  }
  ctx.textAlign = 'left';

  const panelW = 230;
  humanIds.forEach((id, k) => {
    const car = state.cars[id];
    const pos = order.findIndex((c) => c.id === id) + 1;
    const x = k === 0 ? 12 : cw - panelW - 12;
    const y = 12;
    ctx.fillStyle = 'rgba(10,14,20,0.72)';
    ctx.beginPath();
    ctx.roundRect(x, y, panelW, 136, 10);
    ctx.fill();
    ctx.fillStyle = car.color;
    ctx.fillRect(x, y + 10, 4, 116);
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
    const wear = Math.min(1, Math.max(0, car.tyreWear ?? 0));
    const pct = Math.round(wear * 100);
    const barX = x + 70;
    const barY = y + 48 + 4 * 17 - 10;
    const barW = 90;
    const barH = 10;
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('Tyres', x + 14, y + 48 + 4 * 17);
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = wear < 0.4 ? '#6ee07a' : wear < 0.7 ? '#ffd54a' : '#ff6b4a';
    ctx.fillRect(barX, barY, barW * wear, barH);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#fff';
    ctx.fillText(`${pct}%`, x + panelW - 12, y + 48 + 4 * 17);
    ctx.textAlign = 'left';
  });

  const boardX = humanIds.length > 1 ? cw / 2 - 105 : cw - 222;
  ctx.fillStyle = 'rgba(10,14,20,0.6)';
  ctx.beginPath();
  ctx.roundRect(boardX, 12, 210, 30 + order.length * 18, 10);
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
    const wearPct = Math.round(Math.min(1, Math.max(0, c.tyreWear ?? 0)) * 100);
    ctx.fillStyle = wearPct < 40 ? '#6ee07a' : wearPct < 70 ? '#ffd54a' : '#ff6b4a';
    ctx.fillText(`${wearPct}%`, boardX + 158, 51 + i * 18);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText(c.finishTick !== null ? 'FIN' : `L${Math.min(c.lapsCompleted + 1, state.totalLaps)}`, boardX + 198, 51 + i * 18);
    ctx.textAlign = 'left';
  });

  ctx.font = '500 12px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.textAlign = 'right';
  ctx.fillText(`Camera: ${cameraName} (C to switch)`, cw - 12, ch - 12);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (state.phase === 'countdown') {
    bigText(ctx, String(Math.ceil((state.startTick - state.tick) / TICK_RATE)), cw / 2, ch / 2);
  } else if (state.tick - state.startTick < TICK_RATE * 0.8) {
    bigText(ctx, 'GO!', cw / 2, ch / 2);
  } else if (state.phase === 'finished') {
    bigText(ctx, `${order[0].name} wins!`, cw / 2, ch / 2 - 20);
    ctx.font = '600 18px system-ui, sans-serif';
    ctx.fillStyle = '#fff';
    ctx.fillText(finishHint, cw / 2, ch / 2 + 36);
  }
  ctx.restore();
}

function bigText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number) {
  ctx.font = '800 72px system-ui, sans-serif';
  ctx.lineWidth = 8;
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = '#fff';
  ctx.fillText(text, x, y);
}
