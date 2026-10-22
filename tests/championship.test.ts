import { describe, expect, it } from 'vitest';
import {
  clearSeason,
  loadSeason,
  newSeason,
  pointsFor,
  raceOrder,
  saveSeason,
  scoreRound,
  seasonOver,
  seasonTable,
} from '../src/client/championship';
import { createRace, step } from '../src/sim';

const drivers = ['Ann', 'Bob', 'Cid', 'Dee'].map((name, i) => ({ name, color: `#${i}${i}${i}`, kind: 'rally' as const }));

function memoryStore() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe('championship', () => {
  it('gives 10-8-6-5-4-3-2-1 points and nothing below 8th', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map(pointsFor)).toEqual([10, 8, 6, 5, 4, 3, 2, 1, 0]);
  });

  it('runs through every track once, then ends', () => {
    let s = newSeason(['meadow', 'harbor'], drivers, {});
    expect(seasonOver(s)).toBe(false);
    s = scoreRound(s, ['Ann', 'Bob', 'Cid', 'Dee']);
    s = scoreRound(s, ['Bob', 'Ann', 'Dee', 'Cid']);
    expect(seasonOver(s)).toBe(true);
    expect(s.results.map((r) => r.trackId)).toEqual(['meadow', 'harbor']);
    expect(scoreRound(s, ['Dee'])).toBe(s);
  });

  it('ranks by points, then wins, then best finishes', () => {
    let s = newSeason(['a', 'b', 'c'], drivers, {});
    s = scoreRound(s, ['Ann', 'Bob', 'Cid', 'Dee']);
    s = scoreRound(s, ['Bob', 'Ann', 'Cid', 'Dee']);
    // Ann and Bob both on 18 with one win each; Cid beats Dee on 3rds.
    let t = seasonTable(s);
    expect(t.map((r) => [r.name, r.points])).toEqual([
      ['Ann', 18],
      ['Bob', 18],
      ['Cid', 12],
      ['Dee', 10],
    ]);
    s = scoreRound(s, ['Cid', 'Bob', 'Dee', 'Ann']);
    t = seasonTable(s);
    // Bob 26 (1 win, two 2nds) ahead of Ann 23; Cid 22 with a win.
    expect(t.map((r) => r.name)).toEqual(['Bob', 'Ann', 'Cid', 'Dee']);
    expect(t[0].wins).toBe(1);
  });

  it('breaks a points tie on wins', () => {
    const five = [...drivers, { name: 'Eve', color: '#555', kind: 'kart' as const }];
    let s = newSeason(['a', 'b'], five, {});
    s = scoreRound(s, ['Cid', 'Bob', 'Ann', 'Dee', 'Eve']);
    s = scoreRound(s, ['Dee', 'Ann', 'Bob', 'Eve', 'Cid']);
    // Cid 10 + 4 = 14 vs Bob 8 + 6 = 14: Cid has the win.
    const t = seasonTable(s);
    expect(t.find((r) => r.name === 'Cid')!.points).toBe(14);
    expect(t.find((r) => r.name === 'Bob')!.points).toBe(14);
    expect(t.findIndex((r) => r.name === 'Cid')).toBeLessThan(t.findIndex((r) => r.name === 'Bob'));
  });

  it('saves and resumes a season, and clears it', () => {
    const store = memoryStore();
    let s = newSeason(['meadow', 'alpine'], drivers, { laps: 3 });
    s = scoreRound(s, ['Dee', 'Cid', 'Bob', 'Ann']);
    saveSeason(s, store);
    const back = loadSeason<{ laps: number }>(store)!;
    expect(back.round).toBe(1);
    expect(back.options.laps).toBe(3);
    expect(seasonTable(back)[0].name).toBe('Dee');
    clearSeason(store);
    expect(loadSeason(store)).toBeNull();
    store.setItem('gg-season', '{bad json');
    expect(loadSeason(store)).toBeNull();
  });

  it('takes the finishing order from the race', () => {
    let st = createRace({
      trackId: 'meadow',
      totalLaps: 1,
      countdownSeconds: 0,
      cars: [
        { name: 'Slow', color: '#111', controller: 'ai', kind: 'truck' },
        { name: 'Fast', color: '#222', controller: 'ai', kind: 'f1' },
      ],
    });
    st.phase = 'racing';
    for (let i = 0; i < 60 * 60 && st.phase !== 'finished'; i++) st = step(st, {});
    expect(raceOrder(st)).toEqual(['Fast', 'Slow']);
  });
});
