import { describe, expect, it } from 'vitest';
import { getTrack, inBridge, inWater, mapSizeOf, themeOf, THEMES, TRACK_IDS, TRACK_NAMES, TRACKS } from '../src/sim';

describe('built-in maps', () => {
  it('has eight tracks across the three map sizes and every theme', () => {
    expect(TRACK_IDS).toHaveLength(8);
    const sizes = TRACK_IDS.map((id) => mapSizeOf(TRACKS[id]));
    expect(sizes.filter((s) => s === 'small')).toHaveLength(2);
    expect(sizes.filter((s) => s === 'medium')).toHaveLength(4);
    expect(sizes.filter((s) => s === 'large')).toHaveLength(2);
    expect(new Set(TRACK_IDS.map((id) => themeOf(TRACKS[id])))).toEqual(new Set(THEMES));
    for (const id of TRACK_IDS) {
      expect(TRACKS[id].id).toBe(id);
      expect(TRACKS[id].name).toBe(TRACK_NAMES[id]);
    }
    expect(new Set(TRACK_IDS.map((id) => TRACKS[id].name)).size).toBe(8);
  });

  it.each(TRACK_IDS)('bridges every stretch of road over water on %s', (id) => {
    const t = getTrack(id);
    for (const p of t.samples) if (inWater(t, p.x, p.y)) expect(inBridge(t, p.x, p.y), id).toBe(true);
  });
});
