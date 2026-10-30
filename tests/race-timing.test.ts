import { describe, expect, it } from 'vitest';
import { bestColour, gapCell, intervals, lapColour } from '../src/client/hud';
import { decodeSnapshot, encodeSnapshot } from '../src/net/snapshot';
import { createRace, getTrack, normalizeRules, standings, step, type GameState } from '../src/sim';

/** Put a car just short of its next checkpoint, heading through it, and run until it crosses. */
function next(s: GameState, id: number): GameState {
  const car = s.cars[id];
  const want = car.nextCheckpoint;
  const g = getTrack(s.trackId).gates[want];
  Object.assign(car, { x: g.center.x - g.tx * 6, y: g.center.y - g.ty * 6, vx: g.tx * 400, vy: g.ty * 400, angle: Math.atan2(g.ty, g.tx) });
  for (let i = 0; i < 10 && s.cars[id].nextCheckpoint === want; i++) s = step(s, {});
  expect(s.cars[id].nextCheckpoint).not.toBe(want);
  // Park it, so it does not roll on through the next checkpoint by itself.
  Object.assign(s.cars[id], { vx: 0, vy: 0 });
  return s;
}

function race(): GameState {
  const s = createRace({
    trackId: 'meadow',
    totalLaps: 5,
    countdownSeconds: 0,
    cars: [
      { name: 'A', color: '#fff', controller: 'human' },
      { name: 'B', color: '#000', controller: 'human' },
    ],
    rules: { damage: 0, tyreWear: 0, fuel: 0, collisions: false, aiLevel: 70 },
  });
  s.phase = 'racing';
  return s;
}

function idle(s: GameState, ticks: number): GameState {
  for (let i = 0; i < ticks; i++) s = step(s, {});
  return s;
}

const gates = getTrack('meadow').gates.length;

describe('timing tower', () => {
  it('measures the gap to the leader at every checkpoint, not only at the line', () => {
    let s = race();
    expect(gapCell(s.cars[1], standings(s), s).text).toBe('–');
    s = next(s, 0);
    s = idle(s, 30);
    s = next(s, 1);
    expect(s.cars[0].gapTicks).toBe(0);
    expect(Math.abs(s.cars[1].gapTicks! - 30)).toBeLessThanOrEqual(2);
    // The next checkpoint, mid-lap: B has closed in.
    s = next(s, 0);
    s = idle(s, 12);
    s = next(s, 1);
    expect(Math.abs(s.cars[1].gapTicks! - 12)).toBeLessThanOrEqual(2);
    const order = standings(s);
    expect(gapCell(order[0], order, s).text).toBe('Leader');
    expect(gapCell(s.cars[1], order, s).text).toMatch(/^\+0\.\d{3}$/);
  });

  it('shows a lapped car as laps down', () => {
    let s = race();
    for (let k = 0; k < gates + 1; k++) s = next(s, 0);
    s = next(s, 1);
    const order = standings(s);
    expect(gapCell(s.cars[1], order, s).text).toBe('+1 LAP');
  });

  it('gives the cars ahead and behind with the time between them', () => {
    let s = race();
    s = next(s, 0);
    s = idle(s, 45);
    s = next(s, 1);
    const order = standings(s);
    expect(intervals(s, order, 1).ahead).toMatch(/^\+0\.7\d{2} A$/);
    expect(intervals(s, order, 0).behind).toMatch(/^−0\.7\d{2} B$/);
    expect(intervals(s, order, 0).ahead).toBe('–');
    expect(intervals(s, order, 1).behind).toBe('–');
  });

  it('keeps the timing through a snapshot, without the checkpoints everyone has passed', () => {
    let s = race();
    for (let k = 0; k < 4; k++) {
      s = next(s, 0);
      s = next(s, 1);
    }
    expect(s.gateLeadTicks!.base).toBeGreaterThan(1);
    expect(s.gateLeadTicks!.ticks.length).toBeLessThan(3);
    const back = decodeSnapshot(JSON.parse(JSON.stringify(encodeSnapshot(s))));
    expect(back.gateLeadTicks).toEqual(s.gateLeadTicks);
    expect(back.cars.map((c) => c.gateTicks)).toEqual(s.cars.map((c) => c.gateTicks));
    expect(back.cars.map((c) => c.gapTicks)).toEqual(s.cars.map((c) => c.gapTicks));
  });
});

describe('lap colours', () => {
  it('shows purple for the fastest lap of the race, green for a personal best, yellow and the gap otherwise', () => {
    const s = race();
    const [a, b] = s.cars;
    s.fastestLaps = [{ name: 'A', ticks: 300, trackId: 'meadow', car: 'rally', color: '#fff' }];
    Object.assign(a, { lastLapTicks: 300, bestLapTicks: 300 });
    expect(lapColour(a, s).color).toBe('#b36cff');
    expect(bestColour(a, s)).toBe('#b36cff');
    Object.assign(b, { lastLapTicks: 320, bestLapTicks: 320 });
    expect(lapColour(b, s).color).toBe('#6ee07a');
    expect(bestColour(b, s)).toBe('#fff');
    Object.assign(b, { lastLapTicks: 339 });
    expect(lapColour(b, s)).toEqual({ color: '#ffd54a', delta: '+0.317' });
  });
});

describe('car details option', () => {
  it('is off unless asked for, and travels in the snapshot', () => {
    expect(normalizeRules({}).carDetails).toBe(false);
    expect(normalizeRules({ carDetails: true }).carDetails).toBe(true);
    const s = createRace({
      trackId: 'meadow',
      totalLaps: 1,
      cars: [{ name: 'A', color: '#fff', controller: 'human' }],
      rules: normalizeRules({ carDetails: true }),
    });
    expect(decodeSnapshot(encodeSnapshot(s)).rules?.carDetails).toBe(true);
  });
});
