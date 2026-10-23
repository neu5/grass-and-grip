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
import { loadCustomTracks } from './client/customTracks';
import { Renderer3D } from './client/renderer3d';
import { mountLapsPicker } from './client/lapsPicker';
import { mountRulesFields, mountSetupFields } from './client/raceOptionsUi';
import { applyTouchMenuHints, detectMobile, mountTouchControls } from './client/touchControls';
import { CAR_COLORS, CAR_KIND_SHORT, COLOR_NAMES, MAX_PLAYERS, clampAiCount, clampLaps, parseCarKind, parseCarMode } from './net/protocol';
import { standings, ticksToTime, trackName as simTrackName, type GameState } from './sim';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const hud = document.querySelector<HTMLCanvasElement>('#hud')!;
const renderer = new Renderer3D(canvas, hud, 'meadow');
const sound = new SoundEngine();
renderer.sound = sound;
// Audio may only start after a gesture.
for (const ev of ['pointerdown', 'keydown'] as const) window.addEventListener(ev, () => sound.unlock(), { capture: true });
const menu = document.querySelector<HTMLDivElement>('#menu')!;
const form = document.querySelector<HTMLFormElement>('#menu-form')!;

// Tracks made in the editor join the pickers.
for (const def of loadCustomTracks()) {
  const name = def.name.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const single = document.createElement('label');
  single.innerHTML = `<input type="radio" name="track" value="${def.id}" /><span>${name}</span>`;
  document.querySelector('#single-track')!.append(single);
  const season = document.createElement('label');
  season.innerHTML = `<input type="checkbox" name="season-track" value="${def.id}" /><span>${name}</span>`;
  document.querySelector('#season-tracks')!.append(season);
}
{
  // The editor's Play button lands here with ?track=<id>.
  const wanted = new URLSearchParams(location.search).get('track');
  const input = wanted ? form.querySelector<HTMLInputElement>(`input[name="track"][value="${CSS.escape(wanted)}"]`) : null;
  if (input) input.checked = true;
}
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
      onMenu: () => backToMenu(),
    })
  : null;
let game: Game | null = null;

function selected(name: string): string {
  return (form.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value ?? '') as string;
}

// Driver names and colors, remembered between visits.
const DRIVERS_KEY = 'gg-local-drivers';
type SavedDriver = { name?: string; color?: string };
function loadDrivers(): SavedDriver[] {
  try {
    const raw = JSON.parse(localStorage.getItem(DRIVERS_KEY) ?? '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}
function saveDrivers(drivers: SavedDriver[]) {
  try {
    localStorage.setItem(DRIVERS_KEY, JSON.stringify(drivers));
  } catch {
    // Private mode: names just won't be remembered.
  }
}
const nameInputs = [1, 2].map((n) => document.querySelector<HTMLInputElement>(`#p${n}-name`)!);
for (const n of [1, 2]) {
  const box = document.querySelector<HTMLElement>(`#p${n}-colors`)!;
  for (const c of CAR_COLORS) {
    const l = document.createElement('label');
    l.innerHTML = `<input type="radio" name="p${n}color" value="${c}" /><span style="background:${c}33;border-color:${c}">${COLOR_NAMES[c]}</span>`;
    box.append(l);
  }
}
{
  const saved = loadDrivers();
  [0, 1].forEach((i) => {
    nameInputs[i].value = saved[i]?.name ?? '';
    const color = saved[i]?.color && (CAR_COLORS as readonly string[]).includes(saved[i].color!) ? saved[i].color! : CAR_COLORS[i];
    form.querySelector<HTMLInputElement>(`input[name="p${i + 1}color"][value="${color}"]`)!.checked = true;
  });
}

/** The two players can't share a color: grey out the other player's pick. */
function lockColors() {
  const two = selected('humans') === '2';
  const c1 = selected('p1color');
  const c2 = selected('p2color');
  for (const input of form.querySelectorAll<HTMLInputElement>('input[name="p1color"]')) input.disabled = two && input.value === c2;
  for (const input of form.querySelectorAll<HTMLInputElement>('input[name="p2color"]')) input.disabled = input.value === c1;
  if (two && c1 === c2) {
    const free = form.querySelector<HTMLInputElement>('input[name="p2color"]:not(:disabled)');
    if (free) free.checked = true;
  }
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
  document.querySelector('#p2-who')!.toggleAttribute('hidden', !two);
  lockColors();
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
  return simTrackName(id);
}

const raceOverHint = renderer.finishHint;

function startGame(options: GameOptions, finishHint = raceOverHint) {
  renderer.finishHint = finishHint;
  game?.stop();
  game = new Game(renderer, keyboard, options, touch ?? undefined);
  (window as unknown as { race: Game }).race = game;
  menu.hidden = true;
  seasonEl.hidden = true;
  raceOverEl.hidden = true;
  touch?.setVisible(true);
  canvas.focus();
  game.start();
}

const raceOverEl = document.querySelector<HTMLDivElement>('#race-over')!;

/** Single race finished: results with Race again / Back to menu (works with touch too). */
function showRaceOver(state: GameState) {
  const order = standings(state);
  const humans = order.filter((c) => c.controller === 'human');
  document.querySelector('#race-over-title')!.textContent = `${order[0].name} wins!`;
  document.querySelector('#race-over-sub')!.textContent = humans
    .map((c) => `${c.name}: P${order.indexOf(c) + 1} of ${order.length}`)
    .join(' · ');
  document.querySelector('#race-over-order')!.innerHTML = order
    .map(
      (c, i) =>
        `<tr${c.controller === 'human' ? ' class="you"' : ''}><td>${i + 1}.</td><td><span class="swatch" style="background:${c.color}"></span>${escapeHtml(c.name)}</td><td class="muted">${CAR_KIND_SHORT[c.kind]}</td><td class="num">${c.bestLapTicks !== null ? ticksToTime(c.bestLapTicks) : '–'}</td></tr>`,
    )
    .join('');
  raceOverEl.hidden = false;
  touch?.setVisible(false);
}

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function raceAgain() {
  if (!game) return;
  raceOverEl.hidden = true;
  touch?.setVisible(true);
  game.reset();
  canvas.focus();
}

document.querySelector('#race-again')!.addEventListener('click', raceAgain);
document.querySelector('#race-menu')!.addEventListener('click', () => backToMenu());

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
  raceOverEl.hidden = true;
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
    p1Name: nameInputs[0].value,
    p2Name: nameInputs[1].value,
    p1Color: selected('p1color'),
    p2Color: selected('p2color'),
    carMode: parseCarMode(selected('carmode')) ?? 'mixed',
    rules: rules.get(),
  };
  saveDrivers([0, 1].map((i) => ({ name: nameInputs[i].value.trim(), color: selected(`p${i + 1}color`) })));
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
  startGame({
    ...options,
    // Let the finish sink in, then offer the way back.
    onFinish: (state) => setTimeout(() => game?.state.phase === 'finished' && showRaceOver(state), 1500),
  });
});

window.addEventListener('keydown', (e) => {
  if (!game || !menu.hidden) return;
  if (e.code === 'KeyR' && !season) raceAgain();
  if (e.code === 'KeyC') renderer.toggleCamera();
  if (e.code === 'KeyU') renderer.toggleCheckpointDebug();
  if (e.code === 'KeyM') sound.toggleMute();
  // In a championship, R would rerun a scored race: not allowed.
  if (e.code === 'KeyR' && season) return;
  if (e.code === 'Escape') backToMenu();
});
