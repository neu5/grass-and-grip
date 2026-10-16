import { describe, expect, it } from 'vitest';
import {
  createRace,
  distanceToCenterline,
  getTrack,
  hashState,
  step,
  surfaceAt,
  TRACKS,
  type GameState,
  type PlayerInput,
  type RaceConfig,
  type TickInputs,
} from '../src/sim';
import { datan2, dcos, dsin } from '../src/sim/dmath';

const humanVsAi: RaceConfig = {
  trackId: 'meadow',
  totalLaps: 2,
  cars: [
    { name: 'P1', color: '#e33', controller: 'human' },
    { name: 'AI 1', color: '#36f', controller: 'ai' },
    { name: 'AI 2', color: '#fc3', controller: 'ai' },
  ],
};

function scriptedInput(tick: number): PlayerInput {
  return { throttle: 1, steer: Math.sin(tick / 40) > 0.3 ? 1 : 0, handbrake: tick % 200 > 180 };
}

function run(state: GameState, ticks: number, inputFor: (t: number) => TickInputs) {
  for (let i = 0; i < ticks; i++) state = step(state, inputFor(state.tick));
  return state;
}

describe('deterministic math', () => {
  it('approximates trig closely', () => {
    for (let a = -10; a <= 10; a += 0.37) {
      expect(dsin(a)).toBeCloseTo(Math.sin(a), 8);
      expect(dcos(a)).toBeCloseTo(Math.cos(a), 8);
      expect(datan2(Math.sin(a), Math.cos(a))).toBeCloseTo(Math.atan2(Math.sin(a), Math.cos(a)), 2);
    }
  });
});

describe('simulation', () => {
  it('is deterministic for identical input streams', () => {
    const inputs = (t: number): TickInputs => ({ 0: scriptedInput(t) });
    const a = run(createRace(humanVsAi), 900, inputs);
    const b = run(createRace(humanVsAi), 900, inputs);
    expect(hashState(a)).toBe(hashState(b));
    expect(a.cars[0].x).not.toBe(createRace(humanVsAi).cars[0].x);
  });

  it('produces identical results when inputs and state round-trip through JSON', () => {
    let local = createRace(humanVsAi);
    let remote: GameState = JSON.parse(JSON.stringify(local));
    for (let i = 0; i < 600; i++) {
      const inp: TickInputs = { 0: scriptedInput(i) };
      local = step(local, inp);
      remote = step(JSON.parse(JSON.stringify(remote)), JSON.parse(JSON.stringify(inp)));
    }
    expect(hashState(remote)).toBe(hashState(local));
  });

  it('does not mutate the previous state', () => {
    const s0 = createRace(humanVsAi);
    const h = hashState(s0);
    step(s0, { 0: { throttle: 1, steer: 1, handbrake: false } });
    expect(hashState(s0)).toBe(h);
  });

  it('holds cars still during the countdown', () => {
    const s = run(createRace(humanVsAi), 100, () => ({ 0: { throttle: 1, steer: 0, handbrake: false } }));
    expect(s.phase).toBe('countdown');
    for (const c of s.cars) expect(c.vx * c.vx + c.vy * c.vy).toBe(0);
  });

  it('gives asphalt a much higher top speed than grass', () => {
    const track = getTrack('meadow');
    const topSpeed = (x: number, y: number) => {
      let s = createRace({ trackId: 'meadow', totalLaps: 1, cars: [{ name: 'T', color: '#fff', controller: 'human' }] });
      s.phase = 'racing';
      s.startTick = 0;
      for (let i = 0; i < 600; i++) {
        s.cars[0].x = x;
        s.cars[0].y = y;
        s = step(s, { 0: { throttle: 1, steer: 0, handbrake: false } });
      }
      const c = s.cars[0];
      return Math.sqrt(c.vx * c.vx + c.vy * c.vy);
    };
    const p = track.samples[0];
    expect(surfaceAt(track, p.x, p.y)).toBe('asphalt');
    expect(surfaceAt(track, 30, 30)).toBe('grass');
    expect(topSpeed(p.x, p.y)).toBeGreaterThan(topSpeed(30, 30) * 2);
  });

  it('only counts a lap after passing every checkpoint in order', () => {
    const track = getTrack('meadow');
    let s = createRace({ trackId: 'meadow', totalLaps: 3, cars: [{ name: 'T', color: '#fff', controller: 'human' }] });
    s = run(s, s.startTick, () => ({}));
    const car = () => s.cars[0];
    const crossGate = (g: number) => {
      const gate = track.gates[g];
      car().x = gate.center.x - gate.tx * 10;
      car().y = gate.center.y - gate.ty * 10;
      car().vx = gate.tx * 1200;
      car().vy = gate.ty * 1200;
      s = step(s, {});
    };
    crossGate(0);
    expect(car().lapsCompleted).toBe(0);
    crossGate(3);
    expect(car().nextCheckpoint).toBe(1);
    for (let g = 1; g < track.gates.length; g++) crossGate(g);
    expect(car().lapsCompleted).toBe(0);
    crossGate(0);
    expect(car().lapsCompleted).toBe(1);
    expect(car().lastLapTicks).toBeGreaterThan(0);
    expect(car().bestLapTicks).toBe(car().lastLapTicks);
  });

  it('lets AI drivers complete a full race', () => {
    let s = createRace({
      trackId: 'meadow',
      totalLaps: 2,
      cars: [
        { name: 'AI 1', color: '#36f', controller: 'ai' },
        { name: 'AI 2', color: '#fc3', controller: 'ai' },
      ],
    });
    for (let i = 0; i < 60 * 120 && s.phase !== 'finished'; i++) s = step(s, {});
    expect(s.phase).toBe('finished');
    for (const c of s.cars) {
      expect(c.lapsCompleted).toBeGreaterThanOrEqual(2);
      expect(c.bestLapTicks).toBeGreaterThan(60 * 5);
    }
  });

  it('keeps obstacles off the racing surface', () => {
    const track = getTrack('meadow');
    for (const o of TRACKS.meadow.obstacles) {
      expect(distanceToCenterline(track, o.x, o.y)).toBeGreaterThan(track.def.halfWidth + o.r);
    }
  });
});
