import { createRace, step } from './sim';
import type { GameState, RaceConfig, TickInputs } from './types';

/** Trace one row per car this often (ticks). */
export const TRACE_EVERY = 30;

/**
 * A whole race, enough to play it back tick by tick: the setup, every tick's
 * human inputs (the AI's come from the sim itself) and a coarse trace of each
 * car, which also checks that a replay stays in step.
 */
export interface RaceLog {
  version: 1;
  savedAt: string;
  config: RaceConfig;
  /** Human inputs, run-length coded: [ticks, inputs] pairs. */
  inputs: [number, TickInputs][];
  /** Every car's name, kind and who drove it, by car id. */
  cars: { name: string; kind: string; controller: string }[];
  /** [tick, car id, x, y, speed, wear %, fuel %, damage %, laps, next gate, pit phase]. */
  trace: (number | string)[][];
  ticks: number;
  finished: boolean;
}

/** One trace row per car, in the trace's column order. */
export function traceRows(state: GameState): (number | string)[][] {
  return state.cars.map((c) => [
    state.tick,
    c.id,
    Math.round(c.x),
    Math.round(c.y),
    Math.round(Math.hypot(c.vx, c.vy)),
    Math.round((c.tyreWear ?? 0) * 100),
    Math.round((c.fuel ?? 1) * 100),
    Math.round((c.damage ?? 0) * 100),
    c.lapsCompleted,
    c.nextCheckpoint,
    c.ai?.pitPhase ?? '',
  ]);
}

/** Builds a RaceLog as the race runs. */
export class RaceLogWriter {
  private log: RaceLog;
  private last = '';

  constructor(config: RaceConfig, start: GameState) {
    this.log = {
      version: 1,
      savedAt: new Date().toISOString(),
      config: structuredClone(config),
      inputs: [],
      cars: start.cars.map((c) => ({ name: c.name, kind: c.kind, controller: c.controller })),
      trace: [],
      ticks: 0,
      finished: false,
    };
  }

  /** After each tick, with the inputs that tick ran on. */
  record(state: GameState, inputs: TickInputs) {
    const key = JSON.stringify(inputs);
    const runs = this.log.inputs;
    if (key === this.last && runs.length) runs[runs.length - 1][0]++;
    else runs.push([1, JSON.parse(key)]);
    this.last = key;
    this.log.ticks++;
    this.log.finished = state.phase === 'finished';
    if (state.tick % TRACE_EVERY === 0) this.log.trace.push(...traceRows(state));
  }

  get ticks(): number {
    return this.log.ticks;
  }

  get value(): RaceLog {
    return this.log;
  }
}

/** Play a log back from the start, calling `each` after every tick. */
export function replayRace(log: RaceLog, each: (state: GameState) => void): GameState {
  let s = createRace(log.config);
  for (const [n, inputs] of log.inputs) {
    for (let i = 0; i < n; i++) {
      s = step(s, inputs);
      each(s);
    }
  }
  return s;
}
