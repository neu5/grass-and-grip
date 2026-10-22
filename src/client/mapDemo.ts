import { getTrack, inBridge, nearestSampleIndex, surfaceAt, type CarState, type PlayerInput, type Track } from '../sim';
import type { Renderer3D } from './renderer3d';
import type { GameOptions } from './game';

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function arrive(car: CarState, tx: number, ty: number, maxThrottle: number, stop: boolean): PlayerInput {
  const dx = tx - car.x;
  const dy = ty - car.y;
  const dist = Math.hypot(dx, dy);
  const diff = wrapAngle(Math.atan2(dy, dx) - car.angle);
  const speed = Math.hypot(car.vx, car.vy);
  const steer = clamp(diff * 2.5, -1, 1);
  if (stop) {
    const brakeDist = (speed * speed) / (2 * 500) + 18;
    if (dist < brakeDist) {
      if (speed < 10 && dist < 24) return { throttle: 0, steer, handbrake: false };
      return { throttle: -1, steer, handbrake: speed > 45 };
    }
  }
  const turnSlow = Math.abs(diff) > 0.65 ? 0.34 : 1;
  return { throttle: Math.min(maxThrottle, 0.22 + dist / 150) * turnSlow, steer, handbrake: false };
}

function chaseSample(car: CarState, track: Track, targetIdx: number, look: number, throttle: number): PlayerInput {
  const idx = nearestSampleIndex(track, car.x, car.y);
  const aim = Math.max(idx + look, Math.min(targetIdx, idx + look + 8));
  const p = track.samples[Math.min(targetIdx, aim)];
  return arrive(car, p.x, p.y, throttle, false);
}

/** Auto-drive Harbor Bridge for `?demo=map`: overview, bridge, water crawl, sand. */
export function mapDemoOptions(renderer: Renderer3D): GameOptions {
  const track = getTrack('harbor');
  const deck = track.def.bridges![0];
  const bridgeIdx = nearestSampleIndex(track, deck.x + deck.w / 2, deck.y + deck.h / 2);
  const approachIdx = Math.max(0, bridgeIdx - Math.floor(track.samples.length * 0.2));
  // The river just upstream of the east bridge, then the runoff past the NE corner.
  const water = { x: 1340, y: 482 };
  const runoff = track.def.sand![0];
  const sand = { x: runoff.x + runoff.w / 2, y: runoff.y + runoff.h / 2 };
  type Phase = 'show' | 'toBridge' | 'onBridge' | 'toWater' | 'inWater' | 'toSand';
  let phase: Phase = 'show';
  let hold = 0;

  renderer.cameraMode = 'overview';

  return {
    humans: 1,
    aiCount: 0,
    laps: 1,
    trackId: 'harbor',
    p1Car: 'rally',
    countdownSeconds: 0,
    setup: (state) => {
      const car = state.cars[0];
      car.x = track.samples[approachIdx].x;
      car.y = track.samples[approachIdx].y;
      car.angle = track.tangentAngles[approachIdx];
      car.vx = 0;
      car.vy = 0;
      phase = 'show';
      hold = 0;
      renderer.cameraMode = 'overview';
    },
    scriptedInput: (state) => {
      const car = state.cars[0];
      if (phase === 'show') {
        hold++;
        if (hold >= 50) renderer.cameraMode = 'follow';
        if (hold > 70) {
          phase = 'toBridge';
          hold = 0;
        }
        return { throttle: 0, steer: 0, handbrake: false };
      }
      if (phase === 'toBridge') {
        renderer.cameraMode = 'follow';
        if (inBridge(track, car.x, car.y)) {
          phase = 'onBridge';
          hold = 0;
        }
        return chaseSample(car, track, bridgeIdx, 5, 0.92);
      }
      if (phase === 'onBridge') {
        const p = track.samples[bridgeIdx];
        const input = arrive(car, p.x, p.y, 0.55, true);
        const dist = Math.hypot(car.x - p.x, car.y - p.y);
        if (dist < 40) hold++;
        if (hold > 55) {
          phase = 'toWater';
          hold = 0;
        }
        return input;
      }
      if (phase === 'toWater') {
        const input = arrive(car, water.x, water.y, 0.7, true);
        if (surfaceAt(track, car.x, car.y) === 'water') {
          phase = 'inWater';
          hold = 0;
        }
        return input;
      }
      if (phase === 'inWater') {
        hold++;
        const input = arrive(car, water.x, water.y, 0.55, true);
        if (hold > 70) {
          phase = 'toSand';
          hold = 0;
        }
        return input;
      }
      return arrive(car, sand.x, sand.y, 0.85, true);
    },
  };
}
