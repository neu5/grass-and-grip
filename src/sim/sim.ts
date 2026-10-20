import { aiInput } from './ai';
import { collideBounds, collideCars, collideCircle, NO_INPUT, stepCarPhysics } from './physics';
import { applyPitService } from './pits';
import { getTrack, segmentsIntersect, surfaceAt, type Track } from './track';
import type { CarState, GameState, PlayerInput, RaceConfig, TickInputs } from './types';

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;

const GRID_SAMPLE_SPACING = 3;
const GRID_LANE_OFFSET = 22;

export function createRace(config: RaceConfig): GameState {
  const track = getTrack(config.trackId);
  const n = track.samples.length;
  const cars: CarState[] = config.cars.map((c, i) => {
    const row = Math.floor(i / 2);
    const idx = (n - 2 - row * GRID_SAMPLE_SPACING) % n;
    const p = track.samples[idx];
    const nrm = track.normals[idx];
    const lane = i % 2 === 0 ? -GRID_LANE_OFFSET : GRID_LANE_OFFSET;
    return {
      id: i,
      name: c.name,
      color: c.color,
      kind: c.kind === 'f1' ? 'f1' : 'rally',
      controller: c.controller,
      x: p.x + nrm.x * lane,
      y: p.y + nrm.y * lane,
      vx: 0,
      vy: 0,
      angle: track.tangentAngles[idx],
      slip: 0,
      tyreWear: 0,
      fuel: 1,
      damage: 0,
      onGrass: false,
      handbrake: false,
      lapsCompleted: 0,
      nextCheckpoint: 1 % track.gates.length,
      lapStartTick: 0,
      lastLapTicks: null,
      bestLapTicks: null,
      finishTick: null,
      ai:
        c.controller === 'ai'
          ? { laneOffset: ((i % 3) - 1) * 14, skill: 0.8 + ((i * 7) % 5) * 0.035, stuckTicks: 0, reverseTicks: 0 }
          : null,
    };
  });
  const startTick = Math.round((config.countdownSeconds ?? 3) * TICK_RATE);
  for (const car of cars) car.lapStartTick = startTick;
  return { tick: 0, trackId: config.trackId, phase: 'countdown', startTick, totalLaps: config.totalLaps, cars };
}

export function sanitize(input: PlayerInput | undefined): PlayerInput {
  if (!input) return NO_INPUT;
  const t = Number(input.throttle);
  const s = Number(input.steer);
  return {
    throttle: Number.isFinite(t) ? t : 0,
    steer: Number.isFinite(s) ? s : 0,
    handbrake: !!input.handbrake,
  };
}

function updateCheckpoints(state: GameState, car: CarState, track: Track, px: number, py: number): void {
  const gate = track.gates[car.nextCheckpoint];
  const moveX = car.x - px;
  const moveY = car.y - py;
  if (moveX * gate.tx + moveY * gate.ty <= 0) return;
  if (!segmentsIntersect({ x: px, y: py }, { x: car.x, y: car.y }, gate.a, gate.b)) return;

  if (car.nextCheckpoint === 0) {
    const lapTicks = state.tick - car.lapStartTick;
    car.lapsCompleted++;
    car.lastLapTicks = lapTicks;
    if (car.bestLapTicks === null || lapTicks < car.bestLapTicks) car.bestLapTicks = lapTicks;
    car.lapStartTick = state.tick;
    if (car.finishTick === null && car.lapsCompleted >= state.totalLaps) car.finishTick = state.tick;
  }
  car.nextCheckpoint = (car.nextCheckpoint + 1) % track.gates.length;
}

/**
 * Advance the simulation by exactly one fixed tick. Pure: returns a new state
 * and never mutates the input, so callers can keep the previous state for
 * render interpolation, rollback or replays.
 */
export function step(prev: GameState, inputs: TickInputs): GameState {
  const state: GameState = structuredClone(prev);
  const track = getTrack(state.trackId);
  state.tick++;

  if (state.phase === 'countdown' && state.tick >= state.startTick) state.phase = 'racing';
  const canDrive = state.phase !== 'countdown';

  for (const car of state.cars) {
    const input = car.controller === 'ai' ? aiInput(car, track, canDrive) : canDrive ? sanitize(inputs[car.id]) : NO_INPUT;
    const px = car.x;
    const py = car.y;
    stepCarPhysics(car, input, surfaceAt(track, car.x, car.y), DT);
    if (canDrive) {
      applyPitService(car, track, DT);
      updateCheckpoints(state, car, track, px, py);
    }
  }

  const cars = state.cars;
  for (let i = 0; i < cars.length; i++) {
    for (let j = i + 1; j < cars.length; j++) collideCars(cars[i], cars[j]);
  }
  for (const car of cars) {
    for (const o of track.def.obstacles) collideCircle(car, o.x, o.y, o.r);
    collideBounds(car, track.def.width, track.def.height);
  }

  if (state.phase === 'racing') {
    const humans = cars.filter((c) => c.controller === 'human');
    const relevant = humans.length > 0 ? humans : cars;
    if (relevant.every((c) => c.finishTick !== null)) state.phase = 'finished';
  }
  return state;
}

/**
 * Advance only one car with the same physics, static collisions and
 * checkpoints as `step`. Other cars are left untouched (no car-car collision),
 * so a client can predict its own car from the last authoritative snapshot.
 */
export function stepOwnCar(prev: GameState, carId: number, input: PlayerInput): GameState {
  const state: GameState = structuredClone(prev);
  const track = getTrack(state.trackId);
  state.tick++;
  if (state.phase === 'countdown' && state.tick >= state.startTick) state.phase = 'racing';
  const canDrive = state.phase !== 'countdown';
  const car = state.cars.find((c) => c.id === carId);
  if (!car) return state;
  const use = canDrive ? sanitize(input) : NO_INPUT;
  const px = car.x;
  const py = car.y;
  stepCarPhysics(car, use, surfaceAt(track, car.x, car.y), DT);
  if (canDrive) {
    applyPitService(car, track, DT);
    updateCheckpoints(state, car, track, px, py);
  }
  for (const o of track.def.obstacles) collideCircle(car, o.x, o.y, o.r);
  collideBounds(car, track.def.width, track.def.height);
  return state;
}

/** Race order, leader first. */
export function standings(state: GameState): CarState[] {
  const track = getTrack(state.trackId);
  const g = track.gates.length;
  const progress = (c: CarState) => {
    const passed = (c.nextCheckpoint - 1 + g) % g;
    const gate = track.gates[c.nextCheckpoint];
    const dx = gate.center.x - c.x;
    const dy = gate.center.y - c.y;
    return { score: c.lapsCompleted * g + passed, dist: dx * dx + dy * dy };
  };
  return [...state.cars].sort((a, b) => {
    if (a.finishTick !== null || b.finishTick !== null) {
      if (a.finishTick === null) return 1;
      if (b.finishTick === null) return -1;
      if (a.finishTick !== b.finishTick) return a.finishTick - b.finishTick;
    }
    const pa = progress(a);
    const pb = progress(b);
    if (pa.score !== pb.score) return pb.score - pa.score;
    if (pa.dist !== pb.dist) return pa.dist - pb.dist;
    return a.id - b.id;
  });
}

/** Cheap FNV-1a hash of the full state, for desync detection. */
export function hashState(state: GameState): string {
  const s = JSON.stringify(state);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function ticksToTime(ticks: number): string {
  const ms = Math.round((ticks * 1000) / TICK_RATE);
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  return `${m}:${String(s).padStart(2, '0')}.${String(r).padStart(3, '0')}`;
}
