import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { keepBest, LapRecorder, loadTelemetry, type LapTelemetry } from '../src/client/lapRecorder';
import { createRace, getTrack, planMargins, speedProfile, step, type GameState } from '../src/sim';
import { stepCarPhysics } from '../src/sim/physics';

describe('speed plan', () => {
  it('plans slower corners and earlier braking on worn tyres', () => {
    const t = getTrack('meadow');
    const fresh = speedProfile(t, { kind: 'rally' }, 1, 0);
    const worn = speedProfile(t, { kind: 'rally' }, 1, 0.8);
    let slower = 0;
    for (let i = 0; i < fresh.length; i++) {
      expect(worn[i]).toBeLessThanOrEqual(fresh[i] + 1e-9);
      if (worn[i] < fresh[i] - 1) slower++;
    }
    expect(slower / fresh.length).toBeGreaterThan(0.3);
  });

  it('keeps Easy and Medium as they were and pushes harder from there to 100%', () => {
    expect(planMargins(0.4)).toEqual(planMargins(0.7));
    expect(planMargins(1).grip).toBeGreaterThan(planMargins(0.7).grip);
    expect(planMargins(1).brake).toBeGreaterThan(planMargins(0.9).brake);
  });

  it('plans each car for its own tyres on dirt: the buggy faster, the F1 slower', () => {
    const t = getTrack('harvest');
    const sum = (kind: 'rally' | 'buggy' | 'f1') => speedProfile(t, { kind }, 1).reduce((a, b) => a + b, 0);
    expect(sum('buggy')).toBeGreaterThan(sum('rally'));
    expect(sum('f1')).toBeLessThan(sum('rally'));
  });
});

describe('tyre wear on a dirt road', () => {
  it('is a little more than tarmac and far less than a gravel trap', () => {
    const wear = (surface: 'asphalt' | 'dirt' | 'gravel') => {
      const s = createRace({ trackId: 'meadow', totalLaps: 1, cars: [{ name: 'T', color: '#fff', controller: 'human' }] });
      const car = s.cars[0];
      car.vx = 300;
      car.vy = 0;
      car.angle = 0;
      for (let i = 0; i < 120; i++) stepCarPhysics(car, { throttle: 1, steer: 0, handbrake: false }, surface, 1 / 60);
      return car.tyreWear;
    };
    expect(wear('dirt')).toBeGreaterThan(wear('asphalt'));
    expect(wear('dirt')).toBeLessThan(wear('gravel') / 4);
  });
});

/** Just enough of localStorage for the recorder. */
class MemoryStorage {
  private data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, String(v));
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

describe('lap recorder', () => {
  beforeEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  const lap = (ticks: number, trackId = 'meadow'): LapTelemetry => ({ trackId, kind: 'rally', name: 'Ada', ticks, points: [] });

  it('keeps only the best lap per track and car', () => {
    let list = keepBest([], lap(400));
    list = keepBest(list, lap(450));
    expect(list.map((l) => l.ticks)).toEqual([400]);
    list = keepBest(list, lap(380));
    list = keepBest(list, lap(500, 'harbor'));
    expect(list.map((l) => l.ticks).sort()).toEqual([380, 500]);
  });

  it('records a human lap from line to line, with points along the way', () => {
    let s: GameState = createRace({
      trackId: 'meadow',
      totalLaps: 3,
      countdownSeconds: 0,
      cars: [
        { name: 'Me', color: '#fff', controller: 'human', kind: 'rally' },
        { name: 'AI', color: '#000', controller: 'ai', kind: 'rally' },
      ],
    });
    s.phase = 'racing';
    // Let the "human" drive with the AI's brain so it gets round.
    s.cars[0].ai = structuredClone(s.cars[1].ai);
    s.cars[0].controller = 'ai';
    const rec = new LapRecorder();
    for (let i = 0; i < 60 * 30 && s.cars[0].lapsCompleted < 3; i++) {
      s = step(s, {});
      rec.record(s, {}, [0]);
    }
    const saved = loadTelemetry();
    expect(saved).toHaveLength(1);
    expect(saved[0].ticks).toBe(s.cars[0].bestLapTicks);
    expect(saved[0].points.length).toBeGreaterThan(100);
    expect(saved[0].points[0].t).toBeLessThan(4);
  }, 30_000);
});
