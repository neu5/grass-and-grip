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

export type Phase = 'countdown' | 'racing' | 'finished';

export interface AiMemory {
  laneOffset: number;
  skill: number;
  stuckTicks: number;
  reverseTicks: number;
}

export interface CarState {
  id: number;
  name: string;
  color: string;
  controller: Controller;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  /** Lateral slip speed this tick, for skid marks / audio. */
  slip: number;
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
}

export interface CarConfig {
  name: string;
  color: string;
  controller: Controller;
}

export interface RaceConfig {
  trackId: string;
  totalLaps: number;
  cars: CarConfig[];
  countdownSeconds?: number;
}
