export interface NetDebugInfo {
  pingMs: number;
  snapHz: number;
  seq: number;
  ack: number;
  queued: number;
  predictedTick: number;
  serverTick: number;
}

export function drawNetDebug(ctx: CanvasRenderingContext2D, info: NetDebugInfo, h: number): void {
  const ping = info.pingMs < 0 ? '–' : `${Math.round(info.pingMs)} ms`;
  const lines = [
    `ping  ${ping}`,
    `snap  ${info.snapHz.toFixed(0)} Hz`,
    `seq   ${info.seq}  ack ${info.ack}  q ${info.queued}`,
    `tick  pred ${info.predictedTick}  srv ${info.serverTick}`,
  ];
  const boxW = 232;
  const boxH = 18 + lines.length * 16;
  const x = 12;
  const y = h - boxH - 12;
  ctx.save();
  ctx.fillStyle = 'rgba(8, 12, 16, 0.78)';
  ctx.beginPath();
  ctx.roundRect(x, y, boxW, boxH, 8);
  ctx.fill();
  ctx.font = '600 12px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#7dffb3';
  ctx.fillText('NET  F3', x + 10, y + 8);
  ctx.fillStyle = '#e8fff2';
  lines.forEach((line, i) => ctx.fillText(line, x + 10, y + 24 + i * 16));
  ctx.restore();
}
