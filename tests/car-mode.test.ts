import { describe, expect, it } from 'vitest';
import { gridCars } from '../src/client/game';
import { parseCarMode, spawnAiKind, spawnKind } from '../src/sim';

describe('car mode', () => {
  it('parses mixed and F1 and rejects the rest', () => {
    expect(parseCarMode('mixed')).toBe('mixed');
    expect(parseCarMode('f1')).toBe('f1');
    expect(parseCarMode('rally')).toBeNull();
    expect(parseCarMode('')).toBeNull();
  });

  it('F1 mode forces F1; mixed keeps the pick', () => {
    expect(spawnKind('rally', 'f1')).toBe('f1');
    expect(spawnKind('f1', 'f1')).toBe('f1');
    expect(spawnKind('rally', 'mixed')).toBe('rally');
    expect(spawnKind('f1', 'mixed')).toBe('f1');
    expect(spawnKind(undefined, 'mixed')).toBe('rally');
  });

  it('F1 mode makes every AI F1; mixed still fills the missing body', () => {
    expect(spawnAiKind(0, ['rally'], 'f1')).toBe('f1');
    expect(spawnAiKind(1, ['rally'], 'f1')).toBe('f1');
    expect(spawnAiKind(0, ['rally'], 'mixed')).toBe('f1');
    expect(spawnAiKind(0, ['f1'], 'mixed')).toBe('rally');
    expect(spawnAiKind(1, ['f1'], 'mixed')).toBe('rally');
  });

  it('local F1 grid is all Formula 1 with unique colors; mixed is unchanged', () => {
    const f1 = gridCars({ humans: 1, aiCount: 3, laps: 3, p1Car: 'rally', carMode: 'f1' });
    expect(f1.map((c) => c.kind)).toEqual(['f1', 'f1', 'f1', 'f1']);
    expect(new Set(f1.map((c) => c.color)).size).toBe(4);

    const mixed = gridCars({ humans: 1, aiCount: 1, laps: 3, p1Car: 'f1' });
    expect(mixed.map((c) => c.kind)).toEqual(['f1', 'rally']);

    const bothRally = gridCars({ humans: 2, aiCount: 2, laps: 3, p1Car: 'rally', p2Car: 'rally' });
    expect(bothRally.map((c) => c.kind)).toEqual(['rally', 'rally', 'f1', 'rally']);
  });
});
