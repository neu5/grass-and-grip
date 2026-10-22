import { clamp, datan2, dcos, dsin, normalizeAngle } from './dmath';
import { carStats, tyreFactor, TYRE } from './physics';
import { distanceToCenterline, inPitLane, nearestSampleIndex, pitBoxIndex, type Track } from './track';
import { PIT } from './pits';
import { missedGate, pastNextGate, racingLine, speedProfile, MISSED_GATE_DISTANCE } from './racingLine';
import type { AiMemory, CarState, PlayerInput } from './types';

/** Usable lateral acceleration for centerline driving in the pit approach (px/s^2). */
const PLAN_LATERAL = 820;
/** Deceleration assumed for pit-approach braking points (px/s^2). */
const PLAN_BRAKE = 650;
const PLAN_SAMPLES = 45;
const MAX_PLAN_SPEED = 600;

/** How the 0..1 driving level shapes the AI. */
export const AI_LEVEL = {
  /** Share of the planned speed at level 0 and 1. */
  paceMin: 0.8,
  paceMax: 1.0,
  /** Sideways wander off the line at level 0 (units). */
  wobble: 16,
  /** Chance per braking zone of braking late, at level 0. */
  mistakeChance: 0.12,
  /** Extra pace while braking late. */
  mistakePace: 0.1,
  mistakeTicks: 40,
  /** Gap kept to a car when passing, at level 0 and 1. */
  passGapMin: 8,
  passGapMax: 18,
};

/** Race AI level (0..100) plus a small fixed spread per car, as 0..1. */
export function aiSkill(level: number, carIndex: number): number {
  const spread = (((carIndex * 7) % 5) - 2) * 0.015;
  return clamp(level / 100 + spread, 0, 1);
}

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
  return {
    laneOffset,
    skill,
    stuckTicks: 0,
    reverseTicks: 0,
    pitPhase: 'race',
    pitBox: -1,
    passOffset: 0,
    recoverGate: -1,
    recoverStage: 0,
    mistakeTicks: 0,
  };
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

/** Follow the centerline (plus an offset) at planned speed. Used around the pits. */
function centerSteer(car: CarState, ai: AiMemory, track: Track, laneOffset: number): PlayerInput {
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
export function aiInput(car: CarState, track: Track, racing: boolean, cars: CarState[] = [], tick = 0): PlayerInput {
  const ai = car.ai;
  if (!ai || !racing) return { throttle: 0, steer: 0, handbrake: false };

  const pitInput = pitSteer(car, ai, track, cars);
  if (pitInput) return pitInput;

  return raceDrive(car, ai, track, cars, tick);
}

/** Cheap deterministic 0..1 hash of two integers. */
function hash01(a: number, b: number): number {
  let h = (Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h % 10000) / 10000;
}

/** Back off and reverse out when the car has been stuck for a while. Returns an input while reversing. */
function unstick(ai: AiMemory, speed: number, err: number): PlayerInput | null {
  if (ai.reverseTicks > 0) {
    ai.reverseTicks--;
    // Lock picked once per escape: backing out with the wheels the other way
    // points the nose toward the target. If that keeps failing (wedged against
    // a wall), alternate with driving forward on the opposite lock.
    const forward = (ai.stuckCount ?? 0) % 2 === 0;
    const lock = ai.reverseSteer ?? 1;
    return { throttle: forward ? 1 : -1, steer: forward ? -lock : lock, handbrake: false };
  }
  if (speed < 25) {
    ai.stuckTicks++;
    if (ai.stuckTicks > 60) {
      ai.stuckTicks = 0;
      ai.stuckCount = Math.min(6, (ai.stuckCount ?? 0) + 1);
      ai.reverseTicks = 35 + ai.stuckCount * 10;
      ai.reverseSteer = (err > 0 ? -1 : 1) * (ai.stuckCount > 2 && ai.stuckCount % 4 >= 2 ? -1 : 1);
    }
  } else if (speed > 80) {
    ai.stuckTicks = 0;
    ai.stuckCount = 0;
  } else {
    ai.stuckTicks = Math.max(0, ai.stuckTicks - 1);
  }
  return null;
}

/**
 * Race driving: follow the precomputed racing line at the car's own speed
 * profile, pass slower cars on the side with room, and go back for a
 * checkpoint it drove past.
 */
function raceDrive(car: CarState, ai: AiMemory, track: Track, cars: CarState[], tick: number): PlayerInput {
  const line = racingLine(track);
  const n = line.points.length;
  const speed = Math.hypot(car.vx, car.vy);
  const idx = nearestSampleIndex(track, car.x, car.y);
  const level = clamp(ai.skill, 0, 1);

  // A checkpoint missed (pushed wide, cut, or round the gate end): go back for it.
  if ((ai.recoverGate ?? -1) >= 0 && car.nextCheckpoint !== ai.recoverGate) ai.recoverGate = -1;
  if (car.finishTick === null) {
    if ((ai.recoverGate ?? -1) < 0 && missedGate(track, car, idx)) {
      ai.recoverGate = car.nextCheckpoint;
      ai.recoverStage = 0;
    } else if (ai.recoverStage === 1 && pastNextGate(track, car, idx) > MISSED_GATE_DISTANCE * 2) {
      ai.recoverStage = 0;
    }
  }
  if ((ai.recoverGate ?? -1) >= 0 && ai.recoverStage === 0) {
    const gate = line.gateIndex[ai.recoverGate!];
    const back = line.points[(gate - 10 + n) % n];
    const toBack = normalizeAngle(datan2(back.y - car.y, back.x - car.x) - car.angle);
    const stuck = unstick(ai, speed, toBack);
    if (stuck) return stuck;
    if (Math.hypot(back.x - car.x, back.y - car.y) < 40) {
      ai.recoverStage = 1;
    } else {
      return driveTo(car, back.x, back.y, 0.6, false);
    }
  }

  // Aim point along the line, further out at speed.
  const look = 34 + speed * 0.22;
  let j = idx;
  for (let d = 0; d < look; j = (j + 1) % n) d += track.segmentLengths[j];

  // Off the road: just get back on; passing can wait.
  const offRoad = distanceToCenterline(track, car.x, car.y) > track.def.halfWidth;
  // Only pull out to pass where the line is not braking for a corner.
  const profile = speedProfile(track, car);
  const cornering = profile[(idx + 8) % n] < speed + 30;
  const lane = offRoad ? { offset: 0, speedCap: Infinity } : passLane(car, track, cars, idx, level, cornering);
  ai.passOffset = (ai.passOffset ?? 0) + (lane.offset - (ai.passOffset ?? 0)) * 0.08;
  const wobble = (1 - level) * AI_LEVEL.wobble * dsin(line.arc[idx] / 170 + car.id * 1.7);
  const edge = track.def.halfWidth - 12;
  const want = clamp(line.offset[j] + ai.passOffset + wobble, -edge, edge);
  const tx = track.samples[j].x + track.normals[j].x * want;
  const ty = track.samples[j].y + track.normals[j].y * want;
  const err = normalizeAngle(datan2(ty - car.y, tx - car.x) - car.angle);

  const stuck = unstick(ai, speed, err);
  if (stuck) return stuck;

  // Counter-steer into a slide: steer toward where the car is actually going.
  let slipAngle = 0;
  if (speed > 40) {
    const beta = normalizeAngle(datan2(car.vy, car.vx) - car.angle);
    if (Math.abs(beta) < Math.PI / 2) slipAngle = beta;
  }
  const steer = clamp(err * 2.4 + slipAngle * 0.9, -1, 1);

  // Target speed: own profile, a few samples ahead, slower on worn tyres.
  const grip = tyreFactor(car.tyreWear ?? 0, TYRE.wornGrip);
  let pace = AI_LEVEL.paceMin + (AI_LEVEL.paceMax - AI_LEVEL.paceMin) * level;
  const ahead = (idx + 3) % n;
  const planned = profile[ahead] * Math.sqrt(grip);
  if ((ai.mistakeTicks ?? 0) > 0) {
    ai.mistakeTicks!--;
    pace += AI_LEVEL.mistakePace;
  } else if (planned < speed - 40 && hash01(car.id + 1, Math.floor(tick / 45)) < AI_LEVEL.mistakeChance * (1 - level)) {
    ai.mistakeTicks = AI_LEVEL.mistakeTicks;
  }
  const target = Math.min(planned * pace, lane.speedCap);

  let throttle: number;
  const diff = target - speed;
  if (diff > 0) throttle = clamp(0.35 + diff / 30, 0, 1);
  else if (diff > -18 || speed < 20) throttle = 0;
  else throttle = -clamp(-diff / 70, 0.35, 1);
  if (Math.abs(err) > 1.3 && speed > 120) throttle = -1;

  // Light cars flick the handbrake into tight hairpins.
  const kind = car.kind;
  const hairpin = line.curvature[j] > 1 / 85;
  const handbrake = kind !== 'f1' && kind !== 'truck' && hairpin && Math.abs(err) > 0.75 && speed > 90;
  return { throttle, steer, handbrake };
}

/**
 * Sideways shift off the racing line to get past a slower car ahead, and a
 * speed cap when there is no room. Gives room to a car alongside.
 */
function passLane(
  car: CarState,
  track: Track,
  cars: CarState[],
  idx: number,
  level: number,
  cornering: boolean,
): { offset: number; speedCap: number } {
  const line = racingLine(track);
  const ca = dcos(car.angle);
  const sa = dsin(car.angle);
  const speed = car.vx * ca + car.vy * sa;
  const me = carStats(car);
  const edge = track.def.halfWidth - 14;
  const gap = AI_LEVEL.passGapMax - (AI_LEVEL.passGapMax - AI_LEVEL.passGapMin) * level;
  let ahead: CarState | null = null;
  let aheadAlong = Infinity;
  let nudge = 0;
  for (const o of cars) {
    if (o.id === car.id) continue;
    const dx = o.x - car.x;
    const dy = o.y - car.y;
    const along = dx * ca + dy * sa;
    const side = -dx * sa + dy * ca;
    const reach = me.radius + carStats(o).radius;
    if (Math.abs(along) < reach + 6 && Math.abs(side) < reach + 14) {
      // Alongside: lean away so neither gets squeezed off.
      nudge += side > 0 ? -10 : 10;
      continue;
    }
    if (along <= 0 || along > 150 + Math.max(0, speed) * 0.3 || Math.abs(side) > reach + 22) continue;
    const otherAlong = o.vx * ca + o.vy * sa;
    if (speed - otherAlong < -5) continue;
    if (along < aheadAlong) {
      aheadAlong = along;
      ahead = o;
    }
  }
  if (!ahead) return { offset: clamp(nudge, -edge, edge), speedCap: Infinity };

  // Pass on whichever side of the car ahead has more road left.
  const io = nearestSampleIndex(track, ahead.x, ahead.y);
  const center = track.samples[io];
  const nrm = track.normals[io];
  const theirs = (ahead.x - center.x) * nrm.x + (ahead.y - center.y) * nrm.y;
  const need = me.radius + carStats(ahead).radius + gap;
  const roomPlus = edge - theirs;
  const roomMinus = theirs + edge;
  const otherAlong = ahead.vx * ca + ahead.vy * sa;
  let lane: number | null = null;
  if (roomPlus >= need && roomPlus >= roomMinus) lane = theirs + need;
  else if (roomMinus >= need) lane = theirs - need;
  else if (roomPlus >= need) lane = theirs + need;
  const lineHere = line.offset[idx];
  if (lane === null || cornering) {
    // Boxed in: hang back behind it.
    const cap = aheadAlong < 70 ? Math.max(0, otherAlong - 5) : Infinity;
    return { offset: clamp(nudge, -edge, edge), speedCap: cap };
  }
  return { offset: clamp(lane - lineHere + nudge, -edge * 2, edge * 2), speedCap: Infinity };
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
      return centerSteer(car, ai, track, ai.laneOffset);
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
        return centerSteer(car, ai, track, ai.laneOffset);
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
    if (pitBoxIndex(track, car.x, car.y) === ai.pitBox) {
      if (speed < PIT.stopSpeed) {
        ai.pitPhase = 'box';
        return sit();
      }
      return { throttle: -1, steer: 0, handbrake: true };
    }
    if (inPitLane(track, car.x, car.y)) {
      return driveTo(car, c.x, c.y, 0.55, true);
    }
    const idx = nearestSampleIndex(track, car.x, car.y);
    return centerSteer(car, ai, track, pitSideOffset(track, idx));
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
