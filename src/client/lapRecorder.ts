import { toCarKind, type CarKind, type GameState, type TickInputs } from '../sim';

/** Best human lap per track and car kind, for comparing with the AI (scripts/ai-report.ts). */
export const TELEMETRY_KEY = 'gg-lap-telemetry';
/** One point every this many ticks. */
const EVERY = 2;

export interface LapPoint {
  /** Ticks since the lap started. */
  t: number;
  x: number;
  y: number;
  /** Speed. */
  v: number;
  throttle: number;
  steer: number;
  handbrake: boolean;
}

export interface LapTelemetry {
  trackId: string;
  kind: CarKind;
  name: string;
  ticks: number;
  points: LapPoint[];
}

export function loadTelemetry(): LapTelemetry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(TELEMETRY_KEY) ?? '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function saveTelemetry(list: LapTelemetry[]) {
  try {
    localStorage.setItem(TELEMETRY_KEY, JSON.stringify(list));
  } catch {
    // Storage full or blocked: the lap just isn't kept.
  }
}

/** Keep `lap` if it beats the saved one for its track and kind. Returns the new list. */
export function keepBest(list: LapTelemetry[], lap: LapTelemetry): LapTelemetry[] {
  const old = list.find((l) => l.trackId === lap.trackId && l.kind === lap.kind);
  if (old && old.ticks <= lap.ticks) return list;
  return [...list.filter((l) => l !== old), lap];
}

/** Records each human car's laps and saves its best one per track and kind. */
export class LapRecorder {
  private points = new Map<number, LapPoint[]>();
  private laps = new Map<number, number>();

  reset() {
    this.points.clear();
    this.laps.clear();
  }

  /** After each tick, with the inputs that tick ran on. */
  record(state: GameState, inputs: TickInputs, humanIds: number[]) {
    if (state.phase !== 'racing') return;
    for (const id of humanIds) {
      const car = state.cars[id];
      if (!car) continue;
      const before = this.laps.get(id) ?? 0;
      if (car.lapsCompleted !== before) {
        this.laps.set(id, car.lapsCompleted);
        const pts = this.points.get(id) ?? [];
        this.points.set(id, []);
        // A full lap: from the line to the line, not from the grid.
        if (before > 0 && car.lastLapTicks !== null && pts.length > 10) {
          const lap = { trackId: state.trackId, kind: toCarKind(car.kind), name: car.name, ticks: car.lastLapTicks, points: pts };
          saveTelemetry(keepBest(loadTelemetry(), lap));
        }
      }
      if (car.finishTick !== null) continue;
      const t = state.tick - car.lapStartTick;
      if (t % EVERY !== 0) continue;
      const input = inputs[id];
      let pts = this.points.get(id);
      if (!pts) this.points.set(id, (pts = []));
      pts.push({
        t,
        x: Math.round(car.x * 10) / 10,
        y: Math.round(car.y * 10) / 10,
        v: Math.round(Math.hypot(car.vx, car.vy)),
        throttle: input?.throttle ?? 0,
        steer: Math.round((input?.steer ?? 0) * 100) / 100,
        handbrake: !!input?.handbrake,
      });
    }
  }
}

/** Save every recorded best lap as a JSON file. */
export function downloadTelemetry() {
  const blob = new Blob([JSON.stringify(loadTelemetry())], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'grass-and-grip-laps.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
