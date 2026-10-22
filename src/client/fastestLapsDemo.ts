import type { GameState } from '../sim';
import type { Renderer3D } from './renderer3d';
import type { GameOptions } from './game';

/** Seeded top-3 board for `?demo=laps` so the HUD shows three times. */
export function fastestLapsDemoOptions(renderer: Renderer3D): GameOptions {
  renderer.cameraMode = 'overview';
  return {
    humans: 1,
    aiCount: 3,
    laps: 1,
    trackId: 'meadow',
    carMode: 'f1',
    countdownSeconds: 8,
    persistFastest: false,
    setup: (state: GameState) => {
      renderer.cameraMode = 'overview';
      state.fastestLaps = [
        { name: 'Rosa', ticks: 2475, trackId: 'meadow', car: 'f1', color: '#3a8ee8' },
        { name: 'Viktor', ticks: 2531, trackId: 'meadow', car: 'rally', color: '#f2c230' },
        { name: 'Kenji', ticks: 2610, trackId: 'meadow', car: 'f1', color: '#3fbf5f' },
      ];
    },
  };
}
