import { describe, expect, it } from 'vitest';
import { CAR_COLORS } from '../src/net/protocol';
import {
  CAR_KINDS,
  createRace,
  distanceToCenterline,
  getTrack,
  hashState,
  nearestSampleIndex,
  racingLine,
  step,
  surfaceAt,
  TRACK_IDS,
  type CarKind,
  type GameState,
} from '../src/sim';

function aiRace(trackId: string, kinds: CarKind[], aiLevel = 70, laps = 2): GameState {
  const s = createRace({
    trackId,
    totalLaps: laps,
    countdownSeconds: 0,
    cars: kinds.map((kind, i) => ({ name: `AI${i}`, color: CAR_COLORS[i], controller: 'ai' as const, kind })),
    rules: { damage: 1, tyreWear: 0, fuel: 0, collisions: true, aiLevel },
  });
  s.phase = 'racing';
  return s;
}

function run(s: GameState, maxTicks: number, each?: (s: GameState) => void): GameState {
  for (let i = 0; i < maxTicks && s.phase !== 'finished'; i++) {
    s = step(s, {});
    each?.(s);
  }
  return s;
}

function soloBest(trackId: string, kind: CarKind, aiLevel: number): number {
  const s = run(aiRace(trackId, [kind], aiLevel), 60 * 60);
  expect(s.phase).toBe('finished');
  return s.cars[0].bestLapTicks!;
}

const MIXED: CarKind[] = ['truck', 'buggy', 'rally', 'kart', 'rally', 'kart', 'f1', 'f1'];

describe('racing line', () => {
  it.each(TRACK_IDS)('stays on the road everywhere on %s', (id) => {
    {
      const track = getTrack(id);
      const painted = (track.def.patches ?? []).filter((p) => p.overRoad).map((p) => p.surface);
      for (const p of racingLine(track).points) {
        expect(distanceToCenterline(track, p.x, p.y)).toBeLessThanOrEqual(track.def.halfWidth);
        expect([track.def.road ?? 'asphalt', 'asphalt', ...painted]).toContain(surfaceAt(track, p.x, p.y));
      }
    }
  });

  it('uses the width of the road in corners', () => {
    const line = racingLine(getTrack('meadow'));
    expect(Math.max(...line.offset.map(Math.abs))).toBeGreaterThan(30);
  });
});

describe('corner speed', () => {
  it('takes the long Meadow hairpin wide instead of crawling round a kink at its end', () => {
    const track = getTrack('meadow');
    const line = racingLine(track);
    const from = track.gates[3].index;
    const to = track.gates[4].index;
    let tightest = 0;
    for (let i = from; i <= to; i++) tightest = Math.max(tightest, line.curvature[i]);
    expect(1 / tightest).toBeGreaterThan(70);
    let s = aiRace('meadow', ['f1'], 70, 2);
    let slowest = Infinity;
    s = run(s, 60 * 40, (st) => {
      const c = st.cars[0];
      if (c.lapsCompleted !== 1) return;
      const idx = nearestSampleIndex(track, c.x, c.y);
      if (idx > from + 20 && idx < to) slowest = Math.min(slowest, Math.hypot(c.vx, c.vy));
    });
    expect(slowest).toBeGreaterThan(170);
  });
});

describe('AI level', () => {
  it('laps faster as the level goes up', () => {
    for (const id of ['meadow', 'harbor']) {
      const easy = soloBest(id, 'rally', 40);
      const medium = soloBest(id, 'rally', 70);
      const hard = soloBest(id, 'rally', 90);
      expect(easy).toBeGreaterThan(medium);
      expect(medium).toBeGreaterThan(hard);
    }
  });

  it('on Hard beats the old centerline AI', () => {
    // Best laps of the previous AI (centerline + fixed grip plan) for a lone rally car.
    expect(soloBest('meadow', 'rally', 90)).toBeLessThan(13.42 * 60);
    expect(soloBest('harbor', 'rally', 90)).toBeLessThan(11.03 * 60);
  });
});

describe('AI racing', () => {
  it('is deterministic, also across a JSON round-trip', () => {
    let a = aiRace('harbor', MIXED);
    let b = aiRace('harbor', MIXED);
    for (let i = 0; i < 400; i++) {
      a = step(a, {});
      b = step(b, {});
    }
    b = JSON.parse(JSON.stringify(b));
    for (let i = 0; i < 400; i++) {
      a = step(a, {});
      b = step(b, {});
    }
    expect(hashState(a)).toBe(hashState(b));
  });

  it.each(TRACK_IDS)('finishes an 8-car race of every kind on %s, staying on the road', (id) => {
    {
      const track = getTrack(id);
      const onRoad = (x: number, y: number) => distanceToCenterline(track, x, y) <= track.def.halfWidth || surfaceAt(track, x, y) === 'asphalt';
      for (const kind of [...CAR_KINDS, 'mixed'] as const) {
        const kinds = kind === 'mixed' ? MIXED : Array<CarKind>(8).fill(kind);
        let off = 0;
        let ticks = 0;
        const s = run(aiRace(id, kinds, 70, 2), 60 * 90, (st) => {
          ticks++;
          for (const c of st.cars) if (!onRoad(c.x, c.y)) off++;
        });
        expect(s.phase, `${id} ${kind}`).toBe('finished');
        expect(off / (ticks * 8), `${id} ${kind} off-road share`).toBeLessThan(0.03);
      }
    }
  }, 30_000);

  it('gets the fast cars past the slow ones', () => {
    // Cars are balanced, so slow the front of the grid down with damage instead.
    const start = aiRace('harbor', Array<CarKind>(8).fill('rally'), 70, 3);
    for (const c of start.cars.slice(0, 6)) c.damage = 0.9;
    const s = run(start, 60 * 150);
    const order = [...s.cars].sort((x, y) => x.finishTick! - y.finishTick!).map((c) => c.id);
    // The two healthy cars start at the back of the grid.
    expect(order.slice(0, 2).sort()).toEqual([6, 7]);
  });
});

describe('missed checkpoint', () => {
  it.each(TRACK_IDS)('goes back through a gate it drove past on %s, then completes the lap', (id) => {
    {
      for (const kind of ['rally', 'truck'] as const) {
        const track = getTrack(id);
        const line = racingLine(track);
        let s = aiRace(id, [kind], 70, 1);
        const car = s.cars[0];
        const at = (line.gateIndex[3] + 30) % track.samples.length;
        car.x = line.points[at].x;
        car.y = line.points[at].y;
        car.angle = track.tangentAngles[at];
        car.nextCheckpoint = 3;
        let crossed = false;
        s = run(s, 60 * 40, (st) => {
          if (st.cars[0].nextCheckpoint === 4) crossed = true;
        });
        expect(crossed, `${id} ${kind}`).toBe(true);
        expect(s.cars[0].lapsCompleted, `${id} ${kind}`).toBe(1);
      }
    }
  }, 20_000);
});
