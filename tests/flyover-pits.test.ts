import { describe, expect, it } from 'vitest';
import {
  carHeightAt,
  createRace,
  getTrack,
  pitBoxIndex,
  step,
  TRACK_IDS,
  TRACKS,
  updateDeck,
  validateTrack,
  type GameState,
} from '../src/sim';

describe('flyover', () => {
  const t = getTrack('oldtown');
  const f = t.flyovers[0];
  const b = f.bridge;
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;

  it('lifts one street over the other, with ramps that climb to the deck', () => {
    expect(t.flyovers).toHaveLength(1);
    expect(f.deck.length).toBeGreaterThan(10);
    for (const i of f.deck) expect(t.sampleHeights[i]).toBeCloseTo(b.height, 3);
    // The street underneath stays on the ground.
    const below = t.samples.findIndex((p, i) => !f.raised[i] && Math.hypot(p.x - cx, p.y - cy) < 20);
    expect(below).toBeGreaterThanOrEqual(0);
    expect(t.sampleHeights[below]).toBeLessThan(15);
    expect(validateTrack(TRACKS.oldtown)).toEqual([]);
  });

  it('knows which level a car is on from how it got to the crossing', () => {
    const over = { x: cx, y: b.y - 200, onDeck: false };
    updateDeck(t, over);
    expect(over.onDeck).toBe(true);
    over.y = cy;
    updateDeck(t, over);
    expect(over.onDeck).toBe(true);
    expect(carHeightAt(t, over.x, over.y, over.onDeck)).toBeCloseTo(b.height, 3);
    const under = { x: b.x - 150, y: cy, onDeck: false };
    updateDeck(t, under);
    expect(under.onDeck).toBe(false);
    under.x = cx;
    updateDeck(t, under);
    expect(under.onDeck).toBe(false);
    expect(carHeightAt(t, under.x, under.y, under.onDeck)).toBeLessThan(15);
  });

  it('lets two cars cross at the same spot on different levels without touching', () => {
    let s = createRace({
      trackId: 'oldtown',
      totalLaps: 1,
      countdownSeconds: 0,
      cars: [
        { name: 'Over', color: '#fff', controller: 'human' },
        { name: 'Under', color: '#000', controller: 'human' },
      ],
    });
    s.phase = 'racing';
    const [a, c] = s.cars;
    Object.assign(a, { x: cx, y: cy - 30, vx: 0, vy: 200, angle: Math.PI / 2, onDeck: true });
    Object.assign(c, { x: cx - 30, y: cy, vx: 200, vy: 0, angle: 0, onDeck: false });
    for (let i = 0; i < 20; i++) s = step(s, {});
    expect(s.cars[0].damage).toBe(0);
    expect(s.cars[1].damage).toBe(0);
    expect(s.cars[0].vy).toBeGreaterThan(100);
    expect(s.cars[1].vx).toBeGreaterThan(100);
  });
});

describe('pits', () => {
  it('spreads the pits round the maps', () => {
    // Where each pit lane sits on a 3 × 3 grid of its map, and which way it runs.
    const spots = TRACK_IDS.map((id) => {
      const d = TRACKS[id];
      const l = d.pitLane;
      const cx = l.x + l.w / 2;
      const cy = l.y + l.h / 2;
      const cell = `${Math.floor((cx / d.width) * 3)},${Math.floor((cy / d.height) * 3)}`;
      // Pits on the outer edge of the map, or on the infield side of the road.
      const start = d.controlPoints[0];
      const edge = (x: number, y: number) => Math.min(x, y, d.width - x, d.height - y);
      const outer = edge(cx, cy) < edge(start.x, start.y);
      return { id, cell, tall: l.h > l.w, side: outer ? 'outer' : 'infield' };
    });
    expect(new Set(spots.map((s) => s.cell)).size).toBeGreaterThanOrEqual(5);
    expect(spots.filter((s) => s.tall).length).toBeGreaterThanOrEqual(3);
    // No two maps share both the spot and the side of the road.
    expect(new Set(spots.map((s) => `${s.cell} ${s.side}`)).size).toBe(spots.length);
  });

  it.each(TRACK_IDS)('lets the AI find the pits and refuel on %s', (id) => {
    let s: GameState = createRace({
      trackId: id,
      totalLaps: 3,
      countdownSeconds: 0,
      cars: [{ name: 'A', color: '#fff', controller: 'ai', kind: 'rally' }],
      rules: { damage: 1, tyreWear: 1, fuel: 1, collisions: true, aiLevel: 70 },
    });
    s.phase = 'racing';
    s.cars[0].fuel = 0.02;
    const track = getTrack(id);
    let stopped = false;
    for (let i = 0; i < 60 * 60 && !(stopped && s.cars[0].fuel > 0.4); i++) {
      s = step(s, {});
      if (pitBoxIndex(track, s.cars[0].x, s.cars[0].y) >= 0) stopped = true;
    }
    expect(stopped).toBe(true);
    expect(s.cars[0].fuel).toBeGreaterThan(0.4);
  }, 20_000);
});
