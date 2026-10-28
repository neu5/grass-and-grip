import { describe, expect, it } from 'vitest';
import { gapCell, gapChangeCell } from '../src/client/hud';
import { decodeSnapshot, encodeSnapshot } from '../src/net/snapshot';
import { createRace, getTrack, normalizeRules, step, TICK_RATE, type CarState, type GameState } from '../src/sim';

/** Put a car just short of the finish line, heading over it. */
function atLine(s: GameState, id: number) {
  const g = getTrack(s.trackId).gates[0];
  const car = s.cars[id];
  Object.assign(car, { x: g.center.x - g.tx * 6, y: g.center.y - g.ty * 6, vx: g.tx * 400, vy: g.ty * 400, angle: Math.atan2(g.ty, g.tx) });
  car.nextCheckpoint = 0;
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

/** Run until car `id` completes another lap. */
function cross(s: GameState, id: number): GameState {
  const laps = s.cars[id].lapsCompleted;
  atLine(s, id);
  for (let i = 0; i < 10 && s.cars[id].lapsCompleted === laps; i++) s = step(s, {});
  expect(s.cars[id].lapsCompleted).toBe(laps + 1);
  return s;
}

function idle(s: GameState, ticks: number): GameState {
  for (let i = 0; i < ticks; i++) s = step(s, {});
  return s;
}

describe('gap to the leader', () => {
  it('measures each lap against the first car over the line, and how it moved', () => {
    let s = race();
    expect(s.cars[1].gapTicks ?? null).toBeNull();
    s = cross(s, 0);
    expect(s.cars[0].gapTicks).toBe(0);
    s = idle(s, 120);
    s = cross(s, 1);
    expect(Math.abs(s.cars[1].gapTicks! - 120)).toBeLessThanOrEqual(2);
    expect(s.cars[1].gapChangeTicks).toBeNull();

    // Next lap B is only 60 ticks behind: catching up.
    s = cross(s, 0);
    s = idle(s, 60);
    s = cross(s, 1);
    const gap = s.cars[1].gapTicks!;
    expect(Math.abs(gap - 60)).toBeLessThanOrEqual(2);
    expect(Math.abs(s.cars[1].gapChangeTicks! + 60)).toBeLessThanOrEqual(4);
    expect(gapCell(s.cars[1])).toEqual({ text: `+${(gap / TICK_RATE).toFixed(2)}`, color: '#6ee07a' });
    expect(gapChangeCell(s.cars[1])?.color).toBe('#6ee07a');

    // Then B drops back.
    s = cross(s, 0);
    s = idle(s, 200);
    s = cross(s, 1);
    expect(Math.abs(s.cars[1].gapChangeTicks! - 140)).toBeLessThanOrEqual(4);
    expect(gapCell(s.cars[1]).color).toBe('#ff6b4a');
    expect(gapChangeCell(s.cars[1])?.text.startsWith('+')).toBe(true);
    expect(gapCell(s.cars[0]).text).toBe('LEAD');
  });

  it('survives a snapshot round-trip', () => {
    let s = race();
    s = cross(s, 0);
    s = idle(s, 30);
    s = cross(s, 1);
    const back = decodeSnapshot(JSON.parse(JSON.stringify(encodeSnapshot(s))));
    expect(back.lapLeadTicks).toEqual(s.lapLeadTicks);
    expect(back.cars.map((c: CarState) => c.gapTicks)).toEqual(s.cars.map((c) => c.gapTicks));
    expect(back.cars[1].gapTicks).toBeGreaterThan(25);
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
