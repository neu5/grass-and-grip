import { describe, expect, it } from 'vitest';
import { encodeSnapshot, snapshotText } from '../src/net/snapshot';
import { createRace, distanceToCenterline, distToSegmentSq, getTrack, nearestSampleIndex, obstacleGround, step, terrainHeightAt, TRACK_IDS } from '../src/sim';

describe('road lookups', () => {
  it('give exactly what a loop over every road point gives, on and off the road', () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (const id of TRACK_IDS) {
      const t = getTrack(id);
      const s = t.samples;
      for (let k = 0; k < 1500; k++) {
        const p = s[Math.floor(rnd() * s.length)];
        // Mostly near the road, some anywhere on (or a little off) the map.
        const [x, y] =
          k % 4 === 0
            ? [rnd() * t.def.width * 1.4 - t.def.width * 0.2, rnd() * t.def.height * 1.4 - t.def.height * 0.2]
            : [p.x + (rnd() - 0.5) * 300, p.y + (rnd() - 0.5) * 300];
        let road = Infinity;
        let near = Infinity;
        let at = 0;
        for (let i = 0; i < s.length; i++) {
          road = Math.min(road, distToSegmentSq(x, y, s[i], s[(i + 1) % s.length]));
          const d = (s[i].x - x) ** 2 + (s[i].y - y) ** 2;
          if (d < near) {
            near = d;
            at = i;
          }
        }
        expect(distanceToCenterline(t, x, y)).toBe(Math.sqrt(road));
        expect(nearestSampleIndex(t, x, y)).toBe(at);
      }
    }
  }, 60_000);

  it('keeps the ground under every obstacle as it is', () => {
    const t = getTrack('alpine');
    const g = obstacleGround(t);
    t.def.obstacles.forEach((o, i) => expect(g.obstacles[i]).toBe(terrainHeightAt(t, o.x, o.y)));
  });
});

describe('snapshot message', () => {
  it('is the same message as encoding it per client, with that client’s ack', () => {
    let s = createRace({
      trackId: 'meadow',
      totalLaps: 3,
      countdownSeconds: 0,
      cars: [
        { name: 'A "quoted" name', color: '#fff', controller: 'human' },
        { name: 'B', color: '#000', controller: 'ai', kind: 'f1' },
      ],
    });
    for (let i = 0; i < 90; i++) s = step(s, { 0: { throttle: 1, steer: 0.2, handbrake: false } });
    const text = snapshotText(s);
    for (const ack of [0, 17]) expect(JSON.parse(text(ack))).toEqual({ t: 'snap', snap: { ...encodeSnapshot(s), ack } });
  });
});
