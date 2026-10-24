import { MAP_SIZE_NAMES, mapSizeOf, type TrackDef } from '../sim';

/** Radio/checkbox caption: the track name plus its map size. */
export function trackLabelHtml(def: TrackDef): string {
  const name = def.name.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  return `${name} <small class="map-size">${MAP_SIZE_NAMES[mapSizeOf(def)]}</small>`;
}
