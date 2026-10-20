import { createRace, DT, step, type CarConfig, type CarKind, type GameState, type PlayerInput, type TickInputs } from '../sim';
import { BINDINGS_P1, BINDINGS_P2, BINDINGS_SOLO, Keyboard, mergeInputs, NO_PLAYER_INPUT } from './input';
import type { Renderer3D } from './renderer3d';

export interface GameOptions {
  humans: 1 | 2;
  aiCount: number;
  laps: number;
  p1Car?: CarKind;
  p2Car?: CarKind;
  countdownSeconds?: number;
  setup?: (state: GameState) => void;
  scriptedInput?: (state: GameState) => PlayerInput;
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

function aiKind(index: number, humans: CarKind[]): CarKind {
  if (index === 0) {
    if (!humans.includes('f1')) return 'f1';
    if (!humans.includes('rally')) return 'rally';
  }
  return index % 2 === 0 ? 'f1' : 'rally';
}
const MAX_STEPS_PER_FRAME = 8;

export class Game {
  private prev!: GameState;
  private curr!: GameState;
  private acc = 0;
  private lastTime = 0;
  private raf = 0;
  private humanIds: number[] = [];
  /** Every tick's inputs, in order: enough to replay the race exactly. */
  inputLog: TickInputs[] = [];

  constructor(
    private renderer: Renderer3D,
    private keyboard: Keyboard,
    private options: GameOptions,
    private extraInput?: { sample(): PlayerInput },
  ) {
    this.reset();
  }

  get state(): GameState {
    return this.curr;
  }

  reset() {
    const p1: CarKind = this.options.p1Car === 'f1' ? 'f1' : 'rally';
    const p2: CarKind = this.options.p2Car === 'f1' ? 'f1' : 'rally';
    const humanKinds: CarKind[] = this.options.humans === 2 ? [p1, p2] : [p1];
    const humans = HUMAN_CARS.slice(0, this.options.humans).map((c, i) => ({ ...c, kind: humanKinds[i] }));
    const ai = AI_CARS.slice(0, this.options.aiCount).map((c, i) => ({ ...c, kind: aiKind(i, humanKinds) }));
    const cars = [...humans, ...ai];
    this.curr = createRace({
      trackId: 'meadow',
      totalLaps: this.options.laps,
      cars,
      countdownSeconds: this.options.countdownSeconds,
    });
    this.options.setup?.(this.curr);
    this.prev = this.curr;
    this.humanIds = cars.map((c, i) => (c.controller === 'human' ? i : -1)).filter((i) => i >= 0);
    this.inputLog = [];
    this.acc = 0;
    this.renderer.resetRace();
  }

  private sampleInputs(): TickInputs {
    if (this.options.scriptedInput) return { 0: this.options.scriptedInput(this.curr) };
    const extra = this.extraInput?.sample() ?? NO_PLAYER_INPUT;
    if (this.options.humans === 1) return { 0: mergeInputs(this.keyboard.sample(BINDINGS_SOLO), extra) };
    return { 0: mergeInputs(this.keyboard.sample(BINDINGS_P1), extra), 1: this.keyboard.sample(BINDINGS_P2) };
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
