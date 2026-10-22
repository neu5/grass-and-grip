import './style.css';
import { Game, type GameOptions } from './client/game';
import { Keyboard } from './client/input';
import { aiPitDemoOptions } from './client/aiPitDemo';
import { damageDemoOptions } from './client/damageDemo';
import { fillFastestList } from './client/fastestBoard';
import { fastestLapsDemoOptions } from './client/fastestLapsDemo';
import { loadFastestLaps } from './client/fastestStore';
import { mapDemoOptions } from './client/mapDemo';
import { pitDemoOptions } from './client/pitDemo';
import { Renderer3D } from './client/renderer3d';
import { mountLapsPicker } from './client/lapsPicker';
import { mountRulesFields, mountSetupFields } from './client/raceOptionsUi';
import { applyTouchMenuHints, detectMobile, mountTouchControls } from './client/touchControls';
import { MAX_PLAYERS, clampAiCount, clampLaps, parseCarKind, parseCarMode } from './net/protocol';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const hud = document.querySelector<HTMLCanvasElement>('#hud')!;
const renderer = new Renderer3D(canvas, hud, 'meadow');
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
const rules = mountRulesFields(document.querySelector<HTMLElement>('#rules')!, 'rule');

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
  game?.stop();
  game = new Game(renderer, keyboard, options, touch ?? undefined);
  (window as unknown as { race: Game }).race = game;
  menu.hidden = true;
  touch?.setVisible(true);
  canvas.focus();
  game.start();
});

window.addEventListener('keydown', (e) => {
  if (!game || !menu.hidden) return;
  if (e.code === 'KeyR') game.reset();
  if (e.code === 'KeyC') renderer.toggleCamera();
  if (e.code === 'KeyU') renderer.toggleCheckpointDebug();
  if (e.code === 'Escape') {
    game.stop();
    game = null;
    touch?.setVisible(false);
    menu.hidden = false;
    refreshFastestBoard();
  }
});
