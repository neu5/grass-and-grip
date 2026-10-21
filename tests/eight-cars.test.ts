import { describe, expect, it } from 'vitest';
import { gridCars } from '../src/client/game';
import { CAR_COLORS, MAX_PLAYERS, clampAiCount } from '../src/net/protocol';
import { Room } from '../src/net/room';
import {
  CARS,
  GRID_SLOTS,
  PIT_STALLS,
  createRace,
  distanceToCenterline,
  getTrack,
  gridSlotPose,
  inPitLane,
  pitBoxIndex,
  step,
  surfaceAt,
} from '../src/sim';

const field = CAR_COLORS.map((color, i) => ({
  name: `C${i}`,
  color,
  controller: i === 0 ? ('human' as const) : ('ai' as const),
  kind: 'f1' as const,
}));

describe('8-car field', () => {
  it('caps local and online grids at 8 unique colors', () => {
    expect(CAR_COLORS).toHaveLength(8);
    expect(new Set(CAR_COLORS).size).toBe(8);
    expect(MAX_PLAYERS).toBe(8);
    const local = gridCars({ humans: 1, aiCount: 9, laps: 3 });
    expect(local).toHaveLength(8);
    expect(new Set(local.map((c) => c.color)).size).toBe(8);
    expect(clampAiCount(2, 7)).toBe(6);

    const room = new Room('eight');
    CAR_COLORS.forEach((c, i) => expect(room.join(`p${i}`, `P${i}`, c)).toBeNull());
    expect(room.join('extra', 'X', CAR_COLORS[0])).toBe('Room is full');
    expect(room.setSettings('p0', { aiCount: 1 })).toBe('Too many cars');
    expect(room.aiCount).toBe(0);
  });

  it('has four pit stalls off the racing line on meadow and harbor', () => {
    expect(PIT_STALLS).toBe(4);
    for (const id of ['meadow', 'harbor'] as const) {
      const track = getTrack(id);
      expect(track.def.pitBoxes).toHaveLength(4);
      for (const b of track.def.pitBoxes) {
        const cx = b.x + b.w / 2;
        const cy = b.y + b.h / 2;
        expect(inPitLane(track, cx, cy)).toBe(true);
        expect(surfaceAt(track, cx, cy)).toBe('asphalt');
        expect(distanceToCenterline(track, cx, cy)).toBeGreaterThan(track.def.halfWidth);
        expect(pitBoxIndex(track, cx, cy)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('places 8 staggered starts on asphalt, facing race direction, without overlap', () => {
    expect(GRID_SLOTS).toBe(8);
    const minSep = CARS.f1.radius + CARS.f1.radius;
    for (const id of ['meadow', 'harbor'] as const) {
      const track = getTrack(id);
      const race = createRace({ trackId: id, totalLaps: 3, cars: field });
      expect(race.cars).toHaveLength(8);
      const sf = track.samples[0];
      for (let i = 0; i < 8; i++) {
        const car = race.cars[i];
        const pose = gridSlotPose(track, i);
        expect(car.x).toBeCloseTo(pose.x, 8);
        expect(car.y).toBeCloseTo(pose.y, 8);
        expect(surfaceAt(track, car.x, car.y)).toBe('asphalt');
        expect(inPitLane(track, car.x, car.y)).toBe(false);
        expect(pitBoxIndex(track, car.x, car.y)).toBe(-1);
        const along = Math.cos(car.angle) * Math.cos(pose.angle) + Math.sin(car.angle) * Math.sin(pose.angle);
        expect(along).toBeGreaterThan(0.98);
        const noseX = car.x + Math.cos(car.angle) * 16;
        const noseY = car.y + Math.sin(car.angle) * 16;
        expect(surfaceAt(track, noseX, noseY)).toBe('asphalt');
        expect(Math.hypot(car.x - sf.x, car.y - sf.y)).toBeLessThan(220);
      }
      for (let i = 0; i < 8; i++) {
        for (let j = i + 1; j < 8; j++) {
          const d = Math.hypot(race.cars[i].x - race.cars[j].x, race.cars[i].y - race.cars[j].y);
          expect(d).toBeGreaterThan(minSep);
        }
      }
      let s = race;
      for (let t = 0; t < s.startTick + 8; t++) s = step(s, {});
      for (const car of s.cars) expect(car.damage).toBe(0);
    }
  });
});
