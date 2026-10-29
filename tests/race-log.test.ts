import { describe, expect, it } from 'vitest';
import { loadRaceLogs, saveRaceLog } from '../src/client/lapRecorder';
import { createRace, hashState, RaceLogWriter, replayRace, step, traceRows, type GameState, type RaceConfig, type RaceLog } from '../src/sim';

const config: RaceConfig = {
  trackId: 'meadow',
  totalLaps: 2,
  countdownSeconds: 1,
  cars: [
    { name: 'Me', color: '#fff', controller: 'human', kind: 'rally' },
    { name: 'AI 1', color: '#f00', controller: 'ai', kind: 'f1' },
    { name: 'AI 2', color: '#0f0', controller: 'ai', kind: 'kart' },
  ],
  rules: { damage: 1, tyreWear: 2, fuel: 1, collisions: true, aiLevel: 100 },
};

/** Run a race with a made-up human, writing its log. */
function record(ticks: number): { log: RaceLog; end: GameState } {
  let s = createRace(config);
  const w = new RaceLogWriter(config, s);
  for (let i = 0; i < ticks; i++) {
    // Floor it, with a wiggle now and then: runs of the same input and changes.
    const inputs = { 0: { throttle: 1, steer: i % 90 < 10 ? 0.5 : 0, handbrake: false } };
    s = step(s, inputs);
    w.record(s, inputs);
  }
  return { log: w.value, end: s };
}

describe('race log', () => {
  it('plays a race back exactly, tick by tick', () => {
    const { log, end } = record(60 * 20);
    expect(log.ticks).toBe(60 * 20);
    // Run-length coded: far fewer entries than ticks.
    expect(log.inputs.length).toBeLessThan(60);
    expect(log.cars.map((c) => c.controller)).toEqual(['human', 'ai', 'ai']);
    const seen = new Map<number, string>();
    const back = replayRace(JSON.parse(JSON.stringify(log)), (s) => {
      if (s.tick % 30 === 0) seen.set(s.tick, JSON.stringify(traceRows(s)));
    });
    expect(hashState(back)).toBe(hashState(end));
    for (const row of log.trace.filter((r) => r[1] === 0)) {
      const rows = JSON.parse(seen.get(row[0] as number)!);
      expect(rows[0]).toEqual(row);
    }
  });

  it('keeps the last three races in storage', () => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    try {
      const { log } = record(120);
      for (let i = 0; i < 5; i++) saveRaceLog({ ...log, savedAt: String(i) });
      expect(loadRaceLogs().map((l) => l.savedAt)).toEqual(['2', '3', '4']);
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});
