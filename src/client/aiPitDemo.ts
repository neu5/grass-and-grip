import { createAiMemory, getTrack, type GameState } from '../sim';
import type { GameOptions } from './game';

/** Auto-drive an AI pit stop for `?demo=aipit` (enter, crew, bars climb, leave). */
export function aiPitDemoOptions(): GameOptions {
  const track = getTrack('meadow');
  const i = track.samples.length - 8;
  const p = track.samples[i];

  return {
    humans: 1,
    aiCount: 0,
    laps: 3,
    p1Car: 'f1',
    countdownSeconds: 0,
    setup: (state: GameState) => {
      const car = state.cars[0];
      car.controller = 'ai';
      car.ai = createAiMemory(0, 0.92);
      car.x = p.x;
      car.y = p.y;
      car.angle = track.tangentAngles[i];
      car.vx = 0;
      car.vy = 0;
      car.fuel = 0.08;
      car.tyreWear = 0.93;
      car.damage = 0.78;
    },
  };
}
