import { CAR_KIND_NAMES, ticksToTime, type FastestLap } from '../sim';

export function fillFastestList(ol: HTMLElement, laps: FastestLap[]): void {
  if (!laps.length) {
    ol.innerHTML = '<li class="muted">No laps yet</li>';
    return;
  }
  ol.innerHTML = laps
    .map((e, i) => {
      const car = CAR_KIND_NAMES[e.car] ?? e.car;
      return `<li><span class="swatch" style="background:${escapeHtml(e.color)}"></span><span class="grow">${i + 1}. ${escapeHtml(e.name)} <span class="badge">${escapeHtml(car)}</span></span><span class="time">${ticksToTime(e.ticks)}</span></li>`;
    })
    .join('');
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
