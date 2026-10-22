import { describe, expect, it } from 'vitest';
import { mapDemoOptions } from '../src/client/mapDemo';
import { createRace, getTrack, heightAt, inBridge, step, surfaceAt } from '../src/sim';

describe('map demo', () => {
  it('drives the harbor bridge, then water, then sand', () => {
    const renderer = { cameraMode: 'follow' as const };
    const opts = mapDemoOptions(renderer as never);
    expect(opts.trackId).toBe('harbor');
    let s = createRace({
      trackId: 'harbor',
      totalLaps: 1,
      cars: [{ name: 'T', color: '#e8443a', controller: 'human' }],
      countdownSeconds: 0,
    });
    s.phase = 'racing';
    opts.setup?.(s);
    const track = getTrack('harbor');
    let sawBridge = false;
    let sawWater = false;
    let sawSand = false;
    let maxH = 0;
    for (let i = 0; i < 1100; i++) {
      s = step(s, { 0: opts.scriptedInput!(s) });
      const c = s.cars[0];
      const surf = surfaceAt(track, c.x, c.y);
      const h = heightAt(track, c.x, c.y);
      if (h > maxH) maxH = h;
      if (inBridge(track, c.x, c.y)) sawBridge = true;
      if (surf === 'water') sawWater = true;
      if (surf === 'sand') sawSand = true;
    }
    expect(sawBridge).toBe(true);
    expect(sawWater).toBe(true);
    expect(sawSand).toBe(true);
    expect(maxH).toBeGreaterThan(25);
    expect(renderer.cameraMode).toBe('follow');
  });
});
