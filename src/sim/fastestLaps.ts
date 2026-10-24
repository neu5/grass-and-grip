import type { TrackDef } from './track';
import { toCarKind, type CarKind, type FastestLap, type GameState } from './types';

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

/** This race's best lap when it beats the track record from before the race (or there was none). */
export function newTrackRecord(state: Pick<GameState, 'fastestLaps' | 'trackRecord'>): FastestLap | null {
  const best = state.fastestLaps?.[0];
  if (!best) return null;
  return !state.trackRecord || best.ticks < state.trackRecord.ticks ? best : null;
}

/** Laps finished by every car so far: changes exactly when the race board can change. */
export function lapsDone(state: GameState): number {
  return state.cars.reduce((n, c) => n + c.lapsCompleted, 0);
}

/** Rebuild a sanitized, capped top 3 (first-seen wins ties). */
export function copyFastestLaps(list?: readonly FastestLap[]): FastestLap[] {
  if (!list?.length) return [];
  let out: FastestLap[] = [];
  for (const entry of list) out = insertFastestLap(out, entry);
  return out;
}

/**
 * A short fingerprint of a track's layout. Lap times only compare on the same
 * road, so saved records are dropped when this changes.
 */
export function layoutKey(def: Pick<TrackDef, 'width' | 'height' | 'halfWidth' | 'controlPoints'>): string {
  const text = JSON.stringify([def.width, def.height, def.halfWidth, def.controlPoints.map((p) => [Math.round(p.x), Math.round(p.y)])]);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
