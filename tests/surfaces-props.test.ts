import { describe, expect, it } from 'vitest';
import { decodeSnapshot, encodeSnapshot } from '../src/net/snapshot';
import {
  createRace,
  distanceToCenterline,
  getTrack,
  hashState,
  inWater,
  step,
  surfaceAt,
  SURFACES,
  TRACK_IDS,
  TRACKS,
  type GameState,
} from '../src/sim';

function solo(trackId: string, x: number, y: number, vx: number, vy: number): GameState {
  const s = createRace({
    trackId,
    totalLaps: 1,
    cars: [{ name: 'T', color: '#fff', controller: 'human' }],
    countdownSeconds: 0,
  });
  s.phase = 'racing';
  const c = s.cars[0];
  c.x = x;
  c.y = y;
  c.vx = vx;
  c.vy = vy;
  c.angle = Math.atan2(vy, vx);
  return s;
}

describe('surfaces', () => {
  it('orders grip ice < snow < gravel < asphalt, and ice barely slows a car', () => {
    expect(SURFACES.ice.grip).toBeLessThan(SURFACES.snow.grip);
    expect(SURFACES.snow.grip).toBeLessThan(SURFACES.gravel.grip);
    expect(SURFACES.gravel.grip).toBeLessThan(SURFACES.asphalt.grip);
    expect(SURFACES.ice.rolling).toBeLessThan(SURFACES.asphalt.rolling);
  });

  it('paints Alpine with snow, a frozen pond, black ice on the road and gravel traps', () => {
    const alpine = getTrack('alpine');
    expect(surfaceAt(alpine, 800, 420)).toBe('ice');
    expect(surfaceAt(alpine, 1050, 630)).toBe('ice');
    expect(surfaceAt(alpine, 1550, 520)).toBe('gravel');
    expect(surfaceAt(alpine, 300, 1000)).toBe('snow');
    expect(surfaceAt(alpine, alpine.samples[0].x, alpine.samples[0].y)).toBe('asphalt');
    const harbor = getTrack('harbor');
    expect(surfaceAt(harbor, 1500, 260)).toBe('sand');
    expect(surfaceAt(getTrack('meadow'), 30, 30)).toBe('grass');
  });

  it('lets a car slide much further on ice than on tarmac', () => {
    const coast = (x: number, y: number) => {
      let s = solo('alpine', x, y, 0, 0);
      s.cars[0].vy = 160;
      s.cars[0].angle = 0;
      const y0 = s.cars[0].y;
      for (let i = 0; i < 30; i++) s = step(s, {});
      return s.cars[0].y - y0;
    };
    // Sideways slide: on ice the tyres barely catch it.
    expect(coast(800, 380)).toBeGreaterThan(coast(700, 200) * 2);
  });
});

describe('obstacles', () => {
  it('keeps fixed obstacles off every road and out of water, and cones off the middle of the road', () => {
    for (const id of TRACK_IDS) {
      const track = getTrack(id);
      for (const o of TRACKS[id].obstacles) {
        const d = distanceToCenterline(track, o.x, o.y);
        if (o.kind === 'cone') expect(d, `${id} cone`).toBeGreaterThan(track.def.halfWidth * 0.6);
        else expect(d, `${id} ${o.kind}`).toBeGreaterThan(track.def.halfWidth + o.r);
        expect(inWater(track, o.x, o.y)).toBe(false);
      }
    }
  });

  it('keeps barriers off the road', () => {
    for (const id of TRACK_IDS) {
      const track = getTrack(id);
      for (const b of TRACKS[id].barriers ?? []) {
        for (let t = 0; t <= 1; t += 0.1) {
          const x = b.a.x + (b.b.x - b.a.x) * t;
          const y = b.a.y + (b.b.y - b.a.y) * t;
          expect(distanceToCenterline(track, x, y), id).toBeGreaterThan(track.def.halfWidth + 20);
        }
      }
    }
  });

  it('stops a car at a barrier', () => {
    const b = TRACKS.alpine.barriers![2];
    const mx = (b.a.x + b.b.x) / 2;
    const my = (b.a.y + b.b.y) / 2;
    // Drive at the barrier from the road side.
    let s = solo('alpine', mx - 60, my, 300, 0);
    for (let i = 0; i < 40; i++) s = step(s, { 0: { throttle: 1, steer: 0, handbrake: false } });
    expect(s.cars[0].x).toBeLessThan(mx);
    expect(s.cars[0].damage).toBeGreaterThan(0);
  });
});

describe('cones', () => {
  function coneRun(speed: number, withCone = true, throttle = 0.4) {
    let s = createRace({
      trackId: 'alpine',
      totalLaps: 1,
      cars: [{ name: 'T', color: '#fff', controller: 'human' }],
      countdownSeconds: 0,
    });
    s.phase = 'racing';
    const cone = s.props![0];
    const c = s.cars[0];
    c.x = cone.x - 60;
    c.y = cone.y;
    c.vx = speed;
    c.vy = 0;
    c.angle = 0;
    const start = { x: cone.x, y: cone.y };
    if (!withCone) s.props = [];
    for (let i = 0; i < 40; i++) s = step(s, { 0: { throttle, steer: 0, handbrake: false } });
    return { s, start };
  }

  it('starts with every cone from the track standing', () => {
    const s = createRace({ trackId: 'alpine', totalLaps: 1, cars: [], countdownSeconds: 0 });
    expect(s.props).toHaveLength(TRACKS.alpine.obstacles.filter((o) => o.kind === 'cone').length);
    expect(s.props!.every((p) => !p.down)).toBe(true);
  });

  it('flies off when hit, knocks over at speed, and does not hurt the car', () => {
    const { s, start } = coneRun(300);
    const cone = s.props![0];
    expect(Math.hypot(cone.x - start.x, cone.y - start.y)).toBeGreaterThan(40);
    expect(cone.down).toBe(true);
    expect(s.cars[0].damage).toBe(0);
    // The car keeps nearly all its speed.
    const clear = coneRun(300, false).s.cars[0];
    expect(Math.hypot(s.cars[0].vx, s.cars[0].vy)).toBeGreaterThan(Math.hypot(clear.vx, clear.vy) * 0.9);
    const slow = coneRun(60, true, 0);
    expect(slow.s.props![0].down).toBe(false);
  });

  it('stays deterministic over a JSON round-trip and travels in snapshots', () => {
    let a = coneRun(300).s;
    let b = JSON.parse(JSON.stringify(a)) as GameState;
    for (let i = 0; i < 60; i++) {
      a = step(a, {});
      b = step(b, {});
    }
    expect(hashState(a)).toBe(hashState(b));
    const back = decodeSnapshot(JSON.parse(JSON.stringify(encodeSnapshot(a))));
    expect(back.props).toHaveLength(a.props!.length);
    expect(back.props![0].x).toBeCloseTo(a.props![0].x, 1);
    expect(back.props![0].down).toBe(a.props![0].down);
  });
});
