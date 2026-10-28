import {
  createRace,
  DEFAULT_CAR_MODE,
  DT,
  lapsDone,
  orderGrid,
  parseCarMode,
  spawnAiKind,
  spawnKind,
  step,
  type CarConfig,
  type CarKind,
  type CarMode,
  type CarSetup,
  type GameState,
  type GridOrder,
  type PlayerInput,
  type RaceRules,
  type TickInputs,
} from '../sim';
import { AI_NAMES, CAR_COLORS, MAX_PLAYERS, clampAiCount } from '../net/protocol';
import { loadFastestLaps, persistFastestLaps } from './fastestStore';
import { BINDINGS_P1, BINDINGS_P2, BINDINGS_SOLO, Keyboard, mergeInputs, NO_PLAYER_INPUT } from './input';
import type { Renderer3D } from './renderer3d';
import { LapRecorder } from './lapRecorder';

export interface GameOptions {
  humans: 1 | 2;
  aiCount: number;
  laps: number;
  trackId?: string;
  p1Car?: CarKind;
  p2Car?: CarKind;
  p1Setup?: CarSetup;
  p2Setup?: CarSetup;
  /** Driver names; blank means "Player 1" / "Player 2". */
  p1Name?: string;
  p2Name?: string;
  /** One of CAR_COLORS each; clashes and unknown colors are sorted out in gridCars. */
  p1Color?: string;
  p2Color?: string;
  /** Default mixed. A car kind makes a one-make grid (picks ignored). */
  carMode?: CarMode;
  rules?: RaceRules;
  countdownSeconds?: number;
  setup?: (state: GameState) => void;
  scriptedInput?: (state: GameState) => PlayerInput;
  /** Persist top 3 to localStorage. Default true; demos turn it off. */
  persistFastest?: boolean;
  /** Called once when the race ends. */
  onFinish?: (state: GameState) => void;
  /**
   * Starting order. 'random' shuffles the grid on every start; a list of
   * driver names puts them on the grid in that order (pole first). Default:
   * players first, then AI.
   */
  grid?: GridOrder;
}

const HUMAN_NAMES = ['Player 1', 'Player 2'] as const;
export const MAX_NAME_LENGTH = 16;

function cleanName(raw: string | undefined, fallback: string): string {
  return String(raw ?? '').trim().slice(0, MAX_NAME_LENGTH) || fallback;
}

/** Human names and colors for the grid: never two drivers with the same name or color. */
function humanDrivers(options: GameOptions, count: number): { name: string; color: string }[] {
  const out: { name: string; color: string }[] = [];
  const wanted = [
    { name: options.p1Name, color: options.p1Color },
    { name: options.p2Name, color: options.p2Color },
  ];
  for (let i = 0; i < count; i++) {
    let name = cleanName(wanted[i].name, HUMAN_NAMES[i]);
    if (out.some((d) => d.name.toLowerCase() === name.toLowerCase())) name = `${name.slice(0, MAX_NAME_LENGTH - 2)} ${i + 1}`;
    const taken = out.map((d) => d.color);
    const pick = wanted[i].color;
    const color =
      pick && (CAR_COLORS as readonly string[]).includes(pick) && !taken.includes(pick)
        ? pick
        : CAR_COLORS.find((c) => !taken.includes(c))!;
    out.push({ name, color });
  }
  return out;
}

export function gridCars(options: GameOptions): CarConfig[] {
  const mode = parseCarMode(options.carMode) ?? DEFAULT_CAR_MODE;
  const humanCount = options.humans === 2 ? 2 : 1;
  const aiCount = clampAiCount(humanCount, options.aiCount);
  const p1 = spawnKind(options.p1Car, mode);
  const p2 = spawnKind(options.p2Car, mode);
  const humanKinds: CarKind[] = humanCount === 2 ? [p1, p2] : [p1];
  const setups = [options.p1Setup, options.p2Setup];
  const drivers = humanDrivers(options, humanCount);
  const humans: CarConfig[] = drivers.map((d, i) => ({
    name: d.name,
    color: d.color,
    controller: 'human',
    kind: humanKinds[i],
    setup: setups[i],
  }));
  // AI take the colors and names nobody else is using.
  const freeColors = CAR_COLORS.filter((c) => !drivers.some((d) => d.color === c));
  const humanNames = drivers.map((d) => d.name.toLowerCase());
  const freeNames = AI_NAMES.filter((n) => !humanNames.includes(n.toLowerCase()));
  const ai: CarConfig[] = Array.from({ length: aiCount }, (_, i) => ({
    name: freeNames[i] ?? `AI ${i + 1}`,
    color: freeColors[i] ?? CAR_COLORS[CAR_COLORS.length - 1],
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
  private held = false;
  /** Human laps, best kept per track and car for the AI report. */
  private recorder = new LapRecorder();
  /** Car id of each player, Player 1 first (the grid order may put them anywhere). */
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

  /** One human at the keys: pausing the race is allowed. */
  get solo(): boolean {
    return this.options.humans === 1;
  }

  /** Frozen: the race clock stands still until `paused` is cleared. */
  get paused(): boolean {
    return this.held;
  }

  set paused(on: boolean) {
    this.held = on;
    this.lastTime = performance.now();
  }

  reset() {
    const entries = gridCars(this.options);
    const players = entries.filter((c) => c.controller === 'human');
    const cars = orderGrid(entries, this.options.grid);
    const trackId = this.options.trackId ?? 'meadow';
    this.renderer.setTrack(trackId);
    this.curr = createRace({
      trackId,
      totalLaps: this.options.laps,
      cars,
      countdownSeconds: this.options.countdownSeconds,
      rules: this.options.rules,
      trackRecord: this.options.persistFastest === false ? null : (loadFastestLaps(trackId)[0] ?? null),
    });
    this.options.setup?.(this.curr);
    this.prev = this.curr;
    this.humanIds = players.map((p) => cars.findIndex((c) => c.name === p.name));
    this.inputLog = [];
    this.recorder.reset();
    this.acc = 0;
    this.held = false;
    this.renderer.resetRace();
  }

  private sampleInputs(): TickInputs {
    const [p1, p2] = this.humanIds;
    if (this.options.scriptedInput) return { [p1]: this.options.scriptedInput(this.curr) };
    const extra = this.extraInput?.sample() ?? NO_PLAYER_INPUT;
    if (this.options.humans === 1) return { [p1]: mergeInputs(this.keyboard.sample(BINDINGS_SOLO), extra) };
    return { [p1]: mergeInputs(this.keyboard.sample(BINDINGS_P1), extra), [p2]: this.keyboard.sample(BINDINGS_P2) };
  }

  start() {
    this.lastTime = performance.now();
    const frame = (now: number) => {
      this.acc += this.held ? 0 : Math.min(0.25, (now - this.lastTime) / 1000);
      this.lastTime = now;
      let steps = 0;
      const simStart = performance.now();
      while (!this.held && this.acc >= DT && steps < MAX_STEPS_PER_FRAME) {
        const inputs = this.sampleInputs();
        this.inputLog.push(inputs);
        this.prev = this.curr;
        this.curr = step(this.curr, inputs);
        this.recorder.record(this.curr, inputs, this.humanIds);
        if (this.options.persistFastest !== false && lapsDone(this.curr) !== lapsDone(this.prev)) {
          persistFastestLaps(this.curr.trackId, this.curr.fastestLaps);
        }
        this.renderer.onTick(this.curr);
        if (this.prev.phase !== 'finished' && this.curr.phase === 'finished') this.options.onFinish?.(this.curr);
        this.acc -= DT;
        steps++;
      }
      this.renderer.perf.addSim(performance.now() - simStart, steps);
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
