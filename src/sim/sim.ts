import { aiInput, aiSkill, createAiMemory } from './ai';
import { collideBounds, collideCars, collideCircle, NO_INPUT, stepCarPhysics } from './physics';
import { applyPitService } from './pits';
import { HEIGHT_SEPARATION, getTrack, heightAt, segmentsIntersect, surfaceAt, terrainHeightAt, type Track } from './track';
import { copyFastestLaps, insertFastestLap } from './fastestLaps';
import { DEFAULT_RULES, normalizeRules, normalizeSetup, toCarKind, type CarState, type GameState, type PlayerInput, type RaceConfig, type RaceRules, type TickInputs } from './types';

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;

/** 2-wide staggered grid. World units, not sample counts — Harbor samples are denser. */
export const GRID_SLOTS = 8;
const GRID_ROW_GAP = 62;
const GRID_STAGGER = 20;
const GRID_LANE = 28;
/** Pole sits behind S/F (negative = against race direction). Nose stays short of the line. */
const GRID_POLE_ALONG = -28;

type GridPose = { x: number; y: number; angle: number };

/** Slot 0 = pole (front, pit-side). Even slots left of the line, odd slots right and slightly back. */
export function gridSlotPose(track: Track, slot: number): GridPose {
  const along = GRID_POLE_ALONG - Math.floor(slot / 2) * GRID_ROW_GAP - (slot % 2) * GRID_STAGGER;
  const pose = pointAlongTrack(track, along);
  const lane = slot % 2 === 0 ? -GRID_LANE : GRID_LANE;
  return {
    x: pose.x + pose.nx * lane,
    y: pose.y + pose.ny * lane,
    angle: pose.angle,
  };
}

/** Positive distance = race direction from samples[0] (the S/F line). */
function pointAlongTrack(
  track: Track,
  distance: number,
): { x: number; y: number; angle: number; nx: number; ny: number } {
  const n = track.samples.length;
  const lens = track.segmentLengths;
  let left = distance;
  let i = 0;
  if (left >= 0) {
    for (let step = 0; step < n; step++) {
      const len = lens[i];
      if (left <= len) {
        const t = len > 0 ? left / len : 0;
        const a = track.samples[i];
        const b = track.samples[(i + 1) % n];
        return {
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
          angle: track.tangentAngles[i],
          nx: track.normals[i].x,
          ny: track.normals[i].y,
        };
      }
      left -= len;
      i = (i + 1) % n;
    }
  } else {
    left = -left;
    for (let step = 0; step < n; step++) {
      const prev = (i - 1 + n) % n;
      const len = lens[prev];
      if (left <= len) {
        const t = len > 0 ? left / len : 0;
        const a = track.samples[i];
        const b = track.samples[prev];
        return {
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
          angle: track.tangentAngles[prev],
          nx: track.normals[prev].x,
          ny: track.normals[prev].y,
        };
      }
      left -= len;
      i = prev;
    }
  }
  const p = track.samples[0];
  return { x: p.x, y: p.y, angle: track.tangentAngles[0], nx: track.normals[0].x, ny: track.normals[0].y };
}

export function createRace(config: RaceConfig): GameState {
  const track = getTrack(config.trackId);
  const cars: CarState[] = config.cars.map((c, i) => {
    const pose = gridSlotPose(track, i);
    return {
      id: i,
      name: c.name,
      color: c.color,
      kind: toCarKind(c.kind),
      setup: normalizeSetup(c.setup),
      controller: c.controller,
      x: pose.x,
      y: pose.y,
      vx: 0,
      vy: 0,
      angle: pose.angle,
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
          ? createAiMemory(((i % 3) - 1) * 14, aiSkill(normalizeRules(config.rules).aiLevel, i))
          : null,
    };
  });
  const startTick = Math.round((config.countdownSeconds ?? 3) * TICK_RATE);
  for (const car of cars) car.lapStartTick = startTick;
  return {
    tick: 0,
    trackId: config.trackId,
    phase: 'countdown',
    startTick,
    totalLaps: config.totalLaps,
    rules: normalizeRules(config.rules),
    cars,
    fastestLaps: copyFastestLaps(config.fastestLaps),
  };
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
    state.fastestLaps = insertFastestLap(state.fastestLaps ?? [], {
      name: car.name,
      ticks: lapTicks,
      trackId: state.trackId,
      car: car.kind,
      color: car.color,
    });
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
  const rules = state.rules ?? DEFAULT_RULES;

  for (const car of state.cars) {
    const input = car.controller === 'ai' ? aiInput(car, track, canDrive, state.cars, state.tick) : canDrive ? sanitize(inputs[car.id]) : NO_INPUT;
    const px = car.x;
    const py = car.y;
    stepCarPhysics(car, input, surfaceAt(track, car.x, car.y), DT, rules);
    if (canDrive) {
      applyPitService(car, track, DT);
      updateCheckpoints(state, car, track, px, py);
    }
  }

  const cars = state.cars;
  const heights = cars.map((c) => heightAt(track, c.x, c.y));
  for (let i = 0; i < cars.length; i++) {
    for (let j = i + 1; j < cars.length && rules.collisions; j++) {
      if (Math.abs(heights[i] - heights[j]) > HEIGHT_SEPARATION) continue;
      collideCars(cars[i], cars[j], rules);
    }
  }
  for (let i = 0; i < cars.length; i++) {
    const car = cars[i];
    collideObstacles(car, heights[i], track, rules);
    collideBounds(car, track.def.width, track.def.height, rules);
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
  const rules = state.rules ?? DEFAULT_RULES;
  const car = state.cars.find((c) => c.id === carId);
  if (!car) return state;
  const use = canDrive ? sanitize(input) : NO_INPUT;
  const px = car.x;
  const py = car.y;
  stepCarPhysics(car, use, surfaceAt(track, car.x, car.y), DT, rules);
  if (canDrive) {
    applyPitService(car, track, DT);
    updateCheckpoints(state, car, track, px, py);
  }
  collideObstacles(car, heightAt(track, car.x, car.y), track, rules);
  collideBounds(car, track.def.width, track.def.height, rules);
  return state;
}

/** Obstacles stand on the ground; a car on a bridge above them passes over. */
function collideObstacles(car: CarState, height: number, track: Track, rules: RaceRules) {
  for (const o of track.def.obstacles) {
    if (Math.abs(height - terrainHeightAt(track, o.x, o.y)) > HEIGHT_SEPARATION) continue;
    collideCircle(car, o.x, o.y, o.r, rules);
  }
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
