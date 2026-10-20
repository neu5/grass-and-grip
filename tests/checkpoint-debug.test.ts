import { describe, expect, it } from 'vitest';
import { checkpointDebugPose } from '../src/client/checkpointDebug';
import { getTrack } from '../src/sim';

describe('checkpoint debug poses', () => {
  const track = getTrack('meadow');

  it('places one overlay on every sim gate, finish first', () => {
    const poses = track.gates.map(checkpointDebugPose);
    expect(poses).toHaveLength(track.gates.length);
    expect(poses[0].finish).toBe(true);
    expect(poses.slice(1).every((p) => !p.finish)).toBe(true);
  });

  it('matches the sim checkpoint line endpoints', () => {
    track.gates.forEach((gate, i) => {
      const pose = checkpointDebugPose(gate, i);
      expect(pose.ax).toBe(gate.a.x);
      expect(pose.az).toBe(gate.a.y);
      expect(pose.bx).toBe(gate.b.x);
      expect(pose.bz).toBe(gate.b.y);
      expect(pose.cx).toBe(gate.center.x);
      expect(pose.cz).toBe(gate.center.y);
      expect(pose.width).toBeCloseTo(Math.hypot(gate.b.x - gate.a.x, gate.b.y - gate.a.y));
    });
  });
});
