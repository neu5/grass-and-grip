// All sim types are plain JSON-serializable data so state snapshots and
// per-tick inputs can be sent over the network unchanged.

/** One car's controls for one tick. */
export interface PlayerInput {
  /** -1 (brake/reverse) .. 1 (full throttle) */
  throttle: number;
  /** -1 (left) .. 1 (right) */
  steer: number;
  handbrake: boolean;
}

/** Inputs for one tick, keyed by car id. Missing entries mean "no input". */
export type TickInputs = Record<number, PlayerInput>;

export type Controller = 'human' | 'ai';

export type CarKind = 'rally' | 'f1';

/** One completed lap on the fastest-laps board. */
export interface FastestLap {
  name: string;
  ticks: number;
  trackId: string;
  car: CarKind;
  color: string;
}

export const CAR_KINDS = ['rally', 'f1'] as const;

export const CAR_KIND_NAMES: Record<CarKind, string> = {
  rally: 'Rally',
  f1: 'Formula 1',
};

export type Phase = 'countdown' | 'racing' | 'finished';

export type AiPitPhase = 'race' | 'enter' | 'hold' | 'box' | 'exit';

export interface AiMemory {
  laneOffset: number;
  skill: number;
  stuckTicks: number;
  reverseTicks: number;
  /** Pit-stop state machine. `race` means follow the racing line. */
  pitPhase: AiPitPhase;
  /** Reserved stall index, or -1. */
  pitBox: number;
}

export interface CarState {
  id: number;
  name: string;
  color: string;
  kind: CarKind;
  controller: Controller;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  /** Lateral slip speed this tick, for skid marks / audio. */
  slip: number;
  /** 0 = fresh, 1 = fully worn. Starts at 0; pit boxes restore it. */
  tyreWear: number;
  /** Remaining fuel 0–1 (1 = 100%). Starts full; pit boxes refill it. */
  fuel: number;
  /** 0 = fine, 1 = wrecked. Hits raise it; pit boxes repair it. */
  damage: number;
  onGrass: boolean;
  handbrake: boolean;
  lapsCompleted: number;
  nextCheckpoint: number;
  lapStartTick: number;
  lastLapTicks: number | null;
  bestLapTicks: number | null;
  finishTick: number | null;
  ai: AiMemory | null;
}

export interface GameState {
  tick: number;
  trackId: string;
  phase: Phase;
  /** Tick at which the countdown ends and cars may drive. */
  startTick: number;
  totalLaps: number;
  cars: CarState[];
  /** Fastest-first top 3 laps for this track (includes earlier races when seeded). */
  fastestLaps: FastestLap[];
}

export interface CarConfig {
  name: string;
  color: string;
  controller: Controller;
  /** Defaults to rally. */
  kind?: CarKind;
}

export interface RaceConfig {
  trackId: string;
  totalLaps: number;
  cars: CarConfig[];
  countdownSeconds?: number;
  /** Seed the HUD / room board (e.g. persisted top 3). */
  fastestLaps?: FastestLap[];
}
