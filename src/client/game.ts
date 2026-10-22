import {
  createRace,
  DEFAULT_CAR_MODE,
  DT,
  spawnAiKind,
  spawnKind,
  step,
  type CarConfig,
  type CarKind,
  type CarMode,
  type GameState,
  type PlayerInput,
  type TickInputs,
} from '../sim';
import { AI_NAMES, CAR_COLORS, MAX_PLAYERS, clampAiCount } from '../net/protocol';
import { BINDINGS_P1, BINDINGS_P2, BINDINGS_SOLO, Keyboard, mergeInputs, NO_PLAYER_INPUT } from './input';
import type { Renderer3D } from './renderer3d';

export interface GameOptions {
  humans: 1 | 2;
  aiCount: number;
  laps: number;
  trackId?: string;
  p1Car?: CarKind;
  p2Car?: CarKind;
  /** Default mixed. F1 forces every spawned car (picks ignored). */
  carMode?: CarMode;
  countdownSeconds?: number;
  setup?: (state: GameState) => void;
  scriptedInput?: (state: GameState) => PlayerInput;
}

const HUMAN_NAMES = ['Player 1', 'Player 2'] as const;

export function gridCars(options: GameOptions): CarConfig[] {
  const mode = options.carMode === 'f1' ? 'f1' : DEFAULT_CAR_MODE;
  const humanCount = options.humans === 2 ? 2 : 1;
  const aiCount = clampAiCount(humanCount, options.aiCount);
  const p1 = spawnKind(options.p1Car, mode);
  const p2 = spawnKind(options.p2Car, mode);
  const humanKinds: CarKind[] = humanCount === 2 ? [p1, p2] : [p1];
  const humans: CarConfig[] = HUMAN_NAMES.slice(0, humanCount).map((name, i) => ({
    name,
    color: CAR_COLORS[i],
    controller: 'human',
    kind: humanKinds[i],
  }));
  const ai: CarConfig[] = Array.from({ length: aiCount }, (_, i) => ({
    name: AI_NAMES[i] ?? `AI ${i + 1}`,
    color: CAR_COLORS[humanCount + i] ?? CAR_COLORS[CAR_COLORS.length - 1],
    controller: 'ai' as const,
    kind: spawnAiKind(i, humanKinds, mode),
  }));
  return [...humans, ...ai].slice(0, MAX_PLAYERS);
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
    const cars = gridCars(this.options);
    const trackId = this.options.trackId ?? 'meadow';
    this.renderer.setTrack(trackId);
    this.curr = createRace({
      trackId,
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
