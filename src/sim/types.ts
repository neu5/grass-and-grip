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

export type CarKind = 'rally' | 'f1' | 'buggy' | 'truck' | 'kart';

/** One completed lap on the fastest-laps board. */
export interface FastestLap {
  name: string;
  ticks: number;
  trackId: string;
  car: CarKind;
  color: string;
}

export const CAR_KINDS = ['rally', 'f1', 'buggy', 'truck', 'kart'] as const;

export const CAR_KIND_NAMES: Record<CarKind, string> = {
  rally: 'Rally',
  f1: 'Formula 1',
  buggy: 'Buggy',
  truck: 'Truck',
  kart: 'Kart',
};

/** Short label for tight spots (HUD boards). */
export const CAR_KIND_SHORT: Record<CarKind, string> = {
  rally: 'Rally',
  f1: 'F1',
  buggy: 'Buggy',
  truck: 'Truck',
  kart: 'Kart',
};

export function parseCarKind(v: unknown): CarKind | null {
  return typeof v === 'string' && (CAR_KINDS as readonly string[]).includes(v) ? (v as CarKind) : null;
}

/** Any value to a car kind; unknown falls back to rally. */
export function toCarKind(v: unknown): CarKind {
  return parseCarKind(v) ?? 'rally';
}

/** Garage tweaks, each a step from -2 to 2. 0 is the stock car. */
export interface CarSetup {
  /** Short (+accel) .. long (+top speed). */
  gearing: number;
  /** Slow .. quick steering. */
  steering: number;
  /** Low drag .. high grip (more grip costs a little speed). */
  grip: number;
}

export const SETUP_MIN = -2;
export const SETUP_MAX = 2;
export const DEFAULT_SETUP: CarSetup = { gearing: 0, steering: 0, grip: 0 };

function setupStep(v: unknown): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 0;
  return Math.max(SETUP_MIN, Math.min(SETUP_MAX, n));
}

/** Any value to a valid setup; missing or bad fields become 0. */
export function normalizeSetup(v: unknown): CarSetup {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return { gearing: setupStep(o.gearing), steering: setupStep(o.steering), grip: setupStep(o.grip) };
}

/** 0 = off, 1 = normal, 2 = double. */
export type RuleRate = 0 | 1 | 2;

export interface RaceRules {
  damage: RuleRate;
  tyreWear: RuleRate;
  fuel: RuleRate;
  /** Car-to-car contact. Walls, trees and tyres always collide. */
  collisions: boolean;
  /** AI driving level, 0 (gentle) .. 100 (flat out). */
  aiLevel: number;
  /** Show every car's tyres, fuel and body in the standings, not just gaps. */
  carDetails?: boolean;
}

export const DEFAULT_RULES: RaceRules = { damage: 1, tyreWear: 1, fuel: 1, collisions: true, aiLevel: 70, carDetails: false };

function rate(v: unknown, fallback: RuleRate): RuleRate {
  const n = Number(v);
  return n === 0 || n === 1 || n === 2 ? n : fallback;
}

/** Any value to valid rules; missing or bad fields keep the default. */
export function normalizeRules(v: unknown): RaceRules {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const level = Math.round(Number(o.aiLevel));
  return {
    damage: rate(o.damage, DEFAULT_RULES.damage),
    tyreWear: rate(o.tyreWear, DEFAULT_RULES.tyreWear),
    fuel: rate(o.fuel, DEFAULT_RULES.fuel),
    collisions: typeof o.collisions === 'boolean' ? o.collisions : DEFAULT_RULES.collisions,
    aiLevel: Number.isFinite(level) ? Math.max(0, Math.min(100, level)) : DEFAULT_RULES.aiLevel,
    carDetails: typeof o.carDetails === 'boolean' ? o.carDetails : DEFAULT_RULES.carDetails,
  };
}

export type Phase = 'countdown' | 'racing' | 'finished';

export type AiPitPhase = 'race' | 'enter' | 'hold' | 'box' | 'exit';

export interface AiMemory {
  /** Lateral offset used while lining up for the pits (centerline driving). */
  laneOffset: number;
  /** Driving level 0..1 (from the race's AI level plus a small per-car spread). */
  skill: number;
  stuckTicks: number;
  reverseTicks: number;
  /** Pit-stop state machine. `race` means follow the racing line. */
  pitPhase: AiPitPhase;
  /** Reserved stall index, or -1. */
  pitBox: number;
  /** Current sideways shift off the racing line, for passing (smoothed). */
  passOffset?: number;
  /** Gate the car drove past without crossing, or -1. */
  recoverGate?: number;
  /** 0 = heading back before the gate, 1 = driving through it again. */
  recoverStage?: number;
  /** Ticks left of a late-braking mistake. */
  mistakeTicks?: number;
  /** Steering held while reversing out (-1 / 1), so the car turns one way. */
  reverseSteer?: number;
  /** Times stuck in a row; each reverse lasts longer. */
  stuckCount?: number;
}

export interface CarState {
  id: number;
  name: string;
  color: string;
  kind: CarKind;
  /** Garage setup. Missing means stock. */
  setup?: CarSetup;
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
  /** On a flyover's deck (or its ramps) rather than the road below. Missing means no. */
  onDeck?: boolean;
  handbrake: boolean;
  lapsCompleted: number;
  nextCheckpoint: number;
  lapStartTick: number;
  lastLapTicks: number | null;
  bestLapTicks: number | null;
  finishTick: number | null;
  /** Ticks behind the first car over the line, at this car's last crossing. Missing until then. */
  gapTicks?: number | null;
  /** How that gap changed since the lap before: negative means catching up. */
  gapChangeTicks?: number | null;
  ai: AiMemory | null;
}

/** A loose object on the track (traffic cone). */
export interface Prop {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  spin: number;
  /** Knocked over. */
  down: boolean;
}

export interface GameState {
  tick: number;
  trackId: string;
  phase: Phase;
  /** Tick at which the countdown ends and cars may drive. */
  startTick: number;
  totalLaps: number;
  /** Race options. Missing means `DEFAULT_RULES`. */
  rules?: RaceRules;
  /** Cones and other loose objects. Missing means none. */
  props?: Prop[];
  cars: CarState[];
  /** Fastest-first top 3 laps of this race. */
  fastestLaps: FastestLap[];
  /** Tick the first car completed each lap (index 0 = lap 1), for gaps to the leader. */
  lapLeadTicks?: number[];
  /** Best lap ever on this track before this race started (from saved laps), for display. */
  trackRecord?: FastestLap | null;
}

export interface CarConfig {
  name: string;
  color: string;
  controller: Controller;
  /** Defaults to rally. */
  kind?: CarKind;
  setup?: CarSetup;
}

export interface RaceConfig {
  trackId: string;
  totalLaps: number;
  cars: CarConfig[];
  countdownSeconds?: number;
  rules?: RaceRules;
  /** Seed the race's own top 3 (demos and tests). */
  fastestLaps?: FastestLap[];
  /** All-time best lap on this track so far, shown next to the race's own times. */
  trackRecord?: FastestLap | null;
}
