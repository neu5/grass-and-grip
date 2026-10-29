import { describe, expect, it } from 'vitest';
import {
  aiNeedsPit,
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

  it('keeps checkpoints clear of the pit lane, so the pits are no shortcut past one', () => {
    for (const id of TRACK_IDS) {
      const t = getTrack(id);
      const l = t.def.pitLane;
      for (const g of t.gates.slice(1)) {
        const dx = Math.max(l.x - g.center.x, 0, g.center.x - (l.x + l.w));
        const dy = Math.max(l.y - g.center.y, 0, g.center.y - (l.y + l.h));
        expect(Math.hypot(dx, dy), id).toBeGreaterThan(t.def.halfWidth + 60);
      }
    }
  }, 30_000);

  it('gives the long Grand Prix straight six stalls, the rest four', () => {
    expect(TRACKS.grandprix.pitBoxes).toHaveLength(6);
    expect(TRACKS.meadow.pitBoxes).toHaveLength(4);
    expect(validateTrack(TRACKS.grandprix)).toEqual([]);
  });

  it('pits a lap early when the tyres would not last another lap', () => {
    const s = createRace({ trackId: 'meadow', totalLaps: 5, cars: [{ name: 'A', color: '#fff', controller: 'ai' }] });
    const car = s.cars[0];
    car.tyreWear = 0.55;
    expect(aiNeedsPit(car)).toBe(false);
    car.ai!.lapWear = 0.3;
    expect(aiNeedsPit(car)).toBe(true);
    car.tyreWear = 0.1;
    car.fuel = 0.2;
    car.ai!.lapFuel = 0.12;
    expect(aiNeedsPit(car)).toBe(true);
  });

  it('gets every car into the pits and on fresh tyres in a full Grand Prix race', () => {
    let s: GameState = createRace({
      trackId: 'grandprix',
      totalLaps: 8,
      countdownSeconds: 0,
      cars: (['f1', 'rally', 'f1', 'buggy', 'kart', 'f1', 'truck', 'rally'] as const).map((kind, i) => ({ name: `c${i}`, color: '#fff', controller: 'ai', kind })),
      rules: { damage: 1, tyreWear: 1, fuel: 1, collisions: true, aiLevel: 100 },
    });
    s.phase = 'racing';
    let wornRacing = 0;
    for (let i = 0; i < 60 * 60 * 4 && s.phase !== 'finished'; i++) {
      s = step(s, {});
      for (const c of s.cars) if (c.finishTick === null && c.ai?.pitPhase === 'race' && c.tyreWear > 0.9) wornRacing++;
    }
    expect(s.phase).toBe('finished');
    // Car-ticks on nearly bald tyres outside the pits, across all eight cars.
    expect(wornRacing).toBeLessThan(60 * 5);
  }, 120_000);

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
