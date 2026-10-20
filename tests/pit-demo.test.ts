import { describe, expect, it } from 'vitest';
import { pitDemoOptions } from '../src/client/pitDemo';
import { createRace, getTrack, pitBoxIndex, step } from '../src/sim';

describe('pit demo driver', () => {
  it('drives into a box, refills, then leaves', () => {
    const opts = pitDemoOptions();
    const track = getTrack('meadow');
    let s = createRace({
      trackId: 'meadow',
      totalLaps: 1,
      cars: [{ name: 'P1', color: '#e8443a', controller: 'human', kind: 'f1' }],
      countdownSeconds: 0,
    });
    opts.setup?.(s);
    s.phase = 'racing';
    s.startTick = 0;
    expect(s.cars[0].fuel).toBeLessThan(0.3);
    expect(s.cars[0].tyreWear).toBeGreaterThan(0.7);

    let entered = false;
    let refilled = false;
    let left = false;
    for (let i = 0; i < 60 * 18; i++) {
      const input = opts.scriptedInput!(s);
      s = step(s, { 0: input });
      const car = s.cars[0];
      const inBox = pitBoxIndex(track, car.x, car.y) >= 0;
      const speed = Math.hypot(car.vx, car.vy);
      if (inBox && speed < 24) entered = true;
      if (entered && car.fuel > 0.98 && car.tyreWear < 0.02) refilled = true;
      if (refilled && !inBox) left = true;
    }
    expect(entered).toBe(true);
    expect(refilled).toBe(true);
    expect(left).toBe(true);
  });
});
