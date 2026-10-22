import { parseTrackDef, registerTrack, type TrackDef } from '../sim';

export const CUSTOM_TRACKS_KEY = 'gg-custom-tracks';

function readAll(): TrackDef[] {
  try {
    const raw = JSON.parse(localStorage.getItem(CUSTOM_TRACKS_KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw.map(parseTrackDef).filter((d): d is TrackDef => d !== null);
  } catch {
    return [];
  }
}

function writeAll(defs: TrackDef[]): void {
  try {
    localStorage.setItem(CUSTOM_TRACKS_KEY, JSON.stringify(defs));
  } catch {
    // Storage full or blocked: nothing we can do from here.
  }
}

/** Every saved custom track, registered with the sim so it can be raced. */
export function loadCustomTracks(): TrackDef[] {
  const defs = readAll();
  for (const d of defs) registerTrack(d);
  return defs;
}

export function saveCustomTrack(def: TrackDef): void {
  const defs = readAll().filter((d) => d.id !== def.id);
  defs.push(def);
  writeAll(defs);
  registerTrack(def);
}

export function deleteCustomTrack(id: string): void {
  writeAll(readAll().filter((d) => d.id !== id));
}
