import { describe, expect, it } from 'vitest';
import { Room } from '../src/net/room';
import { CAR_COLORS } from '../src/net/protocol';
import {
  buildTrack,
  createRace,
  finalizeTrack,
  getTrack,
  hasTrack,
  inBridge,
  inWater,
  MAP_SIZES,
  mapSizeOf,
  parseTrackDef,
  pitComplex,
  registerTrack,
  resizeTrack,
  starterTrack,
  step,
  trackName,
  TRACK_IDS,
  TRACKS,
  validateTrack,
  type TrackDef,
} from '../src/sim';

/** Starter loop with a river running across both long sides. */
function riverTrack(id = 'custom-river-test'): TrackDef {
  const def = starterTrack(id, 'River test');
  return finalizeTrack({
    ...def,
    rivers: [
      {
        halfWidth: 28,
        points: [
          { x: -100, y: 540 },
          { x: 400, y: 520 },
          { x: 900, y: 560 },
          { x: 1300, y: 530 },
          { x: 1750, y: 540 },
        ],
      },
    ],
  });
}

const messages = (def: TrackDef) => validateTrack(def).map((p) => p.message);

describe('track registry', () => {
  it('races a registered track and rebuilds it when it changes', () => {
    const def = starterTrack('custom-reg-test', 'Reg test');
    expect(hasTrack(def.id)).toBe(false);
    registerTrack(def);
    expect(hasTrack(def.id)).toBe(true);
    expect(trackName(def.id)).toBe('Reg test');
    const first = getTrack(def.id);
    registerTrack({ ...def, halfWidth: 60 });
    expect(getTrack(def.id)).not.toBe(first);
    expect(getTrack(def.id).def.halfWidth).toBe(60);
    expect(hasTrack('meadow')).toBe(true);
  });
});

describe('auto bridges', () => {
  it('puts a deck wherever the road crosses a river', () => {
    const def = riverTrack();
    expect(def.bridges).toHaveLength(2);
    const t = buildTrack(def, { grid: false });
    for (const p of t.samples) if (inWater(t, p.x, p.y)) expect(inBridge(t, p.x, p.y)).toBe(true);
    expect(messages(def)).toEqual([]);
  });

  it('rebuilds Harbor-style bridges from scratch', () => {
    const copy = finalizeTrack({ ...TRACKS.harbor, id: 'custom-harbor-copy', bridges: [] });
    expect(copy.bridges).toHaveLength(2);
    expect(messages(copy)).toEqual([]);
  });
});

describe('validation', () => {
  it('passes every built-in track and the starter', () => {
    for (const id of TRACK_IDS) expect(messages(TRACKS[id]), id).toEqual([]);
    expect(messages(starterTrack('custom-x', 'X'))).toEqual([]);
  });

  it('catches water without a bridge', () => {
    const def = { ...riverTrack(), bridges: [] };
    expect(messages(def).join()).toMatch(/water without a bridge/);
  });

  it('catches a road that runs into itself', () => {
    const def = starterTrack('custom-x', 'X');
    def.controlPoints[6] = { x: 760, y: 260 };
    expect(messages(def).join()).toMatch(/into itself|too tight/);
  });

  it('catches a tree on the road and a start away from the pits', () => {
    const def = starterTrack('custom-x', 'X');
    def.obstacles.push({ x: 700, y: 200, r: 16, kind: 'tree' });
    expect(messages(def).join()).toMatch(/tree is on the road/);
    const moved = starterTrack('custom-y', 'Y');
    moved.controlPoints = moved.controlPoints.map((p) => ({ x: p.x, y: p.y + 300 }));
    expect(messages(moved).join()).toMatch(/Start line/);
  });
});

describe('parsing untrusted tracks', () => {
  it('round-trips a track through JSON unchanged once parsed', () => {
    const once = parseTrackDef(JSON.parse(JSON.stringify(riverTrack())))!;
    expect(once.controlPoints).toEqual(riverTrack().controlPoints);
    expect(once.bridges).toEqual(riverTrack().bridges);
    expect(parseTrackDef(JSON.parse(JSON.stringify(once)))).toEqual(once);
  });

  it('rejects built-in ids, odd ids and too few points', () => {
    expect(parseTrackDef({ ...starterTrack('custom-a', 'A'), id: 'meadow' })).toBeNull();
    expect(parseTrackDef({ ...starterTrack('custom-a', 'A'), id: 'custom-<b>' })).toBeNull();
    expect(parseTrackDef({ ...starterTrack('custom-a', 'A'), controlPoints: [{ x: 1, y: 1 }] })).toBeNull();
    expect(parseTrackDef('nope')).toBeNull();
  });

  it('clamps junk, and recomputes pits and bridges instead of trusting them', () => {
    const raw = {
      ...riverTrack(),
      halfWidth: 999,
      name: 'x'.repeat(200),
      pitBoxes: [{ x: 0, y: 0, w: 9999, h: 9999 }],
      bridges: [],
      obstacles: [{ x: 'a', y: 50, r: 500, kind: 'rocket' }],
    };
    const def = parseTrackDef(raw)!;
    expect(def.halfWidth).toBe(70);
    expect(def.name.length).toBeLessThanOrEqual(24);
    expect(def.pitBoxes).toEqual(pitComplex(480).pitBoxes);
    expect(def.bridges).toHaveLength(2);
    expect(def.obstacles[0]).toMatchObject({ x: 0, r: 30, kind: 'tyres' });
  });
});

describe('map sizes', () => {
  it('makes a valid starter on every size, which the AI can lap', () => {
    for (const size of ['small', 'medium', 'large'] as const) {
      const def = starterTrack(`custom-size-${size}`, 'Size', size);
      expect(def.width).toBe(MAP_SIZES[size].width);
      expect(def.height).toBe(MAP_SIZES[size].height);
      expect(mapSizeOf(def)).toBe(size);
      expect(messages(def)).toEqual([]);
      registerTrack(def);
      let s = createRace({ trackId: def.id, totalLaps: 1, countdownSeconds: 0, cars: [{ name: 'A', color: '#fff', controller: 'ai', kind: 'rally' }] });
      s.phase = 'racing';
      for (let i = 0; i < 60 * 60 && s.phase !== 'finished'; i++) s = step(s, {});
      expect(s.phase, size).toBe('finished');
    }
  });

  it('resizes a design to fit, keeping the start and pits in place', () => {
    const harbor = riverTrack('custom-river-size');
    for (const size of ['small', 'large'] as const) {
      const r = resizeTrack(harbor, size);
      expect(r.width).toBe(MAP_SIZES[size].width);
      expect(r.controlPoints[0]).toEqual(harbor.controlPoints[0]);
      expect(r.pitBoxes).toEqual(harbor.pitBoxes);
      for (const p of r.controlPoints) {
        expect(p.x).toBeLessThanOrEqual(r.width);
        expect(p.y).toBeLessThanOrEqual(r.height);
      }
      expect(r.bridges).toHaveLength(2);
      expect(messages(r), size).toEqual([]);
    }
  });

  it('keeps the size through parsing, and falls back to medium for unknown sizes', () => {
    const large = starterTrack('custom-size-parse', 'L', 'large');
    expect(parseTrackDef(JSON.parse(JSON.stringify(large)))!.width).toBe(2200);
    expect(parseTrackDef({ ...starterTrack('custom-odd', 'O'), width: 5000, height: 5000 })!.width).toBe(1600);
  });
});

describe('racing a custom track', () => {
  it('lets the AI lap a home-made track with bridges', () => {
    const def = riverTrack('custom-ai-lap');
    registerTrack(def);
    let s = createRace({
      trackId: def.id,
      totalLaps: 2,
      countdownSeconds: 0,
      cars: ['rally', 'truck', 'f1'].map((kind, i) => ({ name: `A${i}`, color: CAR_COLORS[i], controller: 'ai' as const, kind: kind as 'rally' })),
    });
    s.phase = 'racing';
    for (let i = 0; i < 60 * 90 && s.phase !== 'finished'; i++) s = step(s, {});
    expect(s.phase).toBe('finished');
  });

  it('shares a host custom track with an online room, and only a valid one', () => {
    const room = new Room('t');
    room.join('p0', 'Host', CAR_COLORS[0], 'rally');
    room.join('p1', 'Guest', CAR_COLORS[1], 'rally');
    const def = riverTrack('custom-online-test');
    expect(room.setSettings('p1', { customTrack: def })).toBe('Only the host can change settings');
    expect(room.setSettings('p0', { customTrack: { ...def, bridges: [], rivers: def.rivers, id: 'meadow' } })).toBe(
      'That track cannot be used',
    );
    const broken = { ...def, id: 'custom-broken', obstacles: [{ x: 700, y: 200, r: 16, kind: 'tree' }] };
    expect(room.setSettings('p0', { customTrack: broken })).toMatch(/problems/);
    expect(room.setSettings('p0', { customTrack: def, aiCount: 1 })).toBeNull();
    expect(room.view().trackId).toBe(def.id);
    expect(room.view().customTrack?.name).toBe('River test');
    room.setReady('p0', true);
    room.setReady('p1', true);
    expect(room.race?.trackId).toBe(def.id);
    for (let i = 0; i < 30; i++) room.tick();
    expect(room.race).not.toBeNull();
  });

  it('drops the custom track when the host picks a built-in one', () => {
    const room = new Room('t2');
    room.join('p0', 'Host', CAR_COLORS[0], 'rally');
    room.setSettings('p0', { customTrack: riverTrack('custom-drop-test') });
    room.setSettings('p0', { trackId: 'alpine' });
    expect(room.view().trackId).toBe('alpine');
    expect(room.view().customTrack).toBeUndefined();
  });
});
