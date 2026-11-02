import { MAP_SIZE_NAMES, mapSizeOf, themeOf, type CarKind, type TrackDef, type Vec2 } from '../sim';
import { THEME_LOOKS } from './themes';

export const GAME_NAME = 'Tiny Laps';

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Closed smooth path through the control points, the same curve the road follows. */
function loopPath(points: Vec2[]): string {
  const n = points.length;
  const p = (i: number) => points[(i + n) % n];
  const f = (v: number) => v.toFixed(0);
  let d = `M${f(p(0).x)} ${f(p(0).y)}`;
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [p(i - 1), p(i), p(i + 1), p(i + 2)];
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += `C${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(p2.x)} ${f(p2.y)}`;
  }
  return `${d}Z`;
}

/** Top-down mini map of a track: ground, water, road and the start line. */
export function trackThumbSvg(def: TrackDef): string {
  const look = THEME_LOOKS[themeOf(def)];
  const road = loopPath(def.controlPoints);
  const water = (def.rivers ?? [])
    .map((r) => `<path d="M${r.points.map((q) => `${q.x.toFixed(0)} ${q.y.toFixed(0)}`).join('L')}" stroke="#3f8fc9" stroke-width="${r.halfWidth * 2}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`)
    .join('');
  const [a, b] = def.controlPoints;
  const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  const hw = def.halfWidth;
  const asphalt = def.road === 'dirt' ? '#8a6a48' : '#3b3e44';
  return `<svg class="thumb" viewBox="0 0 ${def.width} ${def.height}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
<rect width="${def.width}" height="${def.height}" rx="${Math.min(def.width, def.height) * 0.06}" fill="${look.outside}"/>
${water}
<path d="${road}" stroke="rgba(0,0,0,0.25)" stroke-width="${hw * 2 + 40}" fill="none" stroke-linejoin="round"/>
<path d="${road}" stroke="${asphalt}" stroke-width="${hw * 2}" fill="none" stroke-linejoin="round"/>
<path d="${road}" stroke="rgba(255,255,255,0.55)" stroke-width="${hw * 0.12}" stroke-dasharray="${hw * 0.5} ${hw * 0.6}" fill="none"/>
<g transform="translate(${a.x.toFixed(0)} ${a.y.toFixed(0)}) rotate(${angle.toFixed(0)})">
<rect x="-${hw * 0.18}" y="-${hw}" width="${hw * 0.36}" height="${hw * 2}" fill="#fff"/>
<rect x="-${hw * 0.18}" y="-${hw}" width="${hw * 0.18}" height="${hw * 0.5}" fill="#111"/><rect x="0" y="-${hw * 0.5}" width="${hw * 0.18}" height="${hw * 0.5}" fill="#111"/>
<rect x="-${hw * 0.18}" y="0" width="${hw * 0.18}" height="${hw * 0.5}" fill="#111"/><rect x="0" y="${hw * 0.5}" width="${hw * 0.18}" height="${hw * 0.5}" fill="#111"/>
</g>
</svg>`;
}

/** Track picker card: mini map, name and map size. */
export function trackCardHtml(def: TrackDef): string {
  return `${trackThumbSvg(def)}<b>${escapeHtml(def.name)}</b><small class="map-size">${MAP_SIZE_NAMES[mapSizeOf(def)]}</small>`;
}

const BODIES: Record<CarKind, string> = {
  // Each car points up (nose at the top), body in the player's color via --car.
  rally: `<rect x="7" y="5" width="18" height="30" rx="5" fill="var(--car)"/><rect x="10" y="12" width="12" height="7" rx="2" fill="#1d2430"/><rect x="10" y="24" width="12" height="5" rx="2" fill="#1d2430"/><rect x="4" y="8" width="4" height="7" rx="1.5" fill="#15181d"/><rect x="24" y="8" width="4" height="7" rx="1.5" fill="#15181d"/><rect x="4" y="25" width="4" height="7" rx="1.5" fill="#15181d"/><rect x="24" y="25" width="4" height="7" rx="1.5" fill="#15181d"/>`,
  f1: `<rect x="8" y="2" width="16" height="4" rx="1" fill="var(--car)"/><path d="M14 4h4l2 26h-8z" fill="var(--car)"/><rect x="8" y="33" width="16" height="4" rx="1" fill="var(--car)"/><rect x="14" y="16" width="4" height="6" rx="2" fill="#1d2430"/><rect x="5" y="8" width="5" height="7" rx="1.5" fill="#15181d"/><rect x="22" y="8" width="5" height="7" rx="1.5" fill="#15181d"/><rect x="4" y="24" width="6" height="8" rx="1.5" fill="#15181d"/><rect x="22" y="24" width="6" height="8" rx="1.5" fill="#15181d"/>`,
  buggy: `<rect x="3" y="5" width="7" height="10" rx="3" fill="#15181d"/><rect x="22" y="5" width="7" height="10" rx="3" fill="#15181d"/><rect x="2" y="24" width="8" height="12" rx="3" fill="#15181d"/><rect x="22" y="24" width="8" height="12" rx="3" fill="#15181d"/><rect x="10" y="7" width="12" height="27" rx="4" fill="var(--car)"/><rect x="11" y="14" width="10" height="12" rx="2" fill="none" stroke="#e9eef5" stroke-width="2"/>`,
  truck: `<rect x="6" y="3" width="20" height="11" rx="3" fill="var(--car)"/><rect x="9" y="6" width="14" height="4" rx="1.5" fill="#1d2430"/><rect x="6" y="15" width="20" height="22" rx="2" fill="#c9ccd2"/><rect x="8" y="17" width="16" height="18" rx="1" fill="var(--car)" opacity="0.55"/><rect x="3" y="6" width="4" height="7" rx="1.5" fill="#15181d"/><rect x="25" y="6" width="4" height="7" rx="1.5" fill="#15181d"/><rect x="3" y="27" width="4" height="8" rx="1.5" fill="#15181d"/><rect x="25" y="27" width="4" height="8" rx="1.5" fill="#15181d"/>`,
  kart: `<rect x="5" y="9" width="5" height="6" rx="1.5" fill="#15181d"/><rect x="22" y="9" width="5" height="6" rx="1.5" fill="#15181d"/><rect x="4" y="26" width="6" height="7" rx="1.5" fill="#15181d"/><rect x="22" y="26" width="6" height="7" rx="1.5" fill="#15181d"/><path d="M11 7h10l2 25H9z" fill="var(--car)"/><circle cx="16" cy="22" r="4" fill="#f2f2f2"/><circle cx="16" cy="22" r="2" fill="#1d2430"/>`,
};

/** Small top-down car in the color of the nearest `--car` CSS variable. */
export function carIconSvg(kind: CarKind | 'mixed'): string {
  if (kind === 'mixed') {
    return `<svg class="car-icon" viewBox="0 0 40 40" aria-hidden="true"><g transform="translate(-2 2) rotate(-14 16 20) scale(0.85)">${BODIES.f1}</g><g transform="translate(12 4) rotate(12 16 20) scale(0.85)" style="--car:#3a8ee8">${BODIES.rally}</g></svg>`;
  }
  return `<svg class="car-icon" viewBox="0 0 32 40" aria-hidden="true">${BODIES[kind]}</svg>`;
}

/** The game's mark: a little loop with a chequered line and a red car on it. */
export function logoMarkSvg(): string {
  return `<svg class="logo-mark" viewBox="0 0 64 44" aria-hidden="true">
<rect x="4" y="4" width="56" height="36" rx="18" fill="none" stroke="#2e3238" stroke-width="10"/>
<rect x="4" y="4" width="56" height="36" rx="18" fill="none" stroke="#ffd23f" stroke-width="1.6" stroke-dasharray="4 4"/>
<g transform="translate(30 0)"><rect width="3" height="3" fill="#fff"/><rect x="3" y="3" width="3" height="3" fill="#fff"/><rect y="6" width="3" height="3" fill="#fff"/><rect x="3" width="3" height="3" fill="#111"/><rect y="3" width="3" height="3" fill="#111"/><rect x="3" y="6" width="3" height="3" fill="#111"/></g>
<g transform="translate(46 33) rotate(-90) scale(0.32)" style="--car:#e8443a">${BODIES.rally}</g>
</svg>`;
}

/** Logo for the page header: mark plus wordmark. */
export function logoHtml(): string {
  return `${logoMarkSvg()}<span class="wordmark">Tiny<em>Laps</em></span>`;
}

/** Fill every `[data-logo]` element with the logo. */
export function mountLogos(root: ParentNode = document) {
  for (const el of root.querySelectorAll<HTMLElement>('[data-logo]')) {
    el.innerHTML = logoHtml();
    el.setAttribute('aria-label', GAME_NAME);
  }
}

const KINDS = new Set<string>(['rally', 'f1', 'buggy', 'truck', 'kart', 'mixed']);

/** Put a car icon in front of the caption of every car radio under `root`. */
export function decorateCarPicks(root: ParentNode) {
  for (const input of root.querySelectorAll<HTMLInputElement>('.car-kinds input[type=radio]')) {
    const span = input.nextElementSibling;
    if (!span || !KINDS.has(input.value) || span.querySelector('.car-icon')) continue;
    span.insertAdjacentHTML('afterbegin', carIconSvg(input.value as CarKind | 'mixed'));
  }
}
