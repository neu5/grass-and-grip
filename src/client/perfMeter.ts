const STORE_KEY = 'gg-perf-meter';
/** Frames slower than this count as a hitch (missed a 60 Hz frame). */
const HITCH_MS = 20;

interface Sample {
  at: number;
  /** Time since the frame before. */
  gap: number;
  /** Sim ticks run this frame, and the time they took. */
  steps: number;
  sim: number;
  /** Time spent in Renderer3D.render (scene + HUD, CPU side). */
  draw: number;
}

export interface PerfExtra {
  width: number;
  height: number;
  calls: number;
  triangles: number;
}

/**
 * FPS / frame-time meter, toggled with F. Keeps the last second of frames and
 * shows FPS, average and worst frame gap, hitches, sim and draw time.
 */
export class PerfMeter {
  on = readStored();
  private samples: Sample[] = [];
  private lastAt = 0;
  private pendingSim = 0;
  private pendingSteps = 0;

  toggle() {
    this.on = !this.on;
    this.samples = [];
    try {
      localStorage.setItem(STORE_KEY, this.on ? '1' : '0');
    } catch {
      // Private mode: the meter just won't be remembered.
    }
  }

  /** Sim time spent this frame, from the game loop. */
  addSim(ms: number, steps: number) {
    this.pendingSim += ms;
    this.pendingSteps += steps;
  }

  /** One rendered frame: `start` is when render began, `draw` how long it took. */
  frame(start: number, draw: number) {
    const gap = this.lastAt ? start - this.lastAt : 0;
    this.lastAt = start;
    if (!this.on) return;
    this.samples.push({ at: start, gap, steps: this.pendingSteps, sim: this.pendingSim, draw });
    this.pendingSim = 0;
    this.pendingSteps = 0;
    while (this.samples.length && start - this.samples[0].at > 1000) this.samples.shift();
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, extra: PerfExtra) {
    if (!this.on || this.samples.length < 2) return;
    const s = this.samples.slice(1);
    const avg = (f: (x: Sample) => number) => s.reduce((t, x) => t + f(x), 0) / s.length;
    const gap = avg((x) => x.gap);
    const worst = Math.max(...s.map((x) => x.gap));
    const hitches = s.filter((x) => x.gap > HITCH_MS).length;
    const lines = [
      `FPS ${(1000 / gap).toFixed(0)}   frame ${gap.toFixed(1)} ms   worst ${worst.toFixed(1)} ms   hitches ${hitches}/s`,
      `sim ${avg((x) => x.sim).toFixed(2)} ms (${avg((x) => x.steps).toFixed(2)} ticks)   draw ${avg((x) => x.draw).toFixed(2)} ms`,
      `${extra.width}×${extra.height} px   dpr ${(window.devicePixelRatio || 1).toFixed(2)}   calls ${extra.calls}   tris ${(extra.triangles / 1000).toFixed(0)}k`,
    ];
    ctx.save();
    ctx.font = '500 12px ui-monospace, SFMono-Regular, Menlo, monospace';
    const boxW = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 20;
    const boxH = 12 + lines.length * 16;
    const x = Math.round(w / 2 - boxW / 2);
    const y = h - boxH - 30;
    ctx.fillStyle = 'rgba(10,14,20,0.78)';
    ctx.beginPath();
    ctx.roundRect(x, y, boxW, boxH, 8);
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    lines.forEach((l, i) => {
      ctx.fillStyle = i === 0 && (gap > 18 || hitches > 2) ? '#ff6b4a' : '#fff';
      ctx.fillText(l, x + 10, y + 20 + i * 16);
    });
    ctx.restore();
  }
}

function readStored(): boolean {
  try {
    return localStorage.getItem(STORE_KEY) === '1' || new URLSearchParams(location.search).has('fps');
  } catch {
    return false;
  }
}
