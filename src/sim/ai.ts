import { clamp, datan2, normalizeAngle } from './dmath';
import { inPitLane, nearestSampleIndex, pitBoxIndex, type Track } from './track';
import { PIT } from './pits';
import type { AiMemory, CarState, PlayerInput } from './types';

/** Usable lateral acceleration the AI plans corners with (px/s^2). */
const PLAN_LATERAL = 820;
/** Deceleration the AI assumes when planning braking points (px/s^2). */
const PLAN_BRAKE = 650;
const PLAN_SAMPLES = 45;
const MAX_PLAN_SPEED = 600;

/** When the AI peels off, and when it leaves the stall. Hysteresis so it does not pit every lap. */
export const AI_PIT = {
  /** Pit if remaining fuel is at or below this (near empty). */
  fuelLow: 0.1,
  /** Pit if tyre wear is at or above this (HUD tyres near 0%). */
  tyreWorn: 0.9,
  /** Pit if damage is at or above this (very broken). */
  damageHigh: 0.75,
  /** Leave once recovered past these. */
  fuelOk: 0.85,
  tyreOk: 0.12,
  damageOk: 0.18,
};

export function createAiMemory(laneOffset: number, skill: number): AiMemory {
  return { laneOffset, skill, stuckTicks: 0, reverseTicks: 0, pitPhase: 'race', pitBox: -1 };
}

export function aiNeedsPit(car: CarState): boolean {
  return (car.fuel ?? 1) <= AI_PIT.fuelLow || (car.tyreWear ?? 0) >= AI_PIT.tyreWorn || (car.damage ?? 0) >= AI_PIT.damageHigh;
}

export function aiPitReady(car: CarState): boolean {
  return (car.fuel ?? 1) >= AI_PIT.fuelOk && (car.tyreWear ?? 0) <= AI_PIT.tyreOk && (car.damage ?? 0) <= AI_PIT.damageOk;
}

function boxCenter(track: Track, index: number): { x: number; y: number } | null {
  const b = track.def.pitBoxes[index];
  if (!b) return null;
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

function boxesMaxX(track: Track): number {
  let maxX = track.def.pitLane.x;
  for (const b of track.def.pitBoxes) maxX = Math.max(maxX, b.x + b.w);
  return maxX;
}

/** Near the S/F pits, not yet past the stalls. */
export function inPitApproach(track: Track, car: CarState): boolean {
  if (track.def.pitBoxes.length === 0) return false;
  const idx = nearestSampleIndex(track, car.x, car.y);
  const n = track.samples.length;
  if (idx >= n * 0.14 && idx <= n * 0.86) return false;
  const lane = track.def.pitLane;
  return car.x > lane.x - 180 && car.x < boxesMaxX(track) + 10;
}

/** Racing-line offset that hugs the pit-lane side without leaving the asphalt. */
function pitSideOffset(track: Track, idx: number): number {
  const p = track.samples[idx];
  const nrm = track.normals[idx];
  const box = track.def.pitBoxes[0];
  if (!box) return 0;
  const bx = box.x + box.w / 2;
  const by = box.y + box.h / 2;
  const toward = (bx - p.x) * nrm.x + (by - p.y) * nrm.y;
  const mag = Math.min(track.def.halfWidth - 10, 44);
  return toward >= 0 ? mag : -mag;
}

function pitHoldPoint(track: Track): { x: number; y: number } {
  const lane = track.def.pitLane;
  let minX = lane.x + lane.w;
  for (const b of track.def.pitBoxes) minX = Math.min(minX, b.x);
  return { x: Math.max(lane.x + 28, minX - 24), y: lane.y + 36 };
}

function pitRejoinPoint(track: Track): { x: number; y: number } {
  const lane = track.def.pitLane;
  const targetX = lane.x + lane.w + 28;
  const sfy = track.samples[0].y;
  let best = track.samples[0];
  let bestD = Infinity;
  for (const p of track.samples) {
    const dx = p.x - targetX;
    const dy = p.y - sfy;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

function hasRejoined(track: Track, car: CarState): boolean {
  if (inPitLane(track, car.x, car.y)) return false;
  const lane = track.def.pitLane;
  return car.x > lane.x + lane.w - 40;
}

function boxBusy(track: Track, cars: CarState[], box: number, selfId: number): boolean {
  for (const c of cars) {
    if (c.id === selfId) continue;
    if (pitBoxIndex(track, c.x, c.y) === box) return true;
    const mem = c.ai;
    if (mem && mem.pitBox === box && (mem.pitPhase === 'enter' || mem.pitPhase === 'box')) return true;
  }
  return false;
}

function pickFreeBox(track: Track, car: CarState, cars: CarState[]): number {
  const boxes = track.def.pitBoxes;
  let best = -1;
  let bestD = Infinity;
  const reserved = car.ai?.pitBox ?? -1;
  for (let i = 0; i < boxes.length; i++) {
    if (boxBusy(track, cars, i, car.id)) continue;
    if (reserved === i) return i;
    const c = boxCenter(track, i)!;
    const d = (c.x - car.x) * (c.x - car.x) + (c.y - car.y) * (c.y - car.y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function driveTo(car: CarState, tx: number, ty: number, maxThrottle: number, stop: boolean): PlayerInput {
  const dx = tx - car.x;
  const dy = ty - car.y;
  const dist = Math.hypot(dx, dy);
  const diff = normalizeAngle(datan2(dy, dx) - car.angle);
  const speed = Math.hypot(car.vx, car.vy);
  const steer = clamp(diff * 2.6, -1, 1);
  if (stop) {
    const brakeDist = (speed * speed) / (2 * 520) + 16;
    if (dist < brakeDist) {
      if (speed < 8 && dist < 22) return { throttle: 0, steer, handbrake: false };
      return { throttle: -1, steer, handbrake: speed > 40 };
    }
  }
  const turnSlow = Math.abs(diff) > 0.6 ? 0.35 : 1;
  const throttle = Math.min(maxThrottle, 0.2 + dist / 140) * turnSlow;
  return { throttle, steer, handbrake: false };
}

function sit(): PlayerInput {
  return { throttle: 0, steer: 0, handbrake: true };
}

/** Follow the racing line at planned race speed. */
function raceSteer(car: CarState, ai: AiMemory, track: Track, laneOffset: number): PlayerInput {
  const speed = Math.sqrt(car.vx * car.vx + car.vy * car.vy);
  const n = track.samples.length;
  const idx = nearestSampleIndex(track, car.x, car.y);
  const look = 4 + Math.floor(speed / 70);
  const ti = (idx + look) % n;
  const target = track.samples[ti];
  const nrm = track.normals[ti];
  const tx = target.x + nrm.x * laneOffset;
  const ty = target.y + nrm.y * laneOffset;
  const desired = datan2(ty - car.y, tx - car.x);
  const diff = normalizeAngle(desired - car.angle);

  if (ai.reverseTicks > 0) {
    ai.reverseTicks--;
    return { throttle: -1, steer: diff > 0 ? -1 : 1, handbrake: false };
  }
  if (speed < 25) {
    ai.stuckTicks++;
    if (ai.stuckTicks > 75) {
      ai.stuckTicks = 0;
      ai.reverseTicks = 45;
    }
  } else {
    ai.stuckTicks = 0;
  }

  let targetSpeed = MAX_PLAN_SPEED;
  let dist = 0;
  for (let k = 0; k < PLAN_SAMPLES; k++) {
    const j = (idx + k) % n;
    const kappa = track.curvature[j];
    if (kappa > 0) {
      const corner = Math.sqrt(PLAN_LATERAL / kappa) * ai.skill;
      const allowed = Math.sqrt(corner * corner + 2 * PLAN_BRAKE * dist);
      if (allowed < targetSpeed) targetSpeed = allowed;
    }
    dist += track.segmentLengths[j];
  }

  let throttle = 1;
  if (speed > targetSpeed + 25) throttle = -1;
  else if (speed > targetSpeed) throttle = 0;
  if (Math.abs(diff) > 1.3 && speed > 120) throttle = -1;

  return { throttle, steer: clamp(diff * 2.5, -1, 1), handbrake: false };
}

/**
 * Deterministic AI driver: produces a PlayerInput exactly like a human would.
 * `cars` is the current field so we can see which pit stalls are taken.
 */
export function aiInput(car: CarState, track: Track, racing: boolean, cars: CarState[] = []): PlayerInput {
  const ai = car.ai;
  if (!ai || !racing) return { throttle: 0, steer: 0, handbrake: false };

  const pitInput = pitSteer(car, ai, track, cars);
  if (pitInput) return pitInput;

  return raceSteer(car, ai, track, ai.laneOffset);
}

function pitSteer(car: CarState, ai: AiMemory, track: Track, cars: CarState[]): PlayerInput | null {
  if (track.def.pitBoxes.length === 0) {
    ai.pitPhase = 'race';
    ai.pitBox = -1;
    return null;
  }

  if (ai.pitPhase === 'race') {
    if (car.finishTick !== null || !aiNeedsPit(car) || !inPitApproach(track, car)) return null;
    const box = pickFreeBox(track, car, cars);
    if (box < 0) return null;
    ai.pitPhase = 'enter';
    ai.pitBox = box;
  }

  if (ai.pitPhase === 'hold') {
    const box = pickFreeBox(track, car, cars);
    if (box >= 0) {
      ai.pitPhase = 'enter';
      ai.pitBox = box;
    } else if (inPitLane(track, car.x, car.y)) {
      ai.reverseTicks = 0;
      const hold = pitHoldPoint(track);
      return driveTo(car, hold.x, hold.y, 0.32, true);
    } else {
      return raceSteer(car, ai, track, ai.laneOffset);
    }
  }

  if (ai.pitPhase === 'enter') {
    if (!inPitLane(track, car.x, car.y) && car.x > boxesMaxX(track) + 20) {
      ai.pitPhase = 'race';
      ai.pitBox = -1;
      return null;
    }
    if (ai.pitBox < 0 || boxBusy(track, cars, ai.pitBox, car.id)) {
      const alt = pickFreeBox(track, car, cars);
      if (alt < 0) {
        ai.pitPhase = 'hold';
        ai.pitBox = -1;
        if (inPitLane(track, car.x, car.y)) {
          const hold = pitHoldPoint(track);
          return driveTo(car, hold.x, hold.y, 0.32, true);
        }
        return raceSteer(car, ai, track, ai.laneOffset);
      }
      ai.pitBox = alt;
    }
    const c = boxCenter(track, ai.pitBox);
    if (!c) {
      ai.pitPhase = 'race';
      ai.pitBox = -1;
      return null;
    }
    ai.reverseTicks = 0;
    const speed = Math.hypot(car.vx, car.vy);
    if (pitBoxIndex(track, car.x, car.y) === ai.pitBox && speed < PIT.stopSpeed) {
      ai.pitPhase = 'box';
      return sit();
    }
    if (inPitLane(track, car.x, car.y)) {
      return driveTo(car, c.x, c.y, 0.55, true);
    }
    const idx = nearestSampleIndex(track, car.x, car.y);
    return raceSteer(car, ai, track, pitSideOffset(track, idx));
  }

  if (ai.pitPhase === 'box') {
    ai.reverseTicks = 0;
    ai.stuckTicks = 0;
    if (aiPitReady(car)) {
      ai.pitPhase = 'exit';
    } else {
      return sit();
    }
  }

  if (ai.pitPhase === 'exit') {
    if (hasRejoined(track, car)) {
      ai.pitPhase = 'race';
      ai.pitBox = -1;
      return null;
    }
    ai.reverseTicks = 0;
    const r = pitRejoinPoint(track);
    return driveTo(car, r.x, r.y, 0.7, false);
  }

  return null;
}
