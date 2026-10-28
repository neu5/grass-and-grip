import { describe, expect, it } from 'vitest';
import { carHeightAt, carPose, getTrack, TRACK_IDS, type WheelBase } from '../src/sim';

/** About the kart, rally car and truck wheel layouts in the renderer. */
const BASES: Record<string, WheelBase> = {
  kart: { front: 7.5, rear: 7.9, half: 7, radius: 3 },
  rally: { front: 9.6, rear: 10.2, half: 8.5, radius: 4.6 },
  truck: { front: 13.2, rear: 15.8, half: 12.2, radius: 5.4 },
};

describe('car pose', () => {
  it('puts every wheel on the ground across the road, on every track', () => {
    for (const id of TRACK_IDS) {
      const t = getTrack(id);
      const raised = (i: number) => t.flyovers.some((f) => f.raised[i]);
      let bad = 0;
      let all = 0;
      for (const w of Object.values(BASES)) {
        for (let i = 0; i < t.samples.length; i += 3) {
          for (const off of [-0.85, 0, 0.85]) {
            const n = t.normals[i];
            const x = t.samples[i].x + n.x * t.def.halfWidth * off;
            const y = t.samples[i].y + n.y * t.def.halfWidth * off;
            const a = t.tangentAngles[i];
            const deck = raised(i);
            const p = carPose(t, x, y, a, deck, w);
            expect(Math.abs(p.pitch)).toBeLessThanOrEqual(0.3);
            expect(Math.abs(p.roll)).toBeLessThanOrEqual(0.2);
            const ca = Math.cos(a);
            const sa = Math.sin(a);
            for (const [along, side] of [
              [w.front, -w.half],
              [w.front, w.half],
              [-w.rear, -w.half],
              [-w.rear, w.half],
            ]) {
              const ground = carHeightAt(t, x + along * ca - side * sa, y + along * sa + side * ca, deck);
              const wheel = p.height + along * Math.tan(p.pitch) + side * Math.tan(p.roll);
              all++;
              if (Math.abs(wheel - ground) > 1.5) bad++;
            }
          }
        }
      }
      expect(bad / all, id).toBeLessThan(0.005);
    }
  }, 120_000);

  it('tilts the nose up going uphill and the high side up across a slope', () => {
    // Alpine climbs and banks enough to see both.
    const t = getTrack('alpine');
    const w = BASES.rally;
    let up = 0;
    let checked = 0;
    for (let i = 0; i < t.samples.length; i += 5) {
      const p = t.samples[i];
      const a = t.tangentAngles[i];
      const ahead = carHeightAt(t, p.x + Math.cos(a) * 10, p.y + Math.sin(a) * 10);
      const behind = carHeightAt(t, p.x - Math.cos(a) * 10, p.y - Math.sin(a) * 10);
      if (Math.abs(ahead - behind) < 2) continue;
      checked++;
      if (Math.sign(carPose(t, p.x, p.y, a, false, w).pitch) === Math.sign(ahead - behind)) up++;
    }
    expect(checked).toBeGreaterThan(10);
    expect(up / checked).toBeGreaterThan(0.95);
  }, 30_000);
});
