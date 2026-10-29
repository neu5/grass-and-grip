import { clamp, datan2, dcos, dsin, normalizeAngle } from './dmath';
import { carStats } from './physics';
import { carSampleIndex, distanceToCenterline, inPitLane, pitBoxIndex, startAxis, type Rect, type Track } from './track';
import { PIT } from './pits';
import { missedGate, pastNextGate, racingLine, speedProfile, MISSED_GATE_DISTANCE } from './racingLine';
import type { AiMemory, CarState, PlayerInput } from './types';

/** Lift off the throttle this close to the road edge. */
const EDGE_LIFT = 8;
/**
 * Steering demand (1 = full lock) above which the AI lifts, and above which it
 * brakes: a little past full lock is fine, the car still turns as speed bleeds.
 */
const LOCK = { lift: 1.7, brake: 2.5 };
/** Room kept behind a car being followed, and the share of the brakes counted on to keep it. */
const FOLLOW_GAP = 10;
const FOLLOW_BRAKE = 0.55;
/** Share of the line's bend steered in directly, before the aim-point correction. */
const FEED_FORWARD = 0.5;

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
  /** Pit if fuel would be at or below this after another lap. */
  fuelLow: 0.1,
  /** Pit if tyre wear would reach this after another lap: later costs more in slides than the stop. */
  tyreWorn: 0.8,
  /** Pit if damage is at or above this (very broken). */
  damageHigh: 0.75,
  /** On the last lap: only stop if the tyres or fuel would not reach the flag. */
  tyreFinish: 0.95,
  fuelFinish: 0.02,
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

/**
 * Pit now if the car is low already, or would be by the next time round:
 * tyres past `tyreWorn` or fuel under `fuelLow` after another lap like the last.
 */
/** `lapsLeft`: laps still to drive, so the car doesn't stop on its way to the flag. */
export function aiNeedsPit(car: CarState, lapsLeft = Infinity): boolean {
  const wear = car.tyreWear ?? 0;
  const fuel = car.fuel ?? 1;
  const ahead = Math.min(1, lapsLeft);
  const lapWear = (car.ai?.lapWear ?? 0) * ahead;
  const lapFuel = (car.ai?.lapFuel ?? 0) * ahead;
  const last = lapsLeft <= 1;
  if (fuel - lapFuel <= (last ? AI_PIT.fuelFinish : AI_PIT.fuelLow)) return true;
  if (wear + lapWear >= (last ? AI_PIT.tyreFinish : AI_PIT.tyreWorn)) return true;
  return (car.damage ?? 0) >= AI_PIT.damageHigh;
}

/** Share of this lap driven, 0 at the line to 1 back at it. */
function lapDone(track: Track, car: CarState): number {
  return carSampleIndex(track, car) / track.samples.length;
}

/** Keep how much tyre and fuel the last lap used: wear gained and fuel burnt, not what a stop put back. */
function trackLapUse(car: CarState, ai: AiMemory, track: Track): void {
  const wear = car.tyreWear ?? 0;
  const fuel = car.fuel ?? 1;
  const mark = (ai.lapMark ??= { laps: car.lapsCompleted, wear, fuel, usedWear: 0, usedFuel: 0 });
  mark.usedWear += Math.max(0, wear - mark.wear);
  mark.usedFuel += Math.max(0, mark.fuel - fuel);
  mark.wear = wear;
  mark.fuel = fuel;
  if (mark.laps === car.lapsCompleted) {
    // No full lap yet: guess from the part driven, so the first stop isn't a lap late.
    const done = lapDone(track, car);
    if (car.lapsCompleted === 0 && done > 0.5) {
      ai.lapWear = mark.usedWear / done;
      ai.lapFuel = mark.usedFuel / done;
    }
    return;
  }
  ai.lapWear = mark.usedWear;
  ai.lapFuel = mark.usedFuel;
  mark.laps = car.lapsCompleted;
  mark.usedWear = 0;
  mark.usedFuel = 0;
}

export function aiPitReady(car: CarState): boolean {
  return (car.fuel ?? 1) >= AI_PIT.fuelOk && (car.tyreWear ?? 0) <= AI_PIT.tyreOk && (car.damage ?? 0) <= AI_PIT.damageOk;
}

function boxCenter(track: Track, index: number): { x: number; y: number } | null {
  const b = track.def.pitBoxes[index];
  if (!b) return null;
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

/** Distance along the start straight (the way the pits run). */
function along(track: Track, p: { x: number; y: number }): number {
  const u = startAxis(track);
  return p.x * u.x + p.y * u.y;
}

/** First and last `along` reached by a rectangle. */
function alongSpan(track: Track, r: Rect): [number, number] {
  const a = along(track, { x: r.x, y: r.y });
  const b = along(track, { x: r.x + r.w, y: r.y + r.h });
  return a < b ? [a, b] : [b, a];
}

/** Where the last stall ends, along the straight. */
function boxesEnd(track: Track): number {
  let end = alongSpan(track, track.def.pitLane)[0];
  for (const b of track.def.pitBoxes) end = Math.max(end, alongSpan(track, b)[1]);
  return end;
}

/** Near the S/F pits, not yet past the stalls. */
export function inPitApproach(track: Track, car: CarState): boolean {
  if (track.def.pitBoxes.length === 0) return false;
  const idx = carSampleIndex(track, car);
  const n = track.samples.length;
  if (idx >= n * 0.14 && idx <= n * 0.86) return false;
  const s = along(track, car);
  return s > alongSpan(track, track.def.pitLane)[0] - PIT_APPROACH && s < boxesEnd(track) + 10;
}

/** Start heading for the pits this far before the lane: room to brake from full speed and move across. */
const PIT_APPROACH = 450;
/** Braking the AI counts on to stop in its stall, and the slowest it creeps in at. */
const PIT_BRAKE = 380;
const PIT_CRAWL = 110;

/** Fastest a car may go with this much road left and still stop in it. */
function stopSpeed(left: number): number {
  return Math.max(PIT_CRAWL, Math.sqrt(2 * PIT_BRAKE * Math.max(0, left)));
}

/** Fastest the car may go this far before its stall and still stop in it. */
function pitEntrySpeed(track: Track, car: CarState, box: number): number {
  const c = boxCenter(track, box);
  if (!c) return Infinity;
  return stopSpeed(along(track, c) - along(track, car) - 30);
}

/** 0 far out, 1 near the lane: how far over to the pit side to drive. */
function pitSideShare(track: Track, car: CarState): number {
  return clamp((along(track, car) - (alongSpan(track, track.def.pitLane)[0] - 250)) / 150, 0, 1);
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

/** Room each waiting car takes in the queue. */
const QUEUE_GAP = 34;

/** Where to wait: the hold point, or behind the cars already waiting there. */
function queueSpot(track: Track, car: CarState, cars: CarState[]): { x: number; y: number } {
  const hold = pitHoldPoint(track);
  const mine = along(track, car);
  let ahead = 0;
  for (const c of cars) {
    if (c.id === car.id || c.ai?.pitPhase !== 'hold') continue;
    const a = along(track, c);
    // Already waiting further up, or level and lower in id: they go first.
    if (a > mine + 1 || (Math.abs(a - mine) <= 1 && c.id < car.id)) ahead++;
  }
  const u = startAxis(track);
  const back = Math.min(ahead * QUEUE_GAP, Math.max(0, along(track, hold) - alongSpan(track, track.def.pitLane)[0] - 14));
  return { x: hold.x - u.x * back, y: hold.y - u.y * back };
}

/** Across-the-lane span of a rectangle (perpendicular to the straight). */
function acrossSpan(track: Track, r: Rect): [number, number] {
  const u = startAxis(track);
  const a = -r.x * u.y + r.y * u.x;
  const b = -(r.x + r.w) * u.y + (r.y + r.h) * u.x;
  return a < b ? [a, b] : [b, a];
}

/** Wait in the lane's through part, level with the first stall: clear of the stalls and the road. */
function pitHoldPoint(track: Track): { x: number; y: number } {
  const u = startAxis(track);
  const [l0, l1] = acrossSpan(track, track.def.pitLane);
  let b0 = Infinity;
  let b1 = -Infinity;
  let first = Infinity;
  for (const b of track.def.pitBoxes) {
    const [a0, a1] = acrossSpan(track, b);
    b0 = Math.min(b0, a0);
    b1 = Math.max(b1, a1);
    first = Math.min(first, alongSpan(track, b)[0]);
  }
  const across = b0 - l0 > l1 - b1 ? (l0 + b0) / 2 : (b1 + l1) / 2;
  const at = Math.max(alongSpan(track, track.def.pitLane)[0] + 28, first + 12);
  // Back from (along, across) to x, y: u is the along axis, (-u.y, u.x) the across one.
  return { x: u.x * at - u.y * across, y: u.y * at + u.x * across };
}

/** A road point just past the end of the pit lane. */
function pitRejoinPoint(track: Track): { x: number; y: number } {
  const u = startAxis(track);
  const sf = track.samples[0];
  const ahead = alongSpan(track, track.def.pitLane)[1] + 28 - along(track, sf);
  const tx = sf.x + u.x * ahead;
  const ty = sf.y + u.y * ahead;
  let best = track.samples[0];
  let bestD = Infinity;
  for (const p of track.samples) {
    const dx = p.x - tx;
    const dy = p.y - ty;
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
  if (along(track, car) > alongSpan(track, track.def.pitLane)[1] - 40) return true;
  // Back on the road and going its way: the road may bend off before the lane ends.
  if (distanceToCenterline(track, car.x, car.y) > track.def.halfWidth) return false;
  const a = track.tangentAngles[carSampleIndex(track, car)];
  return car.vx * dcos(a) + car.vy * dsin(a) > 0.5 * Math.hypot(car.vx, car.vy);
}

function boxBusy(track: Track, cars: CarState[], box: number, selfId: number): boolean {
  for (const c of cars) {
    if (c.id === selfId) continue;
    // A car in the stall, not one just driving past it down the lane.
    if (pitBoxIndex(track, c.x, c.y) === box && Math.hypot(c.vx, c.vy) < 80) return true;
    const mem = c.ai;
    if (mem && mem.pitBox === box && (mem.pitPhase === 'enter' || mem.pitPhase === 'box')) return true;
  }
  return false;
}

/**
 * A free stall, keeping one already picked. The furthest down the lane comes
 * first: most room to brake, and it leaves the near stalls for the next car.
 * A stall the car has already passed is no use.
 */
function pickFreeBox(track: Track, car: CarState, cars: CarState[]): number {
  const boxes = track.def.pitBoxes;
  let best = -1;
  let bestAlong = -Infinity;
  const reserved = car.ai?.pitBox ?? -1;
  const here = along(track, car);
  for (let i = 0; i < boxes.length; i++) {
    if (boxBusy(track, cars, i, car.id)) continue;
    if (reserved === i) return i;
    const a = along(track, boxCenter(track, i)!);
    if (a < here + 20 && !inPitLane(track, car.x, car.y)) continue;
    if (a > bestAlong) {
      bestAlong = a;
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

/**
 * Deterministic AI driver: produces a PlayerInput exactly like a human would.
 * `cars` is the current field so we can see which pit stalls are taken.
 */
export function aiInput(car: CarState, track: Track, racing: boolean, cars: CarState[] = [], tick = 0, totalLaps = Infinity): PlayerInput {
  const ai = car.ai;
  if (!ai || !racing) return { throttle: 0, steer: 0, handbrake: false };

  trackLapUse(car, ai, track);
  const pitInput = pitSteer(car, ai, track, cars, tick, totalLaps - car.lapsCompleted - lapDone(track, car));
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
function raceDrive(car: CarState, ai: AiMemory, track: Track, cars: CarState[], tick: number, pit?: { cap: number; toward: number }): PlayerInput {
  const line = racingLine(track);
  const n = line.points.length;
  const speed = Math.hypot(car.vx, car.vy);
  const idx = carSampleIndex(track, car);
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
  const fromCenter = distanceToCenterline(track, car.x, car.y);
  const offRoad = fromCenter > track.def.halfWidth;
  // Only pull out to pass where the line is not braking for a corner.
  const profile = speedProfile(track, car, level, car.tyreWear ?? 0);
  const cornering = profile[(idx + 8) % n] < speed + 30;
  const lane = offRoad ? { offset: 0, speedCap: Infinity } : passLane(car, track, cars, idx, level, cornering);
  ai.passOffset = (ai.passOffset ?? 0) + (lane.offset - (ai.passOffset ?? 0)) * 0.08;
  const wobble = (1 - level) * AI_LEVEL.wobble * dsin(line.arc[idx] / 170 + car.id * 1.7);
  const edge = track.def.halfWidth - 12;
  const lineAt = pit ? line.offset[j] + (pitSideOffset(track, j) - line.offset[j]) * pit.toward : line.offset[j];
  const want = clamp(lineAt + ai.passOffset + wobble, -edge, edge);
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
  // Feed-forward: part of the lock the line's bend needs at this speed, so
  // long corners are steered through rather than chased (which runs wide).
  // The aim point covers the rest; the full amount would oversteer.
  const C = carStats(car);
  const fwd = Math.max(0, car.vx * dcos(car.angle) + car.vy * dsin(car.angle));
  const yaw = (C.steerRate * Math.min(1, fwd / C.steerFullSpeed)) / (1 + fwd / C.steerDampSpeed);
  const bend = line.bend[(idx + 2) % n];
  const feed = yaw > 0.05 ? clamp((bend * fwd) / yaw, -1, 1) * FEED_FORWARD : 0;
  const wanted = feed + err * 2.2 + slipAngle * 0.9;
  const steer = clamp(wanted, -1, 1);

  // Target speed: own profile for these tyres, a few samples ahead.
  let pace = AI_LEVEL.paceMin + (AI_LEVEL.paceMax - AI_LEVEL.paceMin) * level;
  const ahead = (idx + 3) % n;
  const planned = profile[ahead];
  if ((ai.mistakeTicks ?? 0) > 0) {
    ai.mistakeTicks!--;
    pace += AI_LEVEL.mistakePace;
  } else if (planned < speed - 40 && hash01(car.id + 1, Math.floor(tick / 45)) < AI_LEVEL.mistakeChance * (1 - level)) {
    ai.mistakeTicks = AI_LEVEL.mistakeTicks;
  }
  const target = Math.min(planned * pace, lane.speedCap, pit?.cap ?? Infinity);

  let throttle: number;
  const diff = target - speed;
  if (diff > 0) throttle = clamp(0.35 + diff / 30, 0, 1);
  else if (diff > -18 || speed < 20) throttle = 0;
  else throttle = -clamp(-diff / 70, 0.35, 1);
  if (Math.abs(err) > 1.3 && speed > 120) throttle = -1;
  // Well out of steering lock: more speed only makes it run wider, so lift.
  if (Math.abs(wanted) > LOCK.lift && speed > 100) throttle = Math.min(throttle, Math.abs(wanted) > LOCK.brake ? -0.4 : 0);
  // Running out of road (usually a wide exit): ease off so the nose tucks in.
  if (!offRoad && fromCenter > track.def.halfWidth - EDGE_LIFT && throttle > 0.3) throttle = 0.3;

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
  let aheadSide = 0;
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
      aheadSide = side;
      ahead = o;
    }
  }
  if (!ahead) return { offset: clamp(nudge, -edge, edge), speedCap: Infinity };

  // Pass on whichever side of the car ahead has more road left.
  const io = carSampleIndex(track, ahead);
  const center = track.samples[io];
  const nrm = track.normals[io];
  const theirs = (ahead.x - center.x) * nrm.x + (ahead.y - center.y) * nrm.y;
  const need = me.radius + carStats(ahead).radius + gap;
  const roomPlus = edge - theirs;
  const roomMinus = theirs + edge;
  const otherAlong = ahead.vx * ca + ahead.vy * sa;
  // Fastest we may close in and still stop behind it: its speed plus what
  // our brakes can take off over the gap.
  const reach = me.radius + carStats(ahead).radius;
  const room = Math.max(0, aheadAlong - reach - FOLLOW_GAP);
  const follow = Math.max(0, otherAlong) + Math.sqrt(2 * (me.brakeDecel / me.mass) * FOLLOW_BRAKE * room);
  let lane: number | null = null;
  if (roomPlus >= need && roomPlus >= roomMinus) lane = theirs + need;
  else if (roomMinus >= need) lane = theirs - need;
  else if (roomPlus >= need) lane = theirs + need;
  const lineHere = line.offset[idx];
  if (lane === null || cornering) {
    // Boxed in: hang back behind it.
    return { offset: clamp(nudge, -edge, edge), speedCap: follow };
  }
  // Pulling out: don't run into it before we are clear to the side.
  const clear = Math.abs(aheadSide) > reach + 4;
  return { offset: clamp(lane - lineHere + nudge, -edge * 2, edge * 2), speedCap: clear ? Infinity : follow };
}

function pitSteer(car: CarState, ai: AiMemory, track: Track, cars: CarState[], tick: number, lapsLeft: number): PlayerInput | null {
  // On the road toward the pits: race the line, slowed to stop where it must, and over to the pit side near the lane.
  const approach = (cap: number) => raceDrive(car, ai, track, cars, tick, { cap, toward: pitSideShare(track, car) });
  if (track.def.pitBoxes.length === 0) {
    ai.pitPhase = 'race';
    ai.pitBox = -1;
    return null;
  }

  if (ai.pitPhase === 'race') {
    if (car.finishTick !== null || !aiNeedsPit(car, lapsLeft) || !inPitApproach(track, car)) return null;
    // Too late to turn in this lap: try again next time round.
    if (!inPitLane(track, car.x, car.y) && along(track, car) > alongSpan(track, track.def.pitLane)[0] + 40) return null;
    const box = pickFreeBox(track, car, cars);
    if (box < 0) {
      // Every stall busy: queue in the lane. A worn car loses more in another lap than in the wait.
      ai.pitPhase = 'hold';
      ai.pitBox = -1;
    } else {
      ai.pitPhase = 'enter';
      ai.pitBox = box;
    }
  }

  if (ai.pitPhase === 'hold') {
    // Drove past the lane while waiting: race on, try next lap.
    if (!inPitLane(track, car.x, car.y) && along(track, car) > alongSpan(track, track.def.pitLane)[0] + 40) {
      ai.pitPhase = 'race';
      return null;
    }
    const box = pickFreeBox(track, car, cars);
    if (box >= 0) {
      ai.pitPhase = 'enter';
      ai.pitBox = box;
    } else if (inPitLane(track, car.x, car.y)) {
      ai.reverseTicks = 0;
      const hold = queueSpot(track, car, cars);
      return driveTo(car, hold.x, hold.y, 0.32, true);
    } else {
      return approach(stopSpeed(along(track, queueSpot(track, car, cars)) - along(track, car) - 10));
    }
  }

  if (ai.pitPhase === 'enter') {
    if (!inPitLane(track, car.x, car.y) && along(track, car) > boxesEnd(track) + 20) {
      ai.pitPhase = 'race';
      ai.pitBox = -1;
      return null;
    }
    if (ai.pitBox < 0 || boxBusy(track, cars, ai.pitBox, car.id)) {
      const alt = pickFreeBox(track, car, cars);
      if (alt < 0) {
        ai.pitPhase = 'hold';
        ai.pitBox = -1;
        const hold = queueSpot(track, car, cars);
        if (inPitLane(track, car.x, car.y)) return driveTo(car, hold.x, hold.y, 0.32, true);
        return approach(stopSpeed(along(track, hold) - along(track, car) - 10));
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
    const cap = pitEntrySpeed(track, car, ai.pitBox);
    if (inPitLane(track, car.x, car.y)) {
      const input = driveTo(car, c.x, c.y, 0.55, true);
      return speed > cap + 15 ? { ...input, throttle: -1, handbrake: false } : input;
    }
    return approach(cap);
  }

  if (ai.pitPhase === 'box') {
    ai.reverseTicks = 0;
    ai.stuckTicks = 0;
    // Nudged out of the stall before the job was done: drive back in.
    if (!aiPitReady(car) && pitBoxIndex(track, car.x, car.y) !== ai.pitBox) {
      ai.pitPhase = 'enter';
      const c = boxCenter(track, ai.pitBox);
      return c ? driveTo(car, c.x, c.y, 0.4, true) : sit();
    }
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
