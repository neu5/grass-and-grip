import { copyFastestLaps, type FastestLap } from '../sim';

export const FASTEST_LAPS_KEY = 'gg-fastest-laps';

type Store = Record<string, FastestLap[]>;

function readStore(): Store {
  try {
    const raw = localStorage.getItem(FASTEST_LAPS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Store;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch {
    return {};
  }
}

export function loadFastestLaps(trackId: string): FastestLap[] {
  return copyFastestLaps(readStore()[trackId]);
}

export function saveFastestLaps(trackId: string, list: FastestLap[]): void {
  try {
    const store = readStore();
    store[trackId] = copyFastestLaps(list);
    localStorage.setItem(FASTEST_LAPS_KEY, JSON.stringify(store));
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
