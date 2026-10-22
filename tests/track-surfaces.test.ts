import { describe, expect, it } from 'vitest';
import { encodeSnapshot, decodeSnapshot } from '../src/net/snapshot';
import { Room } from '../src/net/room';
import { CAR_COLORS } from '../src/net/protocol';
import {
  SURFACES,
  WATER_FLOAT,
  WATER_SURFACE,
  createRace,
  getTrack,
  heightAt,
  inBridge,
  pointInRect,
  slopeAttitude,
  step,
  terrainHeightAt,
  surfaceAt,
  TRACKS,
  type GameState,
} from '../src/sim';

const RED = CAR_COLORS[0];

function racingAt(trackId: string, x: number, y: number): GameState {
  const s = createRace({
    trackId,
    totalLaps: 1,
    cars: [{ name: 'T', color: '#fff', controller: 'human' }],
    countdownSeconds: 0,
  });
  s.phase = 'racing';
  s.startTick = 0;
  s.cars[0].x = x;
  s.cars[0].y = y;
  s.cars[0].vx = 0;
  s.cars[0].vy = 0;
  s.cars[0].angle = 0;
  return s;
}

function topSpeed(trackId: string, x: number, y: number): number {
  let s = racingAt(trackId, x, y);
  for (let i = 0; i < 500; i++) {
    s.cars[0].x = x;
    s.cars[0].y = y;
    s = step(s, { 0: { throttle: 1, steer: 0, handbrake: false } });
  }
  const c = s.cars[0];
  return Math.hypot(c.vx, c.vy);
}

function lateralLeft(trackId: string, x: number, y: number): number {
  let s = racingAt(trackId, x, y);
  s.cars[0].vy = 220;
  for (let i = 0; i < 18; i++) {
    s.cars[0].x = x;
    s.cars[0].y = y;
    s = step(s, { 0: { throttle: 0, steer: 0, handbrake: false } });
  }
  return Math.abs(s.cars[0].vy);
}

describe('harbor layout', () => {
  const track = getTrack('harbor');

  it('keeps every centerline sample on asphalt', () => {
    for (const p of track.samples) {
      expect(surfaceAt(track, p.x, p.y)).toBe('asphalt');
    }
  });

  it('has water, sand, a high bridge, and pits on asphalt', () => {
    expect(TRACKS.harbor.water?.length).toBeGreaterThan(0);
    expect(TRACKS.harbor.sand?.length).toBeGreaterThan(0);
    expect(TRACKS.harbor.bridges).toHaveLength(1);
    const b = TRACKS.harbor.bridges![0];
    const bx = b.x + b.w / 2;
    const by = b.y + b.h / 2;
    expect(inBridge(track, bx, by)).toBe(true);
    expect(surfaceAt(track, bx, by)).toBe('asphalt');
    expect(heightAt(track, bx, by)).toBeGreaterThan(45);
    const box = track.def.pitBoxes[0];
    expect(surfaceAt(track, box.x + box.w / 2, box.y + box.h / 2)).toBe('asphalt');
  });

  it('does not treat a car on the bridge as in water', () => {
    const b = TRACKS.harbor.bridges![0];
    const x = b.x + b.w / 2;
    const y = b.y + b.h / 2;
    expect(surfaceAt(track, x, y)).toBe('asphalt');
    expect(surfaceAt(track, x, y)).not.toBe('water');
    expect(heightAt(track, x, y)).toBeGreaterThan(45);
  });

  it('ramps onto the bridge without cliff steps', () => {
    let maxStep = 0;
    for (let i = 1; i < track.samples.length; i++) {
      const dh = Math.abs(track.sampleHeights[i] - track.sampleHeights[i - 1]);
      if (dh > maxStep) maxStep = dh;
    }
    const wrap = Math.abs(track.sampleHeights[0] - track.sampleHeights[track.samples.length - 1]);
    expect(Math.max(maxStep, wrap)).toBeLessThan(1.2);
  });

  it('has a smooth 2d height field without stair-steps or z pops', () => {
    let maxDh = 0;
    for (const p of track.samples) {
      const h = heightAt(track, p.x, p.y);
      for (const [dx, dy] of [
        [3, 0],
        [0, 3],
        [2, 2],
        [-3, 1],
      ] as const) {
        const dh = Math.abs(heightAt(track, p.x + dx, p.y + dy) - h);
        if (dh > maxDh) maxDh = dh;
      }
    }
    expect(maxDh).toBeLessThan(1.0);
  });

  it('has no cliffs or creases in the terrain around lakes and the bridge', () => {
    const deck = TRACKS.harbor.bridges![0];
    let steepest = 0;
    let crease = 0;
    for (let y = 8; y < track.def.height - 8; y += 8) {
      for (let x = 8; x < track.def.width - 8; x += 8) {
        // Ground under the deck sits behind the abutments.
        if (pointInRect(x, y, deck)) continue;
        const h = terrainHeightAt(track, x, y);
        const e = terrainHeightAt(track, x + 4, y);
        const w = terrainHeightAt(track, x - 4, y);
        const s = terrainHeightAt(track, x, y + 4);
        const n = terrainHeightAt(track, x, y - 4);
        steepest = Math.max(steepest, Math.hypot(e - w, s - n) / 8);
        crease = Math.max(crease, Math.abs(e + w + s + n - 4 * h) / 16);
      }
    }
    expect(steepest).toBeLessThan(1.5);
    expect(crease).toBeLessThan(0.5);
  });

  it('holds the deck flat and level with the road', () => {
    const b = TRACKS.harbor.bridges![0];
    for (let i = 0; i < track.samples.length; i++) {
      const p = track.samples[i];
      if (inBridge(track, p.x, p.y)) expect(track.sampleHeights[i]).toBeCloseTo(b.height, 5);
    }
  });

  it('keeps car pitch continuous along the ramp', () => {
    let maxDPitch = 0;
    let prev = slopeAttitude(track, track.samples[0].x, track.samples[0].y, track.tangentAngles[0]).pitch;
    for (let i = 1; i < track.samples.length; i++) {
      const p = track.samples[i];
      const pitch = slopeAttitude(track, p.x, p.y, track.tangentAngles[i]).pitch;
      const dp = Math.abs(pitch - prev);
      if (dp > maxDPitch) maxDPitch = dp;
      prev = pitch;
    }
    expect(maxDPitch).toBeLessThan(0.05);
  });
});

describe('surfaces', () => {
  const harbor = getTrack('harbor');
  const meadow = getTrack('meadow');
  const asphalt = meadow.samples[0];
  const b = TRACKS.harbor.bridges![0];
  const water = (() => {
    for (let x = b.x - 80; x < b.x; x += 8) {
      for (let y = b.y; y < b.y + b.h; y += 8) {
        if (surfaceAt(harbor, x, y) === 'water') return { x, y };
      }
    }
    return { x: 500, y: 520 };
  })();
  const sand = (() => {
    const r = TRACKS.harbor.sand![0];
    for (let x = r.x; x < r.x + r.w; x += 10) {
      for (let y = r.y; y < r.y + r.h; y += 10) {
        if (surfaceAt(harbor, x, y) === 'sand') return { x, y };
      }
    }
    return { x: r.x + 20, y: r.y + 20 };
  })();
  const grass = { x: 30, y: 30 };

  it('makes water slower than sand, grass and asphalt', () => {
    expect(surfaceAt(harbor, water.x, water.y)).toBe('water');
    expect(surfaceAt(harbor, sand.x, sand.y)).toBe('sand');
    expect(surfaceAt(meadow, grass.x, grass.y)).toBe('grass');
    expect(surfaceAt(meadow, asphalt.x, asphalt.y)).toBe('asphalt');
    const w = topSpeed('harbor', water.x, water.y);
    const s = topSpeed('harbor', sand.x, sand.y);
    const g = topSpeed('meadow', grass.x, grass.y);
    const a = topSpeed('meadow', asphalt.x, asphalt.y);
    expect(w).toBeGreaterThan(30);
    expect(w).toBeLessThan(s * 0.65);
    expect(w).toBeLessThan(g * 0.55);
    expect(w).toBeLessThan(a * 0.3);
  });

  it('sits a car in the water below the surface, not hovering on it', () => {
    expect(surfaceAt(harbor, water.x, water.y)).toBe('water');
    expect(heightAt(harbor, water.x, water.y)).toBe(WATER_FLOAT);
    expect(heightAt(harbor, water.x, water.y)).toBeLessThan(WATER_SURFACE);
    const land = meadow.samples[0];
    expect(heightAt(harbor, water.x, water.y)).toBeLessThan(heightAt(meadow, land.x, land.y) - 4);
  });

  it('gives sand different grip from grass', () => {
    expect(SURFACES.sand.grip).not.toBe(SURFACES.grass.grip);
    expect(SURFACES.sand.rolling).not.toBe(SURFACES.grass.rolling);
    const sandSlip = lateralLeft('harbor', sand.x, sand.y);
    const grassSlip = lateralLeft('meadow', grass.x, grass.y);
    expect(sandSlip).toBeGreaterThan(grassSlip * 1.2);
  });

  it('keeps meadow off-track as grass, not water or sand', () => {
    expect(surfaceAt(meadow, 30, 30)).toBe('grass');
    expect(meadow.def.water).toBeUndefined();
    expect(meadow.def.sand).toBeUndefined();
    expect(meadow.def.bridges).toBeUndefined();
    expect(heightAt(meadow, meadow.samples[0].x, meadow.samples[0].y)).toBeCloseTo(0, 5);
  });
});

describe('online track id', () => {
  it('puts the host-picked track on the race and in snapshots', () => {
    const room = new Room('t');
    expect(room.join('p0', 'Ada', RED)).toBeNull();
    expect(room.setSettings('p0', { trackId: 'nope' })).toBe('Unknown track');
    expect(room.setSettings('p0', { trackId: 'harbor', aiCount: 0 })).toBeNull();
    expect(room.view().trackId).toBe('harbor');
    room.setReady('p0', true);
    expect(room.race!.trackId).toBe('harbor');
    const snap = encodeSnapshot(room.race!);
    expect(snap.tid).toBe('harbor');
    expect(decodeSnapshot(snap).trackId).toBe('harbor');
  });
});
