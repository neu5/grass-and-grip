import { describe, expect, it } from 'vitest';
import { newSeason, scoreRound, seasonGrid } from '../src/client/championship';
import { Game, gridCars, type GameOptions } from '../src/client/game';
import { BINDINGS_P2, BINDINGS_SOLO, type KeyBindings, type Keyboard } from '../src/client/input';
import type { Renderer3D } from '../src/client/renderer3d';
import { CAR_COLORS } from '../src/net/protocol';
import { RESULTS_TICKS, Room } from '../src/net/room';
import { orderGrid, type PlayerInput, type TickInputs } from '../src/sim';

const base: GameOptions = { humans: 1, aiCount: 7, laps: 1 };

/** Seeded stand-in for Math.random. */
function seeded(seed: number) {
  return () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}

describe('grid order', () => {
  it('keeps players first by default', () => {
    expect(orderGrid(gridCars(base), undefined).map((c) => c.controller)[0]).toBe('human');
  });

  it('shuffles the whole field for a random grid, a different way each time', () => {
    const cars = gridCars(base);
    const rnd = seeded(7);
    const orders = Array.from({ length: 20 }, () => orderGrid(cars, 'random', rnd).map((c) => c.name).join());
    for (const o of orders) expect(o.split(',').sort()).toEqual(cars.map((c) => c.name).sort());
    expect(new Set(orders).size).toBeGreaterThan(10);
    // Player 1 does not always start on pole.
    expect(orders.some((o) => !o.startsWith('Player 1'))).toBe(true);
  });

  it('follows a list of names, pole first, with anyone unnamed at the back', () => {
    const cars = gridCars(base);
    const order = orderGrid(cars, ['Kenji', 'Player 1', 'Rosa']).map((c) => c.name);
    expect(order.slice(0, 3)).toEqual(['Kenji', 'Player 1', 'Rosa']);
    expect(order).toHaveLength(cars.length);
  });
});

describe('championship grid', () => {
  it('is random for the first race, then the championship order: leader first, last place last', () => {
    const drivers = ['A', 'B', 'C', 'D'].map((name) => ({ name, color: '#fff', kind: 'rally' as const }));
    let season = newSeason(['meadow', 'harbor', 'alpine'], drivers, {});
    expect(seasonGrid(season)).toBe('random');
    season = scoreRound(season, ['C', 'A', 'D', 'B']);
    expect(seasonGrid(season)).toEqual(['C', 'A', 'D', 'B']);
    season = scoreRound(season, ['A', 'B', 'D', 'C']);
    // A 8 + 10 = 18, C 10 + 5 = 15, B 5 + 8 = 13, D 6 + 6 = 12.
    expect(seasonGrid(season)).toEqual(['A', 'C', 'B', 'D']);
  });
});

describe('players on a shuffled grid', () => {
  function game(options: GameOptions) {
    const renderer = { setTrack() {}, resetRace() {} } as unknown as Renderer3D;
    const press = (b: KeyBindings): PlayerInput => ({
      throttle: b === BINDINGS_P2 ? -1 : 1,
      steer: b === BINDINGS_SOLO ? 0.5 : 0,
      handbrake: false,
    });
    const keyboard = { sample: press } as unknown as Keyboard;
    return new Game(renderer, keyboard, options) as unknown as { state: { cars: { name: string }[] }; sampleInputs(): TickInputs; humanIds: number[] };
  }

  it("drives each player's own car wherever it starts", () => {
    for (let i = 0; i < 10; i++) {
      const g = game({ ...base, humans: 2, aiCount: 6, p1Name: 'Ada', p2Name: 'Bo', grid: 'random' });
      const [p1, p2] = g.humanIds;
      expect(g.state.cars[p1].name).toBe('Ada');
      expect(g.state.cars[p2].name).toBe('Bo');
      const inputs = g.sampleInputs();
      expect(inputs[p1]?.throttle).toBe(1);
      expect(inputs[p2]?.throttle).toBe(-1);
      expect(Object.keys(inputs)).toHaveLength(2);
    }
    const solo = game({ ...base, grid: ['Rosa', 'Kenji'] });
    expect(solo.humanIds[0]).toBe(2);
    expect(solo.sampleInputs()[2]?.steer).toBe(0.5);
  });
});

describe('online room grid', () => {
  it('shuffles every race and seats each player in their own car', () => {
    const room = new Room('grid', seeded(3));
    room.join('p0', 'Ada', CAR_COLORS[0], 'f1');
    room.join('p1', 'Ada', CAR_COLORS[1], 'truck');
    room.setSettings('p0', { aiCount: 6, laps: 1 });
    const grids = new Set<string>();
    let p0Pole = 0;
    for (let race = 0; race < 12; race++) {
      room.setReady('p0', true);
      room.setReady('p1', true);
      const cars = room.race!.cars;
      const seats = room.view().cars;
      // Same name on purpose: seats follow the player, not the name.
      expect(cars[seats.p0]).toMatchObject({ controller: 'human', color: CAR_COLORS[0], kind: 'f1' });
      expect(cars[seats.p1]).toMatchObject({ controller: 'human', color: CAR_COLORS[1], kind: 'truck' });
      grids.add(cars.map((c) => c.color).join());
      if (seats.p0 === 0) p0Pole++;
      room.race!.phase = 'racing';
      for (const car of cars) car.finishTick = 1;
      room.tick();
      for (let i = 0; i < RESULTS_TICKS; i++) room.tick();
      expect(room.phase).toBe('lobby');
    }
    expect(grids.size).toBeGreaterThan(8);
    expect(p0Pole).toBeLessThan(12);
  });
});
