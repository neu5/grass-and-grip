import { describe, expect, it } from 'vitest';
import { decodeSnapshot, encodeSnapshot } from '../src/net/snapshot';
import { Room } from '../src/net/room';
import { CAR_COLORS } from '../src/net/protocol';
import {
  CAR_KINDS,
  carStats,
  createRace,
  DEFAULT_RULES,
  normalizeRules,
  normalizeSetup,
  step,
  TRACK_IDS,
  type CarKind,
  type CarSetup,
  type CarState,
  type GameState,
  type RaceRules,
} from '../src/sim';
import { collideCars, stepCarPhysics } from '../src/sim/physics';
import type { Surface } from '../src/sim/track';

function lone(kind: CarKind, setup?: CarSetup): CarState {
  const s = createRace({
    trackId: 'meadow',
    totalLaps: 1,
    cars: [{ name: 'T', color: '#fff', controller: 'human', kind, setup }],
    countdownSeconds: 0,
  });
  const car = s.cars[0];
  car.vx = 0;
  car.vy = 0;
  car.angle = 0;
  return car;
}

/** Full throttle straight ahead on one surface; speed after `ticks`. */
function speedAfter(kind: CarKind, surface: Surface, ticks: number, setup?: CarSetup): number {
  const car = lone(kind, setup);
  for (let i = 0; i < ticks; i++) stepCarPhysics(car, { throttle: 1, steer: 0, handbrake: false }, surface, 1 / 60);
  return Math.hypot(car.vx, car.vy);
}

describe('car kinds', () => {
  it('has five kinds, each with its own stats', () => {
    expect([...CAR_KINDS]).toEqual(['rally', 'f1', 'buggy', 'truck', 'kart']);
    for (const k of CAR_KINDS) expect(carStats({ kind: k }).engineAccel).toBeGreaterThan(0);
  });

  it('makes the buggy the off-road car: beats rally on grass and sand, loses on asphalt', () => {
    expect(speedAfter('buggy', 'grass', 600)).toBeGreaterThan(speedAfter('rally', 'grass', 600) * 1.15);
    expect(speedAfter('buggy', 'sand', 600)).toBeGreaterThan(speedAfter('rally', 'sand', 600) * 1.15);
    expect(speedAfter('buggy', 'asphalt', 900)).toBeLessThan(speedAfter('rally', 'asphalt', 900));
  });

  it('makes the truck slowest, the kart quick off the line but not the fastest, and F1 fastest', () => {
    const top = (k: CarKind) => speedAfter(k, 'asphalt', 1200);
    expect(top('truck')).toBeLessThan(top('rally'));
    expect(top('f1')).toBeGreaterThan(top('rally'));
    expect(top('kart')).toBeLessThan(top('rally'));
    expect(speedAfter('kart', 'asphalt', 30)).toBeGreaterThan(speedAfter('truck', 'asphalt', 30));
    expect(speedAfter('kart', 'grass', 600)).toBeLessThan(speedAfter('rally', 'grass', 600));
  });

  it('lets a heavy truck shove a light kart', () => {
    const truck = lone('truck');
    const kart = lone('kart');
    truck.x = 0;
    truck.y = 0;
    truck.vx = 120;
    kart.x = 20;
    kart.y = 0;
    kart.vx = -120;
    collideCars(truck, kart);
    expect(kart.vx).toBeGreaterThan(80);
    expect(truck.vx).toBeGreaterThan(0);
  });

  it('hurts the truck less than the kart in the same hit', () => {
    const truck = lone('truck');
    const kart = lone('kart');
    truck.x = 0;
    kart.x = 20;
    truck.vx = 200;
    kart.vx = -200;
    collideCars(truck, kart);
    expect(truck.damage).toBeLessThan(kart.damage);
  });
});

describe('balance', () => {
  it('gives every car a similar lap pace across the tracks (AI, Medium)', () => {
    const lap = (trackId: string, kind: CarKind) => {
      let s = createRace({
        trackId,
        totalLaps: 2,
        countdownSeconds: 0,
        cars: [{ name: 'A', color: '#fff', controller: 'ai', kind }],
        rules: { damage: 1, tyreWear: 0, fuel: 0, collisions: true, aiLevel: 70 },
      });
      s.phase = 'racing';
      for (let i = 0; i < 60 * 60 && s.phase !== 'finished'; i++) s = step(s, {});
      return s.cars[0].bestLapTicks!;
    };
    // Every map: dirt stages favour the buggy and hurt the F1, tarmac the other way round.
    const tracks = [...TRACK_IDS];
    const rally = tracks.map((t) => lap(t, 'rally'));
    for (const kind of CAR_KINDS) {
      // Geometric mean of lap time relative to Rally.
      const ratio = Math.exp(tracks.reduce((sum, t, i) => sum + Math.log(lap(t, kind) / rally[i]), 0) / tracks.length);
      expect(ratio, kind).toBeGreaterThan(0.96);
      expect(ratio, kind).toBeLessThan(1.04);
    }
  }, 90_000);

  it('keeps each car its own strengths', () => {
    // F1 fastest on tarmac, worst off it; buggy best off-road.
    const top = (k: CarKind, surface: Surface) => speedAfter(k, surface, 1500);
    for (const k of CAR_KINDS) if (k !== 'f1') expect(top('f1', 'asphalt')).toBeGreaterThan(top(k, 'asphalt'));
    for (const surface of ['grass', 'sand', 'gravel', 'snow'] as const) {
      for (const k of CAR_KINDS) {
        if (k !== 'f1') expect(top('f1', surface), surface).toBeLessThan(top(k, surface));
        if (k !== 'buggy') expect(top('buggy', surface), surface).toBeGreaterThan(top(k, surface));
      }
    }
  });
});

describe('car setup', () => {
  it('trades acceleration for top speed with gearing', () => {
    const long = { gearing: 2, steering: 0, grip: 0 };
    const short = { gearing: -2, steering: 0, grip: 0 };
    expect(speedAfter('rally', 'asphalt', 1500, long)).toBeGreaterThan(speedAfter('rally', 'asphalt', 1500));
    expect(speedAfter('rally', 'asphalt', 40, short)).toBeGreaterThan(speedAfter('rally', 'asphalt', 40, long));
  });

  it('turns quicker with quick steering and corners harder with more wing', () => {
    expect(carStats({ kind: 'rally', setup: { gearing: 0, steering: 2, grip: 0 } }).steerRate).toBeGreaterThan(
      carStats({ kind: 'rally' }).steerRate,
    );
    expect(carStats({ kind: 'f1', setup: { gearing: 0, steering: 0, grip: 2 } }).lateralGrip).toBeGreaterThan(
      carStats({ kind: 'f1' }).lateralGrip,
    );
  });

  it('clamps setup steps to -2..2 and treats junk as stock', () => {
    expect(normalizeSetup({ gearing: 9, steering: -7, grip: 'x' })).toEqual({ gearing: 2, steering: -2, grip: 0 });
    expect(normalizeSetup(undefined)).toEqual({ gearing: 0, steering: 0, grip: 0 });
  });
});

describe('race rules', () => {
  function raceWith(rules: Partial<RaceRules>, cars = 1): GameState {
    const s = createRace({
      trackId: 'meadow',
      totalLaps: 1,
      cars: Array.from({ length: cars }, (_, i) => ({ name: `T${i}`, color: CAR_COLORS[i], controller: 'human' as const })),
      countdownSeconds: 0,
      rules: { ...DEFAULT_RULES, ...rules },
    });
    s.phase = 'racing';
    s.startTick = 0;
    return s;
  }

  function wearAndBurn(rules: Partial<RaceRules>): { wear: number; fuel: number } {
    let s = raceWith(rules);
    for (let i = 0; i < 240; i++) s = step(s, { 0: { throttle: 1, steer: i % 60 < 30 ? 1 : -1, handbrake: i % 80 < 10 } });
    return { wear: s.cars[0].tyreWear, fuel: s.cars[0].fuel };
  }

  function wallHit(rules: Partial<RaceRules>): number {
    let s = raceWith(rules);
    const car = s.cars[0];
    car.x = 40;
    car.y = 500;
    car.vx = -400;
    car.vy = 0;
    s = step(s, {});
    return s.cars[0].damage;
  }

  it('turns tyre wear, fuel use and damage off, and doubles them', () => {
    const off = wearAndBurn({ tyreWear: 0, fuel: 0 });
    expect(off.wear).toBe(0);
    expect(off.fuel).toBe(1);
    const normal = wearAndBurn({});
    const double = wearAndBurn({ tyreWear: 2, fuel: 2 });
    // Worn tyres slide more and wear faster, so double is a bit over 2×.
    expect(double.wear / normal.wear).toBeGreaterThan(1.9);
    expect(double.wear / normal.wear).toBeLessThan(2.3);
    expect((1 - double.fuel) / (1 - normal.fuel)).toBeCloseTo(2, 1);

    expect(wallHit({ damage: 0 })).toBe(0);
    expect(wallHit({ damage: 2 })).toBeCloseTo(wallHit({}) * 2, 3);
  });

  it('lets cars pass through each other when contact is off', () => {
    const put = (s: GameState) => {
      s.cars[0].x = 500;
      s.cars[0].y = 600;
      s.cars[1].x = 510;
      s.cars[1].y = 600;
    };
    let on = raceWith({}, 2);
    put(on);
    on = step(on, {});
    let off = raceWith({ collisions: false }, 2);
    put(off);
    off = step(off, {});
    expect(Math.abs(on.cars[1].x - on.cars[0].x)).toBeGreaterThan(20);
    expect(Math.abs(off.cars[1].x - off.cars[0].x)).toBeLessThan(11);
  });

  it('keeps defaults for missing or bad rule values', () => {
    expect(normalizeRules({ damage: 5, fuel: 0, collisions: 'yes', aiLevel: 150 })).toEqual({
      ...DEFAULT_RULES,
      fuel: 0,
      aiLevel: 100,
    });
  });
});

describe('network', () => {
  it('round-trips car kind, setup and rules through a snapshot', () => {
    const s = createRace({
      trackId: 'harbor',
      totalLaps: 2,
      cars: [
        { name: 'A', color: CAR_COLORS[0], controller: 'human', kind: 'truck', setup: { gearing: 1, steering: -2, grip: 2 } },
        { name: 'B', color: CAR_COLORS[1], controller: 'ai', kind: 'kart' },
      ],
      rules: { damage: 2, tyreWear: 0, fuel: 1, collisions: false, aiLevel: 35 },
    });
    const back = decodeSnapshot(JSON.parse(JSON.stringify(encodeSnapshot(s))));
    expect(back.cars.map((c) => c.kind)).toEqual(['truck', 'kart']);
    expect(back.cars[0].setup).toEqual({ gearing: 1, steering: -2, grip: 2 });
    expect(back.cars[1].setup).toEqual({ gearing: 0, steering: 0, grip: 0 });
    expect(back.rules).toEqual({ damage: 2, tyreWear: 0, fuel: 1, collisions: false, aiLevel: 35, carDetails: false });
  });

  it('takes setup from players and rules from the host only, into the race', () => {
    const room = new Room('t');
    expect(room.join('p0', 'Host', CAR_COLORS[0], 'buggy', { gearing: 2 })).toBeNull();
    expect(room.join('p1', 'Guest', CAR_COLORS[1], 'kart')).toBeNull();
    expect(room.setSetup('p1', { steering: 1 })).toBeNull();
    expect(room.setSettings('p1', { rules: { damage: 0 } })).toBe('Only the host can change settings');
    expect(room.setSettings('p0', { rules: { damage: 0, collisions: false } })).toBeNull();
    const view = room.view();
    expect(view.rules).toMatchObject({ damage: 0, collisions: false, tyreWear: 1 });
    expect(view.players.map((p) => p.setup)).toEqual([
      { gearing: 2, steering: 0, grip: 0 },
      { gearing: 0, steering: 1, grip: 0 },
    ]);
    room.setSettings('p0', { aiCount: 1 });
    room.setReady('p0', true);
    room.setReady('p1', true);
    expect(room.race?.rules).toMatchObject({ damage: 0, collisions: false });
    const host = room.race!.cars[room.carOf.get('p0')!];
    const guest = room.race!.cars[room.carOf.get('p1')!];
    expect([host.kind, guest.kind]).toEqual(['buggy', 'kart']);
    expect(host.setup).toEqual({ gearing: 2, steering: 0, grip: 0 });
  });
});
