import type { CarConfig } from './types';

/** 'random' shuffles the field; a list of driver names lines them up in that order, pole first. */
export type GridOrder = 'random' | string[];

/** Put the cars on the grid in the requested order; slot 0 is pole. */
export function orderGrid(cars: CarConfig[], grid: GridOrder | undefined, random = Math.random): CarConfig[] {
  if (!grid) return cars;
  if (grid === 'random') {
    const out = cars.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
  // Named drivers in that order; anyone not named keeps their order at the back.
  const rank = (c: CarConfig) => {
    const i = grid.indexOf(c.name);
    return i < 0 ? grid.length : i;
  };
  return cars
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i)
    .map(({ c }) => c);
}
