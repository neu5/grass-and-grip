import { toCarKind, type CarKind, type FastestLap } from './types';

export type { FastestLap };

export const FASTEST_LAP_LIMIT = 3;

export function sameFastestLap(a: FastestLap, b: FastestLap): boolean {
  return a.name === b.name && a.ticks === b.ticks && a.trackId === b.trackId && a.car === b.car;
}

function normalizeLap(entry: FastestLap): FastestLap | null {
  const ticks = Math.round(Number(entry.ticks));
  if (!Number.isFinite(ticks) || ticks <= 0) return null;
  const name = String(entry.name ?? '').trim().slice(0, 16) || 'Driver';
  const trackId = String(entry.trackId ?? '').trim() || 'meadow';
  const car: CarKind = toCarKind(entry.car);
  const color = String(entry.color ?? '').trim() || '#888888';
  return { name, ticks, trackId, car, color };
}

/**
 * Insert one lap into a fastest-first top 3.
 * Ties keep the earlier record (new equal times go after).
 * Returns the same array when nothing changes.
 */
export function insertFastestLap(list: readonly FastestLap[], raw: FastestLap): FastestLap[] {
  const entry = normalizeLap(raw);
  if (!entry) return list as FastestLap[];
  if (list.some((e) => sameFastestLap(e, entry))) return list as FastestLap[];
  if (list.length >= FASTEST_LAP_LIMIT && entry.ticks >= list[list.length - 1].ticks) {
    return list as FastestLap[];
  }
  const next = list.slice();
  let i = next.findIndex((e) => entry.ticks < e.ticks);
  if (i < 0) i = next.length;
  next.splice(i, 0, entry);
  return next.slice(0, FASTEST_LAP_LIMIT);
}

/** Rebuild a sanitized, capped top 3 (first-seen wins ties). */
export function copyFastestLaps(list?: readonly FastestLap[]): FastestLap[] {
  if (!list?.length) return [];
  let out: FastestLap[] = [];
  for (const entry of list) out = insertFastestLap(out, entry);
  return out;
}
