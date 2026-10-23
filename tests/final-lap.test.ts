import { describe, expect, it } from 'vitest';
import { FINAL_LAP_SECONDS, finalLapBanners, onFinalLap } from '../src/client/hud';
import { soundEvents } from '../src/client/soundEvents';
import { createRace, TICK_RATE, type GameState } from '../src/sim';

function race(totalLaps: number): GameState {
  const s = createRace({
    trackId: 'meadow',
    totalLaps,
    countdownSeconds: 0,
    cars: [
      { name: 'Ada', color: '#e8443a', controller: 'human' },
      { name: 'Rosa', color: '#3a8ee8', controller: 'ai' },
      { name: 'Kenji', color: '#3fbf5f', controller: 'ai' },
    ],
  });
  s.phase = 'racing';
  s.tick = 1000;
  return s;
}

/** The same race one tick later with `ids` having just crossed the line. */
function cross(prev: GameState, ids: number[]): GameState {
  const next = structuredClone(prev);
  next.tick++;
  for (const id of ids) {
    next.cars[id].lapsCompleted++;
    next.cars[id].lapStartTick = next.tick;
  }
  return next;
}

describe('final lap', () => {
  it('shows the banner to a human for a moment after starting the last lap', () => {
    let s = race(3);
    s.cars[0].lapsCompleted = 1;
    expect(onFinalLap(s, s.cars[0])).toBe(false);
    s = cross(s, [0]);
    expect(onFinalLap(s, s.cars[0])).toBe(true);
    expect(finalLapBanners(s, [0], s.tick).map((b) => b.car.name)).toEqual(['Ada']);
    expect(finalLapBanners(s, [0], s.tick + FINAL_LAP_SECONDS * TICK_RATE + 1)).toEqual([]);
    // Not for AI cars on their last lap, and not once the car has finished.
    s.cars[1].lapsCompleted = 2;
    s.cars[1].lapStartTick = s.tick;
    expect(finalLapBanners(s, [0], s.tick)).toHaveLength(1);
    s.cars[0].finishTick = s.tick;
    expect(onFinalLap(s, s.cars[0])).toBe(false);
  });

  it('has no final-lap call in a one-lap race', () => {
    const s = race(1);
    expect(onFinalLap(s, s.cars[0])).toBe(false);
    expect(finalLapBanners(s, [0], s.tick)).toEqual([]);
  });

  it('rings the bell once, when the leader starts the last lap', () => {
    let s = race(3);
    for (const c of s.cars) c.lapsCompleted = 1;
    const leader = cross(s, [1, 2]);
    expect(soundEvents(s, leader).filter((e) => e.kind === 'lastLap')).toHaveLength(1);
    s = leader;
    const next = cross(s, [0]);
    expect(soundEvents(s, next).some((e) => e.kind === 'lastLap')).toBe(false);
  });
});
