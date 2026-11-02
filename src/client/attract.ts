import { CAR_KINDS, createRace, DT, step, type GameState } from '../sim';
import { CAR_COLORS } from '../net/protocol';
import type { Renderer3D } from './renderer3d';

/** Seconds the camera stays on one car before moving to the next. */
const FOCUS_SECONDS = 12;
const NAMES = ['Ada', 'Bo', 'Cy', 'Di', 'Ed', 'Flo'];

function newRace(trackId: string): GameState {
  const s = createRace({
    trackId,
    totalLaps: 2,
    countdownSeconds: 0,
    cars: NAMES.map((name, i) => ({ name, color: CAR_COLORS[i], controller: 'ai' as const, kind: CAR_KINDS[i % CAR_KINDS.length] })),
    rules: { damage: 0, tyreWear: 0, fuel: 0, collisions: true, aiLevel: 85 },
  });
  s.phase = 'racing';
  return s;
}

/**
 * A quiet AI race behind the menu, on whatever track the renderer already
 * has (no rebuild), with the camera drifting from car to car. No HUD, no
 * sound. Returns a function that stops it and gives the renderer back.
 */
export function startAttract(renderer: Renderer3D): () => void {
  const saved = { sound: renderer.sound, camera: renderer.cameraMode };
  renderer.sound = null;
  renderer.cameraMode = 'follow';
  renderer.hudVisible = false;
  renderer.resetRace();
  let prev = newRace(renderer.trackId);
  let curr = prev;
  let acc = 0;
  let last = performance.now();
  let focusAt = last;
  let focus = 0;
  let raf = 0;
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const frame = (now: number) => {
    acc += Math.min(0.1, (now - last) / 1000);
    last = now;
    while (acc >= DT) {
      prev = curr;
      curr = step(curr, {});
      renderer.onTick(curr);
      acc -= DT;
    }
    if (curr.phase === 'finished' || curr.cars.every((c) => c.lapsCompleted >= 1 && c.finishTick !== null)) {
      renderer.resetRace();
      prev = curr = newRace(renderer.trackId);
    }
    if (now - focusAt > FOCUS_SECONDS * 1000) {
      focusAt = now;
      focus = (focus + 1) % curr.cars.length;
    }
    renderer.render(prev, curr, acc / DT, [focus]);
    if (!still) raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    renderer.sound = saved.sound;
    renderer.cameraMode = saved.camera;
    renderer.hudVisible = true;
    renderer.resetRace();
  };
}
