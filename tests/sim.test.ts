import { describe, expect, it } from 'vitest';
import {
  AI_PIT,
  CARS,
  createRace,
  distanceToCenterline,
  getTrack,
  hashState,
  inPitLane,
  isStoppedInPit,
  PIT,
  pitBoxIndex,
  step,
  stepOwnCar,
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

  it('gives Formula 1 a little more acceleration and top speed than Rally', () => {
    const track = getTrack('meadow');
    const p = track.samples[0];
    const speedAfter = (kind: 'rally' | 'f1', ticks: number) => {
      let s = createRace({
        trackId: 'meadow',
        totalLaps: 1,
        cars: [{ name: 'T', color: '#fff', controller: 'human', kind }],
      });
      s.phase = 'racing';
      s.startTick = 0;
      for (let i = 0; i < ticks; i++) {
        s.cars[0].x = p.x;
        s.cars[0].y = p.y;
        s = step(s, { 0: { throttle: 1, steer: 0, handbrake: false } });
      }
      const c = s.cars[0];
      return Math.hypot(c.vx, c.vy);
    };
    // Balanced: an edge on tarmac, not a different class.
    expect(speedAfter('f1', 90)).toBeGreaterThan(speedAfter('rally', 90));
    expect(speedAfter('f1', 600)).toBeGreaterThan(speedAfter('rally', 600));
    expect(speedAfter('f1', 600)).toBeLessThan(speedAfter('rally', 600) * 1.08);
  });

  it('gives Formula 1 more grip and less slide than Rally', () => {
    expect(CARS.f1.lateralGrip).toBeGreaterThan(CARS.rally.lateralGrip);
    expect(CARS.f1.slideThreshold).toBeGreaterThan(CARS.rally.slideThreshold);
    expect(CARS.f1.slideGripFactor).toBeGreaterThan(CARS.rally.slideGripFactor);
    const lateralAfter = (kind: 'rally' | 'f1', ticks: number) => {
      let s = createRace({
        trackId: 'meadow',
        totalLaps: 1,
        cars: [{ name: 'T', color: '#fff', controller: 'human', kind }],
      });
      s.phase = 'racing';
      s.startTick = 0;
      const car = s.cars[0];
      const a = car.angle;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      car.vx = 400 * ca - 200 * sa;
      car.vy = 400 * sa + 200 * ca;
      for (let i = 0; i < ticks; i++) s = step(s, { 0: { throttle: 0, steer: 0, handbrake: false } });
      const c = s.cars[0];
      return Math.abs(-c.vx * Math.sin(c.angle) + c.vy * Math.cos(c.angle));
    };
    expect(lateralAfter('f1', 1)).toBeLessThan(lateralAfter('rally', 1));
    expect(lateralAfter('f1', 6)).toBeLessThan(lateralAfter('rally', 6));
  });

  it('starts every car on fresh tyres', () => {
    const s = createRace(humanVsAi);
    for (const c of s.cars) expect(c.tyreWear).toBe(0);
  });

  it('wears tyres faster when hard-braking than when coasting', () => {
    const track = getTrack('meadow');
    const p = track.samples[0];
    const drive = (input: PlayerInput, ticks: number, from: GameState) => {
      let s = from;
      for (let i = 0; i < ticks; i++) {
        s.cars[0].x = p.x;
        s.cars[0].y = p.y;
        s = step(s, { 0: input });
      }
      return s;
    };
    const launch = () => {
      let s = createRace({
        trackId: 'meadow',
        totalLaps: 1,
        cars: [{ name: 'T', color: '#fff', controller: 'human', kind: 'f1' }],
        countdownSeconds: 0,
      });
      s.phase = 'racing';
      s.startTick = 0;
      return drive({ throttle: 1, steer: 0, handbrake: false }, 180, s);
    };
    const coast = drive({ throttle: 0, steer: 0, handbrake: false }, 50, launch());
    const brake = drive({ throttle: -1, steer: 0, handbrake: false }, 50, launch());
    const gentle = drive({ throttle: -0.2, steer: 0, handbrake: false }, 50, launch());
    expect(brake.cars[0].tyreWear).toBeGreaterThan(coast.cars[0].tyreWear);
    expect(brake.cars[0].tyreWear).toBeGreaterThan(gentle.cars[0].tyreWear);
    expect(gentle.cars[0].tyreWear).toBeGreaterThan(coast.cars[0].tyreWear);
  });

  it('starts every car with a full tank', () => {
    const s = createRace(humanVsAi);
    for (const c of s.cars) expect(c.fuel).toBe(1);
  });

  it('burns fuel faster at throttle than when coasting', () => {
    const track = getTrack('meadow');
    const p = track.samples[0];
    const drive = (input: PlayerInput, ticks: number, from: GameState) => {
      let s = from;
      for (let i = 0; i < ticks; i++) {
        s.cars[0].x = p.x;
        s.cars[0].y = p.y;
        s = step(s, { 0: input });
      }
      return s;
    };
    const launch = () => {
      let s = createRace({
        trackId: 'meadow',
        totalLaps: 1,
        cars: [{ name: 'T', color: '#fff', controller: 'human', kind: 'f1' }],
        countdownSeconds: 0,
      });
      s.phase = 'racing';
      s.startTick = 0;
      return drive({ throttle: 1, steer: 0, handbrake: false }, 90, s);
    };
    const coast = drive({ throttle: 0, steer: 0, handbrake: false }, 90, launch());
    const gas = drive({ throttle: 1, steer: 0, handbrake: false }, 90, launch());
    expect(gas.cars[0].fuel).toBeLessThan(coast.cars[0].fuel);
    expect(coast.cars[0].fuel).toBeLessThan(1);
  });

  it('makes an empty tank much slower than a full tank', () => {
    const track = getTrack('meadow');
    const p = track.samples[0];
    const speedAfter = (fuel: number, ticks: number) => {
      let s = createRace({
        trackId: 'meadow',
        totalLaps: 1,
        cars: [{ name: 'T', color: '#fff', controller: 'human', kind: 'f1' }],
        countdownSeconds: 0,
      });
      s.phase = 'racing';
      s.startTick = 0;
      s.cars[0].fuel = fuel;
      for (let i = 0; i < ticks; i++) {
        s.cars[0].x = p.x;
        s.cars[0].y = p.y;
        s = step(s, { 0: { throttle: 1, steer: 0, handbrake: false } });
      }
      return Math.hypot(s.cars[0].vx, s.cars[0].vy);
    };
    const empty = speedAfter(0, 120);
    const full = speedAfter(1, 120);
    expect(empty).toBeLessThan(full * 0.7);
    expect(empty).toBeGreaterThan(full * 0.3);
  });

  it('makes a low tank a bit faster than a full tank before empty', () => {
    const track = getTrack('meadow');
    const p = track.samples[0];
    const speedAfter = (fuel: number, ticks: number) => {
      let s = createRace({
        trackId: 'meadow',
        totalLaps: 1,
        cars: [{ name: 'T', color: '#fff', controller: 'human', kind: 'f1' }],
        countdownSeconds: 0,
      });
      s.phase = 'racing';
      s.startTick = 0;
      s.cars[0].fuel = fuel;
      for (let i = 0; i < ticks; i++) {
        s.cars[0].x = p.x;
        s.cars[0].y = p.y;
        s.cars[0].fuel = fuel;
        s = step(s, { 0: { throttle: 1, steer: 0, handbrake: false } });
      }
      return Math.hypot(s.cars[0].vx, s.cars[0].vy);
    };
    expect(speedAfter(0.12, 120)).toBeGreaterThan(speedAfter(1, 120));
  });

  it('gives worn tyres less grip than fresh tyres', () => {
    const lateralAfter = (wear: number) => {
      let s = createRace({
        trackId: 'meadow',
        totalLaps: 1,
        cars: [{ name: 'T', color: '#fff', controller: 'human', kind: 'f1' }],
        countdownSeconds: 0,
      });
      s.phase = 'racing';
      s.startTick = 0;
      const car = s.cars[0];
      car.tyreWear = wear;
      const a = car.angle;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      car.vx = 400 * ca - 220 * sa;
      car.vy = 400 * sa + 220 * ca;
      for (let i = 0; i < 8; i++) s = step(s, { 0: { throttle: 0, steer: 0, handbrake: false } });
      const c = s.cars[0];
      return Math.abs(-c.vx * Math.sin(c.angle) + c.vy * Math.cos(c.angle));
    };
    expect(lateralAfter(1)).toBeGreaterThan(lateralAfter(0) * 1.35);
  });

  it('keeps obstacles off the racing surface', () => {
    const track = getTrack('meadow');
    for (const o of TRACKS.meadow.obstacles) {
      // Cones sit on the edge of the road on purpose; they get knocked away.
      if (o.kind === 'cone') continue;
      expect(distanceToCenterline(track, o.x, o.y)).toBeGreaterThan(track.def.halfWidth + o.r);
    }
  });
});

describe('pit stops', () => {
  const track = getTrack('meadow');
  const box = track.def.pitBoxes[0];
  const boxX = box.x + box.w / 2;
  const boxY = box.y + box.h / 2;

  function racingSolo(): GameState {
    const s = createRace({
      trackId: 'meadow',
      totalLaps: 1,
      cars: [{ name: 'T', color: '#fff', controller: 'human' }],
      countdownSeconds: 0,
    });
    s.phase = 'racing';
    s.startTick = 0;
    return s;
  }

  function parkInBox(s: GameState, fuel: number, tyreWear: number, vx = 0, vy = 0) {
    const car = s.cars[0];
    car.x = boxX;
    car.y = boxY;
    car.vx = vx;
    car.vy = vy;
    car.angle = 0;
    car.fuel = fuel;
    car.tyreWear = tyreWear;
  }

  it('has four marked pit boxes off the racing line but on asphalt', () => {
    for (const id of ['meadow', 'harbor'] as const) {
      const t = getTrack(id);
      expect(t.def.pitBoxes).toHaveLength(4);
      const seen = new Set<number>();
      for (const b of t.def.pitBoxes) {
        const cx = b.x + b.w / 2;
        const cy = b.y + b.h / 2;
        expect(distanceToCenterline(t, cx, cy)).toBeGreaterThan(t.def.halfWidth);
        expect(surfaceAt(t, cx, cy)).toBe('asphalt');
        const idx = pitBoxIndex(t, cx, cy);
        expect(idx).toBeGreaterThanOrEqual(0);
        seen.add(idx);
      }
      expect(seen.size).toBe(4);
    }
    expect(surfaceAt(track, 30, 30)).toBe('grass');
  });

  it('refills fuel and tyres over ticks while stopped in a pit box', () => {
    let s = racingSolo();
    parkInBox(s, 0.2, 0.8);
    const ticks = (n: number) => {
      for (let i = 0; i < n; i++) s = step(s, { 0: { throttle: 0, steer: 0, handbrake: false } });
    };
    ticks(20);
    expect(s.cars[0].fuel).toBeGreaterThan(0.2);
    expect(s.cars[0].fuel).toBeLessThan(0.55);
    expect(s.cars[0].tyreWear).toBeLessThan(0.8);
    expect(s.cars[0].tyreWear).toBeGreaterThan(0.45);
    const midFuel = s.cars[0].fuel;
    const midWear = s.cars[0].tyreWear;
    ticks(20);
    expect(s.cars[0].fuel).toBeGreaterThan(midFuel);
    expect(s.cars[0].tyreWear).toBeLessThan(midWear);
    ticks(200);
    expect(s.cars[0].fuel).toBe(1);
    expect(s.cars[0].tyreWear).toBe(0);
  });

  it('does not refill while moving in a pit box', () => {
    let s = racingSolo();
    parkInBox(s, 0.2, 0.8, 90, 0);
    for (let i = 0; i < 30; i++) {
      s.cars[0].x = boxX;
      s.cars[0].y = boxY;
      s.cars[0].vx = 90;
      s.cars[0].vy = 0;
      s = step(s, { 0: { throttle: 0, steer: 0, handbrake: false } });
    }
    expect(s.cars[0].fuel).toBeLessThanOrEqual(0.2);
    expect(s.cars[0].tyreWear).toBeGreaterThanOrEqual(0.8 - 1e-6);
  });

  it('does not refill when stopped off the pit boxes', () => {
    let s = racingSolo();
    const p = track.samples[0];
    const car = s.cars[0];
    car.x = p.x;
    car.y = p.y;
    car.vx = 0;
    car.vy = 0;
    car.fuel = 0.2;
    car.tyreWear = 0.8;
    for (let i = 0; i < 40; i++) s = step(s, { 0: { throttle: 0, steer: 0, handbrake: false } });
    expect(s.cars[0].fuel).toBeCloseTo(0.2, 5);
    expect(s.cars[0].tyreWear).toBeCloseTo(0.8, 5);
    expect(pitBoxIndex(track, s.cars[0].x, s.cars[0].y)).toBe(-1);
  });

  it('stops refill after leaving the box mid-stop', () => {
    let s = racingSolo();
    parkInBox(s, 0.2, 0.8);
    for (let i = 0; i < 30; i++) s = step(s, { 0: { throttle: 0, steer: 0, handbrake: false } });
    const fuel = s.cars[0].fuel;
    const wear = s.cars[0].tyreWear;
    expect(fuel).toBeGreaterThan(0.2);
    expect(wear).toBeLessThan(0.8);
    const p = track.samples[0];
    s.cars[0].x = p.x;
    s.cars[0].y = p.y;
    s.cars[0].vx = 0;
    s.cars[0].vy = 0;
    for (let i = 0; i < 40; i++) s = step(s, { 0: { throttle: 0, steer: 0, handbrake: false } });
    expect(s.cars[0].fuel).toBeCloseTo(fuel, 5);
    expect(s.cars[0].tyreWear).toBeCloseTo(wear, 5);
  });

  it('applies the same service in stepOwnCar as in step', () => {
    const a0 = racingSolo();
    parkInBox(a0, 0.25, 0.7);
    const b0: GameState = JSON.parse(JSON.stringify(a0));
    const input: PlayerInput = { throttle: 0, steer: 0, handbrake: false };
    let a = a0;
    let b = b0;
    for (let i = 0; i < 45; i++) {
      a = step(a, { 0: input });
      b = stepOwnCar(b, 0, input);
    }
    expect(b.cars[0].fuel).toBeCloseTo(a.cars[0].fuel, 10);
    expect(b.cars[0].tyreWear).toBeCloseTo(a.cars[0].tyreWear, 10);
  });

  it('refills both resources at the published pit rate', () => {
    let s = racingSolo();
    parkInBox(s, 0, 1);
    s = step(s, { 0: { throttle: 0, steer: 0, handbrake: false } });
    const d = PIT.refillPerSecond / 60;
    expect(s.cars[0].fuel).toBeCloseTo(d, 8);
    expect(s.cars[0].tyreWear).toBeCloseTo(1 - d, 8);
  });

  it('repairs damage over ticks while stopped in a pit box', () => {
    let s = racingSolo();
    parkInBox(s, 1, 0);
    s.cars[0].damage = 0.8;
    const ticks = (n: number) => {
      for (let i = 0; i < n; i++) s = step(s, { 0: { throttle: 0, steer: 0, handbrake: false } });
    };
    ticks(20);
    expect(s.cars[0].damage).toBeLessThan(0.8);
    expect(s.cars[0].damage).toBeGreaterThan(0.5);
    const mid = s.cars[0].damage;
    ticks(20);
    expect(s.cars[0].damage).toBeLessThan(mid);
    ticks(200);
    expect(s.cars[0].damage).toBe(0);
  });

  it('repairs damage at the published pit rate', () => {
    let s = racingSolo();
    parkInBox(s, 1, 0);
    s.cars[0].damage = 1;
    s = step(s, { 0: { throttle: 0, steer: 0, handbrake: false } });
    const d = PIT.refillPerSecond / 60;
    expect(s.cars[0].damage).toBeCloseTo(1 - d, 8);
  });
});

describe('crash damage', () => {
  function racingSolo(): GameState {
    const s = createRace({
      trackId: 'meadow',
      totalLaps: 1,
      cars: [{ name: 'T', color: '#fff', controller: 'human', kind: 'f1' }],
      countdownSeconds: 0,
    });
    s.phase = 'racing';
    s.startTick = 0;
    return s;
  }

  it('starts every car undamaged', () => {
    const s = createRace(humanVsAi);
    for (const c of s.cars) expect(c.damage).toBe(0);
  });

  it('raises damage when a car hits a solid object', () => {
    const track = getTrack('meadow');
    const tree = track.def.obstacles.find((o) => o.kind === 'tree')!;
    let s = racingSolo();
    const car = s.cars[0];
    car.x = tree.x - 20;
    car.y = tree.y;
    car.angle = 0;
    car.vx = 320;
    car.vy = 0;
    s = step(s, { 0: { throttle: 0, steer: 0, handbrake: false } });
    expect(s.cars[0].damage).toBeGreaterThan(0.05);
  });

  it('adds more damage from a hard hit than a graze', () => {
    const track = getTrack('meadow');
    const tree = track.def.obstacles.find((o) => o.kind === 'tree')!;
    const hit = (speed: number) => {
      let s = racingSolo();
      s.cars[0].x = tree.x - 20;
      s.cars[0].y = tree.y;
      s.cars[0].angle = 0;
      s.cars[0].vx = speed;
      s.cars[0].vy = 0;
      s = step(s, { 0: { throttle: 0, steer: 0, handbrake: false } });
      return s.cars[0].damage;
    };
    const graze = hit(70);
    const hard = hit(380);
    expect(graze).toBeGreaterThan(0);
    expect(graze).toBeLessThan(0.04);
    expect(hard).toBeGreaterThan(graze * 4);
  });

  it('raises damage when two cars collide', () => {
    let s = createRace({
      trackId: 'meadow',
      totalLaps: 1,
      cars: [
        { name: 'A', color: '#e33', controller: 'human' },
        { name: 'B', color: '#36f', controller: 'human' },
      ],
      countdownSeconds: 0,
    });
    s.phase = 'racing';
    s.startTick = 0;
    s.cars[0].x = 400;
    s.cars[0].y = 400;
    s.cars[0].angle = 0;
    s.cars[0].vx = 260;
    s.cars[0].vy = 0;
    s.cars[1].x = 418;
    s.cars[1].y = 400;
    s.cars[1].angle = Math.PI;
    s.cars[1].vx = -260;
    s.cars[1].vy = 0;
    s = step(s, {});
    expect(s.cars[0].damage).toBeGreaterThan(0.05);
    expect(s.cars[1].damage).toBeGreaterThan(0.05);
  });

  it('does not raise damage when nothing is hit', () => {
    const track = getTrack('meadow');
    const p = track.samples[0];
    let s = racingSolo();
    for (let i = 0; i < 90; i++) {
      s.cars[0].x = p.x;
      s.cars[0].y = p.y;
      s = step(s, { 0: { throttle: 1, steer: 0, handbrake: false } });
    }
    expect(s.cars[0].damage).toBe(0);
  });

  it('makes a wrecked car slower, but a hurt car is not a crawl', () => {
    const track = getTrack('meadow');
    const p = track.samples[0];
    const speedAfter = (damage: number) => {
      let s = racingSolo();
      s.cars[0].damage = damage;
      for (let i = 0; i < 120; i++) {
        s.cars[0].x = p.x;
        s.cars[0].y = p.y;
        s = step(s, { 0: { throttle: 1, steer: 0, handbrake: false } });
      }
      return Math.hypot(s.cars[0].vx, s.cars[0].vy);
    };
    const wrecked = speedAfter(1);
    const hurt = speedAfter(0.45);
    const fine = speedAfter(0);
    expect(hurt).toBeLessThan(fine);
    expect(hurt).toBeGreaterThan(fine * 0.78);
    expect(wrecked).toBeLessThan(hurt);
    expect(wrecked).toBeLessThan(fine * 0.72);
    expect(wrecked).toBeGreaterThan(fine * 0.28);
  });

  it('still steers when wrecked', () => {
    let s = racingSolo();
    const car = s.cars[0];
    car.damage = 1;
    const a = car.angle;
    car.vx = 90 * Math.cos(a);
    car.vy = 90 * Math.sin(a);
    s = step(s, { 0: { throttle: 0.3, steer: 1, handbrake: false } });
    expect(Math.abs(s.cars[0].angle - a)).toBeGreaterThan(0.01);
  });
});

describe('AI pit stops', () => {
  function aiRace(trackId: string): GameState {
    const s = createRace({
      trackId,
      totalLaps: 5,
      cars: [{ name: 'AI', color: '#36f', controller: 'ai', kind: 'f1' }],
      countdownSeconds: 0,
    });
    s.phase = 'racing';
    s.startTick = 0;
    return s;
  }

  function placeApproach(s: GameState) {
    const track = getTrack(s.trackId);
    const i = track.samples.length - 8;
    const p = track.samples[i];
    const car = s.cars[0];
    car.x = p.x;
    car.y = p.y;
    car.angle = track.tangentAngles[i];
    car.vx = 0;
    car.vy = 0;
  }

  function runUntil(s0: GameState, ticks: number, pred: (s: GameState) => boolean): GameState {
    let s = s0;
    for (let i = 0; i < ticks; i++) {
      s = step(s, {});
      if (pred(s)) return s;
    }
    return s;
  }

  it('heads to a pit box and stops when fuel is near empty', () => {
    const track = getTrack('meadow');
    let s = aiRace('meadow');
    placeApproach(s);
    s.cars[0].fuel = 0.05;
    s.cars[0].tyreWear = 0;
    s.cars[0].damage = 0;
    const startFuel = s.cars[0].fuel;
    s = runUntil(s, 60 * 14, (st) => isStoppedInPit(track, st.cars[0]));
    expect(isStoppedInPit(track, s.cars[0])).toBe(true);
    s = step(s, {});
    expect(s.cars[0].ai?.pitPhase).toBe('box');
    const stoppedFuel = s.cars[0].fuel;
    s = runUntil(s, 60 * 4, (st) => st.cars[0].fuel >= AI_PIT.fuelOk);
    expect(s.cars[0].fuel).toBeGreaterThan(stoppedFuel);
    expect(s.cars[0].fuel).toBeGreaterThan(startFuel);
  });

  it('heads to a pit box and stops when tyres are worn out', () => {
    const track = getTrack('meadow');
    let s = aiRace('meadow');
    placeApproach(s);
    s.cars[0].fuel = 1;
    s.cars[0].tyreWear = 0.95;
    s.cars[0].damage = 0;
    s = runUntil(s, 60 * 14, (st) => isStoppedInPit(track, st.cars[0]));
    expect(isStoppedInPit(track, s.cars[0])).toBe(true);
    const wear = s.cars[0].tyreWear;
    s = runUntil(s, 60 * 4, (st) => st.cars[0].tyreWear <= AI_PIT.tyreOk);
    expect(s.cars[0].tyreWear).toBeLessThan(wear);
    expect(s.cars[0].tyreWear).toBeLessThan(0.9);
  });

  it('heads to a pit box and stops when damage is high', () => {
    const track = getTrack('meadow');
    let s = aiRace('meadow');
    placeApproach(s);
    s.cars[0].fuel = 1;
    s.cars[0].tyreWear = 0;
    s.cars[0].damage = 0.88;
    s = runUntil(s, 60 * 14, (st) => isStoppedInPit(track, st.cars[0]));
    expect(isStoppedInPit(track, s.cars[0])).toBe(true);
    const dmg = s.cars[0].damage;
    s = runUntil(s, 60 * 4, (st) => st.cars[0].damage <= AI_PIT.damageOk);
    expect(s.cars[0].damage).toBeLessThan(dmg);
  });

  it('does not pit when healthy', () => {
    const track = getTrack('meadow');
    let s = aiRace('meadow');
    placeApproach(s);
    s.cars[0].fuel = 1;
    s.cars[0].tyreWear = 0;
    s.cars[0].damage = 0;
    let inBox = false;
    for (let i = 0; i < 60 * 8; i++) {
      s = step(s, {});
      if (pitBoxIndex(track, s.cars[0].x, s.cars[0].y) >= 0) inBox = true;
    }
    expect(inBox).toBe(false);
    expect(s.cars[0].ai?.pitPhase).toBe('race');
    expect(s.cars[0].x).toBeGreaterThan(getTrack('meadow').def.pitLane.x + 80);
  });

  it('pits on harbor as well as meadow', () => {
    const track = getTrack('harbor');
    let s = aiRace('harbor');
    placeApproach(s);
    s.cars[0].fuel = 0.04;
    s.cars[0].tyreWear = 0.94;
    s.cars[0].damage = 0;
    s = runUntil(s, 60 * 14, (st) => isStoppedInPit(track, st.cars[0]));
    expect(isStoppedInPit(track, s.cars[0])).toBe(true);
    expect(pitBoxIndex(track, s.cars[0].x, s.cars[0].y)).toBeGreaterThanOrEqual(0);
  });

  it('takes a later stall when the first three are busy', () => {
    const track = getTrack('meadow');
    let s = createRace({
      trackId: 'meadow',
      totalLaps: 5,
      cars: [
        { name: 'AI', color: '#36f', controller: 'ai', kind: 'f1' },
        { name: 'Park 1', color: '#e33', controller: 'human' },
        { name: 'Park 2', color: '#3a8', controller: 'human' },
        { name: 'Park 3', color: '#fc3', controller: 'human' },
      ],
      countdownSeconds: 0,
    });
    s.phase = 'racing';
    s.startTick = 0;
    placeApproach(s);
    s.cars[0].fuel = 0.05;
    s.cars[0].tyreWear = 0.92;
    s.cars[0].damage = 0.8;
    for (let i = 0; i < 3; i++) {
      const b = track.def.pitBoxes[i];
      const car = s.cars[i + 1];
      car.x = b.x + b.w / 2;
      car.y = b.y + b.h / 2;
      car.vx = 0;
      car.vy = 0;
      car.angle = 0;
    }
    s = runUntil(s, 60 * 14, (st) => isStoppedInPit(track, st.cars[0]));
    expect(pitBoxIndex(track, s.cars[0].x, s.cars[0].y)).toBe(3);
  });

  it('skips the pits when every stall is busy instead of blocking the racing line', () => {
    const track = getTrack('meadow');
    let s = createRace({
      trackId: 'meadow',
      totalLaps: 5,
      cars: [
        { name: 'AI', color: '#36f', controller: 'ai', kind: 'f1' },
        { name: 'Park 1', color: '#e33', controller: 'human' },
        { name: 'Park 2', color: '#3a8', controller: 'human' },
        { name: 'Park 3', color: '#fc3', controller: 'human' },
        { name: 'Park 4', color: '#3f6', controller: 'human' },
      ],
      countdownSeconds: 0,
    });
    s.phase = 'racing';
    s.startTick = 0;
    placeApproach(s);
    s.cars[0].fuel = 0.05;
    s.cars[0].tyreWear = 0.92;
    s.cars[0].damage = 0.8;
    track.def.pitBoxes.forEach((b, i) => {
      const car = s.cars[i + 1];
      car.x = b.x + b.w / 2;
      car.y = b.y + b.h / 2;
      car.vx = 0;
      car.vy = 0;
      car.angle = 0;
    });
    const racingY = track.samples[0].y;
    let stoppedOnLine = 0;
    for (let i = 0; i < 60 * 12; i++) {
      s = step(s, {});
      const ai = s.cars[0];
      const speed = Math.hypot(ai.vx, ai.vy);
      const onLine = Math.abs(ai.y - racingY) < 40 && pitBoxIndex(track, ai.x, ai.y) < 0;
      if (onLine && speed < 12 && i > 90) stoppedOnLine++;
    }
    expect(pitBoxIndex(track, s.cars[0].x, s.cars[0].y)).toBe(-1);
    const lastBox = track.def.pitBoxes[track.def.pitBoxes.length - 1];
    expect(s.cars[0].x).toBeGreaterThan(lastBox.x + lastBox.w - 80);
    expect(stoppedOnLine).toBeLessThan(45);
  });

  it('is deterministic with pit decisions', () => {
    const start = () => {
      const s = aiRace('meadow');
      placeApproach(s);
      s.cars[0].fuel = 0.06;
      s.cars[0].tyreWear = 0.91;
      s.cars[0].damage = 0.8;
      return s;
    };
    let a = start();
    let b = start();
    for (let i = 0; i < 400; i++) {
      a = step(a, {});
      b = step(b, {});
    }
    expect(hashState(a)).toBe(hashState(b));
  });

  it('approaches the pits at race pace and only slows in the box', () => {
    const track = getTrack('meadow');
    const launch = (fuel: number, wear: number) => {
      const s = aiRace('meadow');
      placeApproach(s);
      s.cars[0].fuel = fuel;
      s.cars[0].tyreWear = wear;
      s.cars[0].damage = 0;
      return s;
    };
    let needy = launch(0.1, 0);
    let healthy = launch(1, 0);
    let lineTicks = 0;
    let needyLine = 0;
    let healthyLine = 0;
    let maxNeedyOnLine = 0;
    let stopped = false;
    for (let i = 0; i < 60 * 12; i++) {
      needy = step(needy, {});
      healthy = step(healthy, {});
      const nCar = needy.cars[0];
      if (isStoppedInPit(track, nCar)) stopped = true;
      if (stopped || inPitLane(track, nCar.x, nCar.y) || pitBoxIndex(track, nCar.x, nCar.y) >= 0) continue;
      const ns = Math.hypot(nCar.vx, nCar.vy);
      needyLine += ns;
      healthyLine += Math.hypot(healthy.cars[0].vx, healthy.cars[0].vy);
      if (ns > maxNeedyOnLine) maxNeedyOnLine = ns;
      lineTicks++;
    }
    expect(lineTicks).toBeGreaterThan(20);
    expect(maxNeedyOnLine).toBeGreaterThan(280);
    expect(needyLine / lineTicks).toBeGreaterThan((healthyLine / lineTicks) * 0.85);
    expect(stopped).toBe(true);
  });
});
