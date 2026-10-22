import { describe, expect, it } from 'vitest';
import { gridCars } from '../src/client/game';
import { AI_NAMES, CAR_COLORS } from '../src/net/protocol';

describe('local drivers', () => {
  it('uses the names and colors the players picked', () => {
    const cars = gridCars({ humans: 2, aiCount: 3, laps: 3, p1Name: ' Kuba ', p1Color: '#9b59d0', p2Name: 'Ola', p2Color: '#f2c230' });
    expect(cars.slice(0, 2).map((c) => [c.name, c.color])).toEqual([
      ['Kuba', '#9b59d0'],
      ['Ola', '#f2c230'],
    ]);
  });

  it('falls back to Player 1 / Player 2 and the first free colors', () => {
    const cars = gridCars({ humans: 2, aiCount: 0, laps: 3, p1Name: '   ', p1Color: 'pink' });
    expect(cars.map((c) => [c.name, c.color])).toEqual([
      ['Player 1', CAR_COLORS[0]],
      ['Player 2', CAR_COLORS[1]],
    ]);
  });

  it('never gives two drivers the same color or name', () => {
    const cars = gridCars({ humans: 2, aiCount: 6, laps: 3, p1Name: 'Rosa', p1Color: '#3a8ee8', p2Name: 'rosa', p2Color: '#3a8ee8' });
    expect(new Set(cars.map((c) => c.color)).size).toBe(cars.length);
    expect(new Set(cars.map((c) => c.name.toLowerCase())).size).toBe(cars.length);
    // The AI driver called Rosa steps aside for the human one.
    expect(cars.filter((c) => c.controller === 'ai').map((c) => c.name)).not.toContain('Rosa');
    expect(cars.filter((c) => c.controller === 'ai').map((c) => c.name)[0]).toBe(AI_NAMES[1]);
  });

  it('cuts long names to 16 characters', () => {
    const [p1] = gridCars({ humans: 1, aiCount: 0, laps: 1, p1Name: 'A very long driver name indeed' });
    expect(p1.name.length).toBe(16);
  });
});
