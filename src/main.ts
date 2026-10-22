import './style.css';
import { Game, gridCars, type GameOptions } from './client/game';
import {
  clearSeason,
  loadSeason,
  newSeason,
  pointsFor,
  raceOrder,
  saveSeason,
  scoreRound,
  seasonOver,
  seasonTable,
  type Season,
} from './client/championship';
import { Keyboard } from './client/input';
import { aiPitDemoOptions } from './client/aiPitDemo';
import { damageDemoOptions } from './client/damageDemo';
import { fillFastestList } from './client/fastestBoard';
import { fastestLapsDemoOptions } from './client/fastestLapsDemo';
import { loadFastestLaps } from './client/fastestStore';
import { mapDemoOptions } from './client/mapDemo';
import { pitDemoOptions } from './client/pitDemo';
import { SoundEngine } from './client/audio';
import { Renderer3D } from './client/renderer3d';
import { mountLapsPicker } from './client/lapsPicker';
import { mountRulesFields, mountSetupFields } from './client/raceOptionsUi';
import { applyTouchMenuHints, detectMobile, mountTouchControls } from './client/touchControls';
import { CAR_KIND_SHORT, MAX_PLAYERS, TRACK_NAMES, clampAiCount, clampLaps, parseCarKind, parseCarMode, type TrackId } from './net/protocol';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const hud = document.querySelector<HTMLCanvasElement>('#hud')!;
const renderer = new Renderer3D(canvas, hud, 'meadow');
const sound = new SoundEngine();
renderer.sound = sound;
// Audio may only start after a gesture.
for (const ev of ['pointerdown', 'keydown'] as const) window.addEventListener(ev, () => sound.unlock(), { capture: true });
const menu = document.querySelector<HTMLDivElement>('#menu')!;
const form = document.querySelector<HTMLFormElement>('#menu-form')!;
const keyboard = new Keyboard(window);
const mobile = detectMobile();
applyTouchMenuHints(mobile);
if (mobile) {
  renderer.keyHints = false;
  renderer.finishHint = 'Race over';
}
const touch = mobile
  ? mountTouchControls({
      onCamera: () => {
        if (game && menu.hidden) renderer.toggleCamera();
      },
    })
  : null;
let game: Game | null = null;

function selected(name: string): string {
  return (form.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value ?? '') as string;
}

const p1Setup = mountSetupFields(document.querySelector<HTMLElement>('#p1-setup')!, 'p1setup');
const p2Setup = mountSetupFields(document.querySelector<HTMLElement>('#p2-setup')!, 'p2setup');
const rules = mountRulesFields(
  document.querySelector<HTMLElement>('#rules')!,
  'rule',
  undefined,
  document.querySelector<HTMLElement>('#ai-level')!,
);

/** A one-make grid locks both pickers to that car. */
function lockCarPicks(oneMake: string | null) {
  for (const name of ['p1car', 'p2car'] as const) {
    for (const input of form.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)) {
      input.disabled = oneMake !== null;
      if (oneMake && input.value === oneMake) input.checked = true;
    }
  }
}

function updateControlsHint() {
  const two = selected('humans') === '2';
  const humans = two ? 2 : 1;
  const mode = parseCarMode(selected('carmode')) ?? 'mixed';
  document.querySelector('#hint-solo')!.toggleAttribute('hidden', mobile || two);
  document.querySelector('#hint-duo')!.toggleAttribute('hidden', mobile || !two);
  document.querySelector('#p2-car')!.toggleAttribute('hidden', !two);
  document.querySelector('#p2-setup')!.toggleAttribute('hidden', !two);
  const championship = selected('series') === 'season';
  document.querySelector('#season-tracks')!.toggleAttribute('hidden', !championship);
  document.querySelector('#single-track')!.toggleAttribute('hidden', championship);
  document.querySelector('#start')!.textContent = championship ? 'Start championship' : 'Start race';
  lockCarPicks(mode === 'mixed' ? null : mode);
  const maxAi = MAX_PLAYERS - humans;
  for (const input of form.querySelectorAll<HTMLInputElement>('input[name="ai"]')) {
    const n = Number(input.value);
    input.disabled = n > maxAi;
    if (input.disabled && input.checked) input.checked = false;
  }
  if (!form.querySelector('input[name="ai"]:checked')) {
    const fallback = form.querySelector<HTMLInputElement>(`input[name="ai"][value="${maxAi}"]`);
    if (fallback) fallback.checked = true;
  }
}

function refreshFastestBoard() {
  const ol = document.querySelector<HTMLOListElement>('#fastest-laps ol');
  if (!ol) return;
  fillFastestList(ol, loadFastestLaps(selected('track') || 'meadow'));
}

form.addEventListener('change', () => {
  updateControlsHint();
  refreshFastestBoard();
});
updateControlsHint();
refreshFastestBoard();
mountLapsPicker(form);

{
  const demo = new URLSearchParams(location.search).get('demo');
  if (demo === 'pit' || demo === 'damage' || demo === 'map' || demo === 'aipit' || demo === 'eight' || demo === 'laps') {
    menu.hidden = true;
    const options =
      demo === 'damage'
        ? damageDemoOptions()
        : demo === 'map'
          ? mapDemoOptions(renderer)
          : demo === 'aipit'
            ? aiPitDemoOptions()
            : demo === 'eight'
              ? { humans: 1 as const, aiCount: 7, laps: 3, carMode: 'f1' as const, countdownSeconds: 6 }
              : demo === 'laps'
                ? fastestLapsDemoOptions(renderer)
                : pitDemoOptions();
    game = new Game(renderer, keyboard, options);
    if (demo === 'eight' || demo === 'laps') renderer.cameraMode = 'overview';
    (window as unknown as { race: Game }).race = game;
    canvas.focus();
    game.start();
  }
}

/** Season options are plain data; callbacks are added per round. */
type SeasonOptions = Omit<GameOptions, 'onFinish' | 'setup' | 'scriptedInput' | 'trackId'>;
let season: Season<SeasonOptions> | null = null;
const seasonEl = document.querySelector<HTMLDivElement>('#season')!;
const resumeBtn = document.querySelector<HTMLButtonElement>('#resume-season')!;

function trackName(id: string): string {
  return TRACK_NAMES[id as TrackId] ?? id;
}

const raceOverHint = renderer.finishHint;

function startGame(options: GameOptions, finishHint = raceOverHint) {
  renderer.finishHint = finishHint;
  game?.stop();
  game = new Game(renderer, keyboard, options, touch ?? undefined);
  (window as unknown as { race: Game }).race = game;
  menu.hidden = true;
  seasonEl.hidden = true;
  touch?.setVisible(true);
  canvas.focus();
  game.start();
}

function startRound() {
  if (!season || seasonOver(season)) return;
  const trackId = season.tracks[season.round];
  startGame({
    ...season.options,
    trackId,
    onFinish: (state) => {
      if (!season) return;
      season = scoreRound(season, raceOrder(state));
      saveSeason(season);
      // Let the finish sink in before the tables cover it.
      setTimeout(showSeason, 2500);
    },
  }, 'Championship results coming up…');
}

function rowHtml(cells: string[], you: boolean) {
  return `<tr${you ? ' class="you"' : ''}>${cells.join('')}</tr>`;
}

function showSeason() {
  if (!season) return;
  const s = season;
  const over = seasonOver(s);
  const last = s.results[s.results.length - 1];
  const humans = new Set(gridCars(s.options).filter((c) => c.controller === 'human').map((c) => c.name));
  const driver = (name: string) => s.drivers.find((d) => d.name === name);
  const swatch = (name: string) => `<span class="swatch" style="background:${driver(name)?.color ?? '#888'}"></span>`;
  document.querySelector('#season-title')!.textContent = over
    ? 'Championship over'
    : `Round ${s.results.length} of ${s.tracks.length}: ${trackName(last.trackId)}`;
  document.querySelector('#season-sub')!.textContent = over
    ? `${s.tracks.length} races: ${s.tracks.map(trackName).join(', ')}`
    : `Next: ${trackName(s.tracks[s.round])}`;
  document.querySelector('#season-race')!.innerHTML = last.order
    .map((name, i) =>
      rowHtml(
        [`<td>${i + 1}.</td>`, `<td>${swatch(name)}${name}</td>`, `<td class="muted">${CAR_KIND_SHORT[driver(name)?.kind ?? 'rally']}</td>`, `<td class="num">+${pointsFor(i)}</td>`],
        humans.has(name),
      ),
    )
    .join('');
  const table = seasonTable(s);
  document.querySelector('#season-standings')!.innerHTML = table
    .map((r, i) => rowHtml([`<td>${i + 1}.</td>`, `<td>${swatch(r.name)}${r.name}</td>`, `<td class="muted">${r.wins}W</td>`, `<td class="num">${r.points}</td>`], humans.has(r.name)))
    .join('');
  const podium = document.querySelector<HTMLDivElement>('#season-podium')!;
  podium.hidden = !over;
  if (over) {
    const [first, second, third] = table;
    podium.innerHTML = [second && `<div class="p2"><span>2</span>${second.name}<br>${second.points} pts</div>`, first && `<div class="p1"><span>🏆</span>${first.name}<br>${first.points} pts</div>`, third && `<div class="p3"><span>3</span>${third.name}<br>${third.points} pts</div>`]
      .filter(Boolean)
      .join('');
  }
  document.querySelector<HTMLElement>('#season-race-box')!.hidden = false;
  const next = document.querySelector<HTMLButtonElement>('#season-next')!;
  next.textContent = over ? 'New championship' : `Next race: ${trackName(s.tracks[s.round])}`;
  seasonEl.hidden = false;
  touch?.setVisible(false);
}

function backToMenu() {
  sound.silence();
  game?.stop();
  game = null;
  touch?.setVisible(false);
  seasonEl.hidden = true;
  menu.hidden = false;
  refreshFastestBoard();
  refreshResume();
}

function refreshResume() {
  const saved = loadSeason<SeasonOptions>();
  const going = saved && !seasonOver(saved);
  resumeBtn.hidden = !going;
  if (going) resumeBtn.textContent = `Continue championship: round ${saved.round + 1} of ${saved.tracks.length}`;
}

document.querySelector('#season-next')!.addEventListener('click', () => {
  if (!season) return;
  if (seasonOver(season)) {
    clearSeason();
    season = null;
    backToMenu();
    return;
  }
  startRound();
});
document.querySelector('#season-menu')!.addEventListener('click', backToMenu);
resumeBtn.addEventListener('click', () => {
  season = loadSeason<SeasonOptions>();
  if (season && !seasonOver(season)) startRound();
});
refreshResume();

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const options: GameOptions = {
    humans: selected('humans') === '2' ? 2 : 1,
    aiCount: clampAiCount(selected('humans') === '2' ? 2 : 1, Number(selected('ai'))),
    laps: clampLaps(form.querySelector<HTMLInputElement>('input[name="laps"]')?.value),
    trackId: selected('track') || 'meadow',
    p1Car: parseCarKind(selected('p1car')) ?? 'rally',
    p2Car: parseCarKind(selected('p2car')) ?? 'rally',
    p1Setup: p1Setup.get(),
    p2Setup: p2Setup.get(),
    carMode: parseCarMode(selected('carmode')) ?? 'mixed',
    rules: rules.get(),
  };
  if (selected('series') === 'season') {
    const tracks = [...form.querySelectorAll<HTMLInputElement>('input[name="season-track"]:checked')].map((i) => i.value);
    if (tracks.length === 0) return;
    // Each round sets its own track.
    const { trackId: _single, ...seasonOptions } = options;
    const drivers = gridCars(options).map((c) => ({ name: c.name, color: c.color, kind: parseCarKind(c.kind) ?? 'rally' }));
    season = newSeason(tracks, drivers, seasonOptions);
    saveSeason(season);
    startRound();
    return;
  }
  season = null;
  startGame(options);
});

window.addEventListener('keydown', (e) => {
  if (!game || !menu.hidden) return;
  if (e.code === 'KeyR' && !season) game.reset();
  if (e.code === 'KeyC') renderer.toggleCamera();
  if (e.code === 'KeyU') renderer.toggleCheckpointDebug();
  if (e.code === 'KeyM') sound.toggleMute();
  // In a championship, R would rerun a scored race: not allowed.
  if (e.code === 'KeyR' && season) return;
  if (e.code === 'Escape') backToMenu();
});
