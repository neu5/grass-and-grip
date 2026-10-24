import { describe, expect, it } from 'vitest';
import { CAR_COLORS } from '../src/net/protocol';
import { createRace, distanceToCenterline, distToSegmentSq, getTrack, step, TRACK_IDS } from '../src/sim';

describe('checkpoint gates', () => {
  it.each(TRACK_IDS)('stand on fairly straight road on %s, not on a hairpin apex', (id) => {
    {
      const t = getTrack(id);
      t.gates.forEach((g, i) => {
        expect(1 / t.curvature[g.index], `${id} gate ${i + 1}`).toBeGreaterThan(250);
      });
    }
  });

  it.each(TRACK_IDS)('cover the whole road on %s and stop short of any other part of it', (id) => {
    {
      const t = getTrack(id);
      const hw = t.def.halfWidth;
      const n = t.samples.length;
      t.gates.forEach((g, gi) => {
        for (const end of [g.a, g.b]) {
          expect(Math.hypot(end.x - g.center.x, end.y - g.center.y)).toBeGreaterThan(hw);
          // Nearest road that is not this stretch must be clear of the end.
          let other = Infinity;
          for (let i = 0; i < n; i++) {
            const along = Math.min(Math.abs(i - g.index), n - Math.abs(i - g.index));
            if (along < 40) continue;
            other = Math.min(other, Math.sqrt(distToSegmentSq(end.x, end.y, t.samples[i], t.samples[(i + 1) % n])));
          }
          expect(other, `${id} gate ${gi + 1}`).toBeGreaterThan(hw);
        }
        expect(distanceToCenterline(t, g.center.x, g.center.y)).toBeLessThan(1);
      });
    }
  });

  it('counts a gate when a car is shoved across it', () => {
    const t = getTrack('meadow');
    const g = t.gates[4];
    let s = createRace({
      trackId: 'meadow',
      totalLaps: 1,
      countdownSeconds: 0,
      cars: [
        { name: 'Parked', color: CAR_COLORS[0], controller: 'human' },
        { name: 'Pusher', color: CAR_COLORS[1], controller: 'human', kind: 'truck' },
      ],
    });
    s.phase = 'racing';
    const [parked, pusher] = s.cars;
    // Parked just short of the gate, facing along the road; the truck hits it from behind.
    parked.x = g.center.x - g.tx * 6;
    parked.y = g.center.y - g.ty * 6;
    parked.angle = Math.atan2(g.ty, g.tx);
    parked.nextCheckpoint = 4;
    pusher.x = g.center.x - g.tx * 40;
    pusher.y = g.center.y - g.ty * 40;
    pusher.vx = g.tx * 300;
    pusher.vy = g.ty * 300;
    pusher.angle = parked.angle;
    pusher.nextCheckpoint = 4;
    for (let i = 0; i < 20; i++) s = step(s, { 0: { throttle: 0, steer: 0, handbrake: false } });
    expect(s.cars[0].nextCheckpoint).toBe(5);
  });
});
