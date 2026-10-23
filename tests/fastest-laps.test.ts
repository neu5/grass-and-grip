import { describe, expect, it } from 'vitest';
import { CAR_COLORS } from '../src/net/protocol';
import { decodeSnapshot, encodeSnapshot } from '../src/net/snapshot';
import { COUNTDOWN_SECONDS, RESULTS_TICKS, Room } from '../src/net/room';
import {
  copyFastestLaps,
  createRace,
  FASTEST_LAP_LIMIT,
  getTrack,
  insertFastestLap,
  newTrackRecord,
  step,
  ticksToTime,
  type FastestLap,
  type GameState,
} from '../src/sim';
import { fastestLapsDemoOptions } from '../src/client/fastestLapsDemo';

const meadow = (over: Partial<FastestLap> = {}): FastestLap => ({
  name: 'Ada',
  ticks: 2400,
  trackId: 'meadow',
  car: 'f1',
  color: '#e8443a',
  ...over,
});

function completeLap(state: GameState): GameState {
  const track = getTrack(state.trackId);
  let s = state;
  const car = () => s.cars[0];
  const crossGate = (g: number) => {
    const gate = track.gates[g];
    car().x = gate.center.x - gate.tx * 10;
    car().y = gate.center.y - gate.ty * 10;
    car().vx = gate.tx * 1200;
    car().vy = gate.ty * 1200;
    s = step(s, {});
  };
  for (let g = 1; g < track.gates.length; g++) crossGate(g);
  crossGate(0);
  return s;
}

describe('insertFastestLap', () => {
  it('sorts fastest first', () => {
    let list: FastestLap[] = [];
    list = insertFastestLap(list, meadow({ name: 'Slow', ticks: 3000 }));
    list = insertFastestLap(list, meadow({ name: 'Fast', ticks: 2000 }));
    list = insertFastestLap(list, meadow({ name: 'Mid', ticks: 2500 }));
    expect(list.map((e) => e.name)).toEqual(['Fast', 'Mid', 'Slow']);
  });

  it('caps at 3 and drops the slowest', () => {
    let list: FastestLap[] = [];
    list = insertFastestLap(list, meadow({ name: 'A', ticks: 2000 }));
    list = insertFastestLap(list, meadow({ name: 'B', ticks: 2100 }));
    list = insertFastestLap(list, meadow({ name: 'C', ticks: 2200 }));
    const same = insertFastestLap(list, meadow({ name: 'D', ticks: 2300 }));
    expect(same).toBe(list);
    expect(list).toHaveLength(FASTEST_LAP_LIMIT);
    const next = insertFastestLap(list, meadow({ name: 'E', ticks: 2050 }));
    expect(next.map((e) => e.name)).toEqual(['A', 'E', 'B']);
  });

  it('keeps the earlier record on a tie', () => {
    const first = meadow({ name: 'Early', ticks: 2000, color: '#111' });
    const later = meadow({ name: 'Late', ticks: 2000, color: '#222' });
    const list = insertFastestLap(insertFastestLap([], first), later);
    expect(list[0].name).toBe('Early');
    expect(list[1].name).toBe('Late');
    const full = [
      meadow({ name: 'A', ticks: 1900 }),
      meadow({ name: 'B', ticks: 2000 }),
      meadow({ name: 'C', ticks: 2100 }),
    ];
    expect(insertFastestLap(full, meadow({ name: 'Tie', ticks: 2100 }))).toBe(full);
  });

  it('ignores junk times and copies a dirty list into a cap-3 board', () => {
    expect(insertFastestLap([], meadow({ ticks: 0 }))).toEqual([]);
    expect(insertFastestLap([], meadow({ ticks: -4 }))).toEqual([]);
    const copy = copyFastestLaps([
      meadow({ name: 'C', ticks: 3000 }),
      meadow({ name: 'A', ticks: 2000 }),
      meadow({ name: 'B', ticks: 2500 }),
      meadow({ name: 'D', ticks: 1800 }),
      meadow({ name: 'Bad', ticks: Number.NaN }),
    ]);
    expect(copy.map((e) => e.name)).toEqual(['D', 'A', 'B']);
  });
});

describe('sim records laps', () => {
  it('records driver, time, track and car, including AI', () => {
    let s = createRace({
      trackId: 'meadow',
      totalLaps: 3,
      cars: [
        { name: 'Human', color: '#e8443a', controller: 'human', kind: 'f1' },
        { name: 'Rosa', color: '#3a8ee8', controller: 'ai', kind: 'rally' },
      ],
      countdownSeconds: 0,
    });
    s = step(s, {});
    s = completeLap(s);
    expect(s.cars[0].lapsCompleted).toBe(1);
    expect(s.fastestLaps).toHaveLength(1);
    expect(s.fastestLaps[0]).toMatchObject({
      name: 'Human',
      trackId: 'meadow',
      car: 'f1',
      color: '#e8443a',
    });
    expect(s.fastestLaps[0].ticks).toBe(s.cars[0].lastLapTicks);

    let ai = createRace({
      trackId: 'meadow',
      totalLaps: 1,
      cars: [{ name: 'Rosa', color: '#3a8ee8', controller: 'ai', kind: 'rally' }],
    });
    for (let i = 0; i < 60 * 90 && ai.cars[0].lapsCompleted < 1; i++) ai = step(ai, {});
    expect(ai.cars[0].lapsCompleted).toBeGreaterThanOrEqual(1);
    expect(ai.fastestLaps[0].name).toBe('Rosa');
    expect(ai.fastestLaps[0].car).toBe('rally');
  });

  it('round-trips the board through a snapshot', () => {
    const seeded = [meadow({ name: 'Rosa', ticks: 2475 }), meadow({ name: 'Viktor', ticks: 2531 })];
    const race = createRace({
      trackId: 'meadow',
      totalLaps: 1,
      cars: [{ name: 'P', color: '#fff', controller: 'human' }],
      fastestLaps: seeded,
    });
    const again = decodeSnapshot(encodeSnapshot(race));
    expect(again.fastestLaps.map((e) => e.name)).toEqual(['Rosa', 'Viktor']);
    expect(ticksToTime(again.fastestLaps[0].ticks)).toBe('0:41.250');
  });
});

describe('room keeps the top 3', () => {
  it('holds per-track times across the results screen', () => {
    const room = new Room('laps');
    expect(room.join('p0', 'Ada', CAR_COLORS[0], 'f1')).toBeNull();
    room.setSettings('p0', { aiCount: 0, laps: 1 });
    room.setReady('p0', true);
    expect(room.race).not.toBeNull();
    for (let i = 0; i < COUNTDOWN_SECONDS * 60; i++) room.tick();
    room.race = completeLap(room.race!);
    room.tick();
    expect(room.view().fastestLaps).toHaveLength(1);
    expect(room.view().fastestLaps[0].name).toBe('Ada');

    for (const car of room.race.cars) car.finishTick = 1;
    room.race.phase = 'racing';
    room.tick();
    expect(room.phase).toBe('results');
    expect(room.view().fastestLaps[0].name).toBe('Ada');
    for (let i = 0; i < RESULTS_TICKS; i++) room.tick();
    expect(room.phase).toBe('lobby');
    expect(room.view().fastestLaps[0].name).toBe('Ada');

    expect(room.setSettings('p0', { trackId: 'harbor' })).toBeNull();
    expect(room.view().fastestLaps).toEqual([]);
    expect(room.setSettings('p0', { trackId: 'meadow' })).toBeNull();
    expect(room.view().fastestLaps[0].name).toBe('Ada');
  });
});

describe('race board vs track record', () => {
  it('starts each race with an empty board and keeps the record apart', () => {
    let s = createRace({
      trackId: 'meadow',
      totalLaps: 2,
      cars: [{ name: 'Human', color: '#e8443a', controller: 'human', kind: 'f1' }],
      countdownSeconds: 0,
      trackRecord: meadow({ name: 'Old', ticks: 1 }),
    });
    expect(s.fastestLaps).toEqual([]);
    expect(s.trackRecord?.name).toBe('Old');
    s = step(s, {});
    s = completeLap(s);
    expect(s.fastestLaps[0].name).toBe('Human');
    expect(s.trackRecord?.name).toBe('Old');
    expect(newTrackRecord(s)).toBeNull();
    const again = JSON.parse(JSON.stringify(step(s, {}))) as GameState;
    expect(again.trackRecord?.name).toBe('Old');
  });

  it('flags a new record when the race beats it, or when there was none', () => {
    const lap = meadow({ name: 'Fast', ticks: 2000 });
    expect(newTrackRecord({ fastestLaps: [lap], trackRecord: meadow({ ticks: 2100 }) })).toBe(lap);
    expect(newTrackRecord({ fastestLaps: [lap], trackRecord: meadow({ ticks: 2000 }) })).toBeNull();
    expect(newTrackRecord({ fastestLaps: [lap], trackRecord: null })).toBe(lap);
    expect(newTrackRecord({ fastestLaps: [], trackRecord: null })).toBeNull();
  });

  it('keeps the room record across races while each race board is fresh', () => {
    const room = new Room('records');
    room.join('p0', 'Ada', CAR_COLORS[0], 'f1');
    room.setSettings('p0', { aiCount: 0, laps: 1 });
    room.setReady('p0', true);
    for (let i = 0; i < COUNTDOWN_SECONDS * 60; i++) room.tick();
    room.race = completeLap(room.race!);
    room.tick();
    for (const car of room.race.cars) car.finishTick = 1;
    for (let i = 0; i < RESULTS_TICKS + 2; i++) room.tick();
    expect(room.phase).toBe('lobby');
    room.setReady('p0', true);
    expect(room.race!.fastestLaps).toEqual([]);
    expect(room.view().fastestLaps[0].name).toBe('Ada');
  });
});

describe('fastest laps demo', () => {
  it('seeds three times on the board', () => {
    const renderer = { cameraMode: 'follow' } as { cameraMode: string };
    const opts = fastestLapsDemoOptions(renderer as never);
    const s = createRace({
      trackId: 'meadow',
      totalLaps: 1,
      cars: [{ name: 'P', color: '#e8443a', controller: 'human', kind: 'f1' }],
    });
    opts.setup?.(s);
    expect(s.fastestLaps).toHaveLength(3);
    expect(s.fastestLaps.map((e) => e.name)).toEqual(['Rosa', 'Viktor', 'Kenji']);
    expect(renderer.cameraMode).toBe('overview');
  });
});
