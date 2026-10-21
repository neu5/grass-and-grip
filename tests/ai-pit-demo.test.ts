import { describe, expect, it } from 'vitest';
import { aiPitDemoOptions } from '../src/client/aiPitDemo';
import { getTrack, isStoppedInPit, pitBoxIndex, step } from '../src/sim';
import { createRace } from '../src/sim';

describe('AI pit demo', () => {
  it('lets the AI enter a box, recover, then leave', () => {
    const opts = aiPitDemoOptions();
    const track = getTrack('meadow');
    let s = createRace({
      trackId: 'meadow',
      totalLaps: 3,
      cars: [{ name: 'P1', color: '#e8443a', controller: 'human', kind: 'f1' }],
      countdownSeconds: 0,
    });
    opts.setup?.(s);
    s.phase = 'racing';
    s.startTick = 0;
    expect(s.cars[0].controller).toBe('ai');
    expect(s.cars[0].fuel).toBeLessThan(0.15);
    expect(s.cars[0].tyreWear).toBeGreaterThan(0.85);
    expect(s.cars[0].damage).toBeGreaterThan(0.7);

    let entered = false;
    let recovered = false;
    let left = false;
    const startFuel = s.cars[0].fuel;
    const startWear = s.cars[0].tyreWear;
    const startDmg = s.cars[0].damage;
    for (let i = 0; i < 60 * 18; i++) {
      s = step(s, {});
      const car = s.cars[0];
      if (isStoppedInPit(track, car)) {
        entered = true;
        if (car.fuel > startFuel + 0.2 && car.tyreWear < startWear - 0.2 && car.damage < startDmg - 0.2) {
          recovered = true;
        }
      }
      if (recovered && pitBoxIndex(track, car.x, car.y) < 0) left = true;
    }
    expect(entered).toBe(true);
    expect(recovered).toBe(true);
    expect(left).toBe(true);
  });
});
