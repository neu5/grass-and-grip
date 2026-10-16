import { clamp, datan2, normalizeAngle } from './dmath';
import { nearestSampleIndex, type Track } from './track';
import type { CarState, PlayerInput } from './types';

/** Usable lateral acceleration the AI plans corners with (px/s^2). */
const PLAN_LATERAL = 820;
/** Deceleration the AI assumes when planning braking points (px/s^2). */
const PLAN_BRAKE = 650;
const PLAN_SAMPLES = 45;
const MAX_PLAN_SPEED = 600;

/** Deterministic AI driver: produces a PlayerInput exactly like a human would. */
export function aiInput(car: CarState, track: Track, racing: boolean): PlayerInput {
  const ai = car.ai;
  if (!ai || !racing) return { throttle: 0, steer: 0, handbrake: false };

  const speed = Math.sqrt(car.vx * car.vx + car.vy * car.vy);
  const n = track.samples.length;
  const idx = nearestSampleIndex(track, car.x, car.y);
  const look = 4 + Math.floor(speed / 70);
  const ti = (idx + look) % n;
  const target = track.samples[ti];
  const nrm = track.normals[ti];
  const tx = target.x + nrm.x * ai.laneOffset;
  const ty = target.y + nrm.y * ai.laneOffset;
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
