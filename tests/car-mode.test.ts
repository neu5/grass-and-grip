import { describe, expect, it } from 'vitest';
import { gridCars } from '../src/client/game';
import { parseCarMode, spawnAiKind, spawnKind } from '../src/sim';

describe('car mode', () => {
  it('parses mixed and every car kind, and rejects the rest', () => {
    expect(parseCarMode('mixed')).toBe('mixed');
    for (const k of ['rally', 'f1', 'buggy', 'truck', 'kart']) expect(parseCarMode(k)).toBe(k);
    expect(parseCarMode('tank')).toBeNull();
    expect(parseCarMode('')).toBeNull();
  });

  it('F1 mode forces F1; mixed keeps the pick', () => {
    expect(spawnKind('rally', 'f1')).toBe('f1');
    expect(spawnKind('f1', 'f1')).toBe('f1');
    expect(spawnKind('rally', 'mixed')).toBe('rally');
    expect(spawnKind('f1', 'mixed')).toBe('f1');
    expect(spawnKind(undefined, 'mixed')).toBe('rally');
  });

  it('one-make modes force that kind; mixed AI shows every body, missing ones first', () => {
    expect(spawnKind('rally', 'kart')).toBe('kart');
    expect(spawnAiKind(0, ['rally'], 'f1')).toBe('f1');
    expect(spawnAiKind(3, ['rally'], 'truck')).toBe('truck');
    const ai = (humans: ('rally' | 'f1' | 'buggy' | 'truck' | 'kart')[]) =>
      Array.from({ length: 5 }, (_, i) => spawnAiKind(i, humans, 'mixed'));
    expect(ai(['rally'])).toEqual(['f1', 'buggy', 'truck', 'kart', 'rally']);
    expect(ai(['f1'])).toEqual(['rally', 'buggy', 'truck', 'kart', 'f1']);
    expect(new Set(ai([])).size).toBe(5);
  });

  it('local F1 grid is all Formula 1 with unique colors; mixed spreads the AI', () => {
    const f1 = gridCars({ humans: 1, aiCount: 3, laps: 3, p1Car: 'rally', carMode: 'f1' });
    expect(f1.map((c) => c.kind)).toEqual(['f1', 'f1', 'f1', 'f1']);
    expect(new Set(f1.map((c) => c.color)).size).toBe(4);

    const mixed = gridCars({ humans: 1, aiCount: 1, laps: 3, p1Car: 'f1' });
    expect(mixed.map((c) => c.kind)).toEqual(['f1', 'rally']);

    const bothRally = gridCars({ humans: 2, aiCount: 2, laps: 3, p1Car: 'rally', p2Car: 'rally' });
    expect(bothRally.map((c) => c.kind)).toEqual(['rally', 'rally', 'f1', 'buggy']);
  });
});
