import { describe, expect, it } from 'vitest';
import { damageDemoOptions } from '../src/client/damageDemo';
import { createRace, getTrack, pitBoxIndex, step } from '../src/sim';

describe('damage demo driver', () => {
  it('crashes into smoke, then fire, then pits and repairs', () => {
    const opts = damageDemoOptions();
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
    expect(s.cars[0].damage).toBe(0);

    let smoked = false;
    let fired = false;
    let pitted = false;
    let repaired = false;
    for (let i = 0; i < 60 * 22; i++) {
      const input = opts.scriptedInput!(s);
      s = step(s, { 0: input });
      const car = s.cars[0];
      if (car.damage > 0.16) smoked = true;
      if (car.damage > 0.82) fired = true;
      const inBox = pitBoxIndex(track, car.x, car.y) >= 0;
      const speed = Math.hypot(car.vx, car.vy);
      if (fired && inBox && speed < 24) pitted = true;
      if (pitted && car.damage < 0.02) repaired = true;
    }
    expect(smoked).toBe(true);
    expect(fired).toBe(true);
    expect(pitted).toBe(true);
    expect(repaired).toBe(true);
  });
});
