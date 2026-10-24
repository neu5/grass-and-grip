import { describe, expect, it } from 'vitest';
import { THEME_LOOKS } from '../src/client/themes';
import {
  createRace,
  distanceToCenterline,
  getTrack,
  parseTrackDef,
  registerTrack,
  starterTrack,
  step,
  surfaceAt,
  THEMES,
  TRACK_IDS,
  TRACKS,
  type GameState,
  type SurfacePatch,
  type TrackDef,
} from '../src/sim';

/** A car driving flat out along the start straight for `ticks`. */
function sprint(def: TrackDef, ticks = 90): number {
  registerTrack(def);
  let s: GameState = createRace({ trackId: def.id, totalLaps: 1, countdownSeconds: 0, cars: [{ name: 'T', color: '#fff', controller: 'human', kind: 'rally' }] });
  s.phase = 'racing';
  const x0 = s.cars[0].x;
  for (let i = 0; i < ticks; i++) s = step(s, { 0: { throttle: 1, steer: 0, handbrake: false } });
  return s.cars[0].x - x0;
}

const square = (x: number, y: number, r: number): SurfacePatch['points'] => [
  { x: x - r, y: y - r },
  { x: x + r, y: y - r },
  { x: x + r, y: y + r },
  { x: x - r, y: y + r },
];

describe('road surfaces', () => {
  it('drives on dirt on a rally stage, but the pit lane stays paved', () => {
    const t = getTrack('harvest');
    const p = t.samples[0];
    expect(surfaceAt(t, p.x, p.y)).toBe('dirt');
    const box = t.def.pitBoxes[0];
    expect(surfaceAt(t, box.x + box.w / 2, box.y + box.h / 2)).toBe('asphalt');
    const meadow = getTrack('meadow');
    expect(surfaceAt(meadow, meadow.samples[0].x, meadow.samples[0].y)).toBe('asphalt');
  });

  it('is quicker on tarmac than dirt, and much quicker than through mud', () => {
    const base = starterTrack('custom-surface-a', 'A');
    const tarmac = sprint(base);
    const dirt = sprint({ ...base, id: 'custom-surface-b', road: 'dirt' });
    const mud = sprint({ ...base, id: 'custom-surface-c', patches: [{ surface: 'mud', overRoad: true, points: square(560, 210, 200) }] });
    expect(dirt).toBeLessThan(tarmac);
    expect(dirt).toBeGreaterThan(tarmac * 0.8);
    expect(mud).toBeLessThan(dirt * 0.8);
  });
});

describe('scenery', () => {
  it('keeps every building, stand and ruin off the road', () => {
    for (const id of TRACK_IDS) {
      const t = getTrack(id);
      for (const d of TRACKS[id].decor ?? []) {
        const c = Math.cos(d.angle ?? 0);
        const s = Math.sin(d.angle ?? 0);
        for (const [u, v] of [
          [0, 0],
          [-0.5, -0.5],
          [0.5, -0.5],
          [0.5, 0.5],
          [-0.5, 0.5],
          [0, 0.5],
          [0, -0.5],
          [0.5, 0],
          [-0.5, 0],
        ]) {
          const x = d.x + u * d.w * c - v * d.d * s;
          const y = d.y + u * d.w * s + v * d.d * c;
          expect(distanceToCenterline(t, x, y), `${id} ${d.kind}`).toBeGreaterThan(t.def.halfWidth);
        }
      }
    }
  }, 30_000);

  it('stops a car at a hidden solid', () => {
    const base = starterTrack('custom-solid-a', 'Solid');
    registerTrack(base);
    const start = createRace({ trackId: base.id, totalLaps: 1, cars: [{ name: 'T', color: '#fff', controller: 'human' }] }).cars[0];
    const clear = sprint({ ...base, id: 'custom-solid-b' }, 120);
    const blocked = sprint({ ...base, id: 'custom-solid-c', obstacles: [{ x: Math.round(start.x + 200), y: Math.round(start.y), r: 60, kind: 'solid' }] }, 120);
    expect(clear).toBeGreaterThan(300);
    expect(blocked).toBeLessThan(clear * 0.75);
  });

  it('has a look for every theme', () => {
    for (const theme of THEMES) expect(THEME_LOOKS[theme].trees.length).toBeGreaterThan(0);
  });
});

describe('parsing themed tracks', () => {
  it('keeps theme, road and decor, and turns unknown values into safe ones', () => {
    const raw = {
      ...starterTrack('custom-themed', 'Themed'),
      theme: 'jungle',
      road: 'dirt',
      decor: [
        { kind: 'hut', x: 800, y: 600, w: 30, d: 30 },
        { kind: 'spaceship', x: 10, y: 10, w: 30, d: 30 },
      ],
      obstacles: [
        { x: 900, y: 600, r: 14, kind: 'rock' },
        { x: 950, y: 600, r: 12, kind: 'hay' },
        { x: 1000, y: 600, r: 20, kind: 'solid' },
      ],
    };
    const def = parseTrackDef(JSON.parse(JSON.stringify(raw)))!;
    expect(def.theme).toBe('jungle');
    expect(def.road).toBe('dirt');
    expect(def.decor).toHaveLength(1);
    expect(def.decor![0].kind).toBe('hut');
    // Hidden solids are for built-in scenery only.
    expect(def.obstacles.map((o) => o.kind)).toEqual(['rock', 'hay', 'tyres']);
    const odd = parseTrackDef({ ...raw, theme: 'moon', road: 'lava' })!;
    expect(odd.theme).toBeUndefined();
    expect(odd.road).toBe('asphalt');
  });
});
