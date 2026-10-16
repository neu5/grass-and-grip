import { createRace, DT, step, type CarConfig, type GameState, type TickInputs } from '../sim';
import { BINDINGS_P1, BINDINGS_P2, BINDINGS_SOLO, Keyboard } from './input';
import { Renderer } from './renderer';

export interface GameOptions {
  humans: 1 | 2;
  aiCount: number;
  laps: number;
}

const HUMAN_CARS: CarConfig[] = [
  { name: 'Player 1', color: '#e8443a', controller: 'human' },
  { name: 'Player 2', color: '#3a8ee8', controller: 'human' },
];
const AI_CARS: CarConfig[] = [
  { name: 'Rosa', color: '#f2c230', controller: 'ai' },
  { name: 'Viktor', color: '#9b59d0', controller: 'ai' },
  { name: 'Kenji', color: '#f0f0f0', controller: 'ai' },
];
const MAX_STEPS_PER_FRAME = 8;

export class Game {
  private prev!: GameState;
  private curr!: GameState;
  private renderer!: Renderer;
  private acc = 0;
  private lastTime = 0;
  private raf = 0;
  private humanIds: number[] = [];
  /** Every tick's inputs, in order: enough to replay the race exactly. */
  inputLog: TickInputs[] = [];

  constructor(
    private canvas: HTMLCanvasElement,
    private keyboard: Keyboard,
    private options: GameOptions,
  ) {
    this.reset();
  }

  get state(): GameState {
    return this.curr;
  }

  reset() {
    const cars = [...HUMAN_CARS.slice(0, this.options.humans), ...AI_CARS.slice(0, this.options.aiCount)];
    this.curr = createRace({ trackId: 'meadow', totalLaps: this.options.laps, cars });
    this.prev = this.curr;
    this.humanIds = cars.map((c, i) => (c.controller === 'human' ? i : -1)).filter((i) => i >= 0);
    this.inputLog = [];
    this.acc = 0;
    this.renderer = new Renderer(this.canvas, this.curr.trackId);
  }

  private sampleInputs(): TickInputs {
    if (this.options.humans === 1) return { 0: this.keyboard.sample(BINDINGS_SOLO) };
    return { 0: this.keyboard.sample(BINDINGS_P1), 1: this.keyboard.sample(BINDINGS_P2) };
  }

  start() {
    this.lastTime = performance.now();
    const frame = (now: number) => {
      this.acc += Math.min(0.25, (now - this.lastTime) / 1000);
      this.lastTime = now;
      let steps = 0;
      while (this.acc >= DT && steps < MAX_STEPS_PER_FRAME) {
        const inputs = this.sampleInputs();
        this.inputLog.push(inputs);
        this.prev = this.curr;
        this.curr = step(this.curr, inputs);
        this.renderer.onTick(this.curr);
        this.acc -= DT;
        steps++;
      }
      if (steps === MAX_STEPS_PER_FRAME) this.acc = 0;
      this.renderer.render(this.prev, this.curr, this.acc / DT, this.humanIds);
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop() {
    cancelAnimationFrame(this.raf);
  }
}
