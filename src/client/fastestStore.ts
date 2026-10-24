import { copyFastestLaps, layoutKey, trackDef, type FastestLap } from '../sim';

export const FASTEST_LAPS_KEY = 'gg-fastest-laps';
/** Layout each track's saved laps were driven on (see `layoutKey`). */
export const FASTEST_LAYOUTS_KEY = 'gg-fastest-layouts';

type Store = Record<string, FastestLap[]>;

function read<T extends object>(key: string): Partial<T> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as T;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch {
    return {};
  }
}

/** The current layout of a track, or null when this page does not know the track. */
function currentLayout(trackId: string): string | null {
  const def = trackDef(trackId);
  return def ? layoutKey(def) : null;
}

export function loadFastestLaps(trackId: string): FastestLap[] {
  const layout = currentLayout(trackId);
  // Times from an older version of the road do not count any more.
  if (layout !== null && read<Record<string, string>>(FASTEST_LAYOUTS_KEY)[trackId] !== layout) return [];
  return copyFastestLaps(read<Store>(FASTEST_LAPS_KEY)[trackId]);
}

export function saveFastestLaps(trackId: string, list: FastestLap[]): void {
  try {
    const store = read<Store>(FASTEST_LAPS_KEY);
    store[trackId] = copyFastestLaps(list);
    localStorage.setItem(FASTEST_LAPS_KEY, JSON.stringify(store));
    const layout = currentLayout(trackId);
    if (layout !== null) {
      const layouts = read<Record<string, string>>(FASTEST_LAYOUTS_KEY);
      layouts[trackId] = layout;
      localStorage.setItem(FASTEST_LAYOUTS_KEY, JSON.stringify(layouts));
    }
  } catch {
    /* quota / private mode */
  }
}

/** Merge incoming laps into the per-track client store (refresh-safe). */
export function persistFastestLaps(trackId: string, incoming: FastestLap[]): FastestLap[] {
  const merged = copyFastestLaps([...loadFastestLaps(trackId), ...incoming]);
  saveFastestLaps(trackId, merged);
  return merged;
}
