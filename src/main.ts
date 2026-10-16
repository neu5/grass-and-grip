import './style.css';
import { Game, type GameOptions } from './client/game';
import { Keyboard } from './client/input';
import { Renderer3D } from './client/renderer3d';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const hud = document.querySelector<HTMLCanvasElement>('#hud')!;
const renderer = new Renderer3D(canvas, hud, 'meadow');
const menu = document.querySelector<HTMLDivElement>('#menu')!;
const form = document.querySelector<HTMLFormElement>('#menu-form')!;
const keyboard = new Keyboard(window);
let game: Game | null = null;

function selected(name: string): string {
  return (form.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value ?? '') as string;
}

function updateControlsHint() {
  const two = selected('humans') === '2';
  document.querySelector('#hint-solo')!.toggleAttribute('hidden', two);
  document.querySelector('#hint-duo')!.toggleAttribute('hidden', !two);
}

form.addEventListener('change', updateControlsHint);
updateControlsHint();

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const options: GameOptions = {
    humans: selected('humans') === '2' ? 2 : 1,
    aiCount: Number(selected('ai')),
    laps: Number(selected('laps')),
  };
  game?.stop();
  game = new Game(renderer, keyboard, options);
  (window as unknown as { race: Game }).race = game;
  menu.hidden = true;
  canvas.focus();
  game.start();
});

window.addEventListener('keydown', (e) => {
  if (!game || !menu.hidden) return;
  if (e.code === 'KeyR') game.reset();
  if (e.code === 'KeyC') renderer.toggleCamera();
  if (e.code === 'Escape') {
    game.stop();
    game = null;
    menu.hidden = false;
  }
});
