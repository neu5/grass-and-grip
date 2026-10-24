import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FASTEST_LAPS_KEY, loadFastestLaps, persistFastestLaps, saveFastestLaps } from '../src/client/fastestStore';
import { layoutKey, registerTrack, starterTrack, TRACKS, type FastestLap, type TrackDef } from '../src/sim';

/** Just enough of localStorage for the store. */
class MemoryStorage {
  private data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, String(v));
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

const lap = (trackId: string, ticks: number, name = 'Ada'): FastestLap => ({ name, ticks, trackId, car: 'rally', color: '#e8443a' });

describe('lap records and track layouts', () => {
  beforeEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it('keeps records while the layout stays the same', () => {
    saveFastestLaps('meadow', [lap('meadow', 400)]);
    expect(loadFastestLaps('meadow').map((l) => l.ticks)).toEqual([400]);
    persistFastestLaps('meadow', [lap('meadow', 380, 'Bo')]);
    expect(loadFastestLaps('meadow').map((l) => l.name)).toEqual(['Bo', 'Ada']);
  });

  it('drops records saved before layouts were tracked, or on an older layout', () => {
    // An old save with no layout stamp, from before the tracks were rebuilt.
    localStorage.setItem(FASTEST_LAPS_KEY, JSON.stringify({ meadow: [lap('meadow', 300)] }));
    expect(loadFastestLaps('meadow')).toEqual([]);

    const def = starterTrack('custom-layout-test', 'Layout');
    registerTrack(def);
    saveFastestLaps(def.id, [lap(def.id, 500)]);
    expect(loadFastestLaps(def.id)).toHaveLength(1);
    // Move one point: a different road, so the old time no longer counts.
    registerTrack({ ...def, controlPoints: def.controlPoints.map((p, i) => (i === 3 ? { x: p.x + 40, y: p.y } : p)) });
    expect(loadFastestLaps(def.id)).toEqual([]);
    // A new lap starts a fresh board for the new layout.
    persistFastestLaps(def.id, [lap(def.id, 520, 'Bo')]);
    expect(loadFastestLaps(def.id).map((l) => l.name)).toEqual(['Bo']);
  });

  it('gives every built-in track its own layout key', () => {
    const keys = Object.values(TRACKS).map((d) => layoutKey(d));
    expect(new Set(keys).size).toBe(keys.length);
    const renamed: TrackDef = { ...TRACKS.meadow, name: 'Renamed' };
    expect(layoutKey(TRACKS.meadow)).toBe(layoutKey(renamed));
  });
});
