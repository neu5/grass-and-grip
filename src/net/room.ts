import {
  copyFastestLaps,
  createRace,
  orderGrid,
  DEFAULT_CAR_MODE,
  DEFAULT_RULES,
  isTrackId,
  lapsDone,
  normalizeRules,
  parseTrackDef,
  registerTrack,
  validateTrack,
  normalizeSetup,
  parseCarKind,
  parseCarMode,
  spawnAiKind,
  spawnKind,
  step,
  TICK_RATE,
  type CarConfig,
  type CarKind,
  type CarMode,
  type CarSetup,
  type FastestLap,
  type GameState,
  type PlayerInput,
  type RaceRules,
  type TickInputs,
  type TrackDef,
} from '../sim';
import { AI_NAMES, CAR_COLORS, DEFAULT_LAPS, MAX_PLAYERS, clampAiCount, parseLaps, type LobbyState, type RoomPhase } from './protocol';

export const COUNTDOWN_SECONDS = 5;
/** A custom track's JSON may not be bigger than this. */
export const MAX_CUSTOM_TRACK_BYTES = 60_000;
export const RESULTS_TICKS = 6 * TICK_RATE;
export const MAX_RACE_TICKS = 15 * 60 * TICK_RATE;
const MAX_NAME_LENGTH = 16;
/** Inputs waiting their turn per player: enough to ride out network jitter, few enough not to add lag. */
export const MAX_QUEUED_INPUTS = 8;

export interface RoomPlayer {
  id: string;
  name: string;
  color: string;
  car: CarKind;
  setup: CarSetup;
  ready: boolean;
}

const clamp1 = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(-1, Math.min(1, n)) : 0;
};

/**
 * Lobby + race state machine for one room. Transport-free: the server feeds it
 * player actions and calls `tick()` at the sim rate.
 */
export class Room {
  readonly players: RoomPlayer[] = [];
  aiCount = MAX_PLAYERS;
  laps = DEFAULT_LAPS;
  trackId = 'meadow';
  carMode: CarMode = DEFAULT_CAR_MODE;
  rules: RaceRules = { ...DEFAULT_RULES };
  /** Set while the room races on a track from the host's editor. */
  customTrack: TrackDef | null = null;
  phase: RoomPhase = 'lobby';
  race: GameState | null = null;
  /** Per-track top 3 for this room process. */
  /** All-time top 3 per track for this room; each race's own board starts empty. */
  readonly fastestByTrack: Record<string, FastestLap[]> = {};
  private lapsMerged = 0;
  /** Player id -> car id for the current race. */
  readonly carOf = new Map<string, number>();
  /** Bumped whenever the lobby view changes, so the server knows when to broadcast it. */
  version = 0;
  private inputs: TickInputs = {};
  /** Newest seq received per player, to drop repeats and stragglers. */
  private lastSeq = new Map<string, number>();
  /** Inputs received but not yet played, oldest first: one per tick, in order, as the client drove them. */
  private queued = new Map<string, { seq: number; input: PlayerInput }[]>();
  /** Seq of the input each player's car last ran on: the snapshot's ack. */
  private applied = new Map<string, number>();
  private resultsLeft = 0;

  /** `random` picks the starting grid; tests pass a seeded one. */
  constructor(
    readonly id: string,
    private readonly random: () => number = Math.random,
  ) {}

  get hostId(): string | null {
    return this.players[0]?.id ?? null;
  }

  takenColors(): string[] {
    return this.players.map((p) => p.color);
  }

  /** Returns an error message, or null on success. */
  join(id: string, rawName: string, color: string, car?: string, setup?: unknown): string | null {
    if (this.players.some((p) => p.id === id)) return 'Already joined';
    if (this.players.length >= MAX_PLAYERS) return 'Room is full';
    if (!(CAR_COLORS as readonly string[]).includes(color)) return 'Unknown color';
    if (this.takenColors().includes(color)) return 'Color already taken';
    const kind = car === undefined || car === '' ? 'rally' : parseCarKind(car);
    if (!kind) return 'Unknown car';
    const name = String(rawName ?? '').trim().slice(0, MAX_NAME_LENGTH) || `Player ${this.players.length + 1}`;
    this.players.push({ id, name, color, car: kind, setup: normalizeSetup(setup), ready: false });
    this.aiCount = clampAiCount(this.players.length, this.aiCount);
    this.changed();
    return null;
  }

  leave(id: string): void {
    const i = this.players.findIndex((p) => p.id === id);
    if (i < 0) return;
    this.players.splice(i, 1);
    if (this.phase !== 'lobby') {
      const carId = this.carOf.get(id);
      this.carOf.delete(id);
      this.lastSeq.delete(id);
      this.queued.delete(id);
      this.applied.delete(id);
      if (carId !== undefined) delete this.inputs[carId];
      if (this.carOf.size === 0) this.backToLobby();
    }
    this.changed();
    this.maybeStart();
  }

  setReady(id: string, ready: boolean): string | null {
    const p = this.players.find((q) => q.id === id);
    if (!p) return 'Join the room first';
    if (this.phase !== 'lobby') return 'Race in progress';
    p.ready = !!ready;
    this.changed();
    this.maybeStart();
    return null;
  }

  /** A player's own garage setup, changeable in the lobby. */
  setSetup(id: string, setup: unknown): string | null {
    const p = this.players.find((q) => q.id === id);
    if (!p) return 'Join the room first';
    if (this.phase !== 'lobby') return 'Race in progress';
    p.setup = normalizeSetup(setup);
    this.changed();
    return null;
  }

  setSettings(
    id: string,
    s: { aiCount?: number; laps?: number; trackId?: string; carMode?: string; rules?: Partial<RaceRules>; customTrack?: unknown },
  ): string | null {
    if (id !== this.hostId) return 'Only the host can change settings';
    if (this.phase !== 'lobby') return 'Race in progress';
    if (s.aiCount !== undefined) {
      const n = Math.floor(Number(s.aiCount));
      if (!Number.isFinite(n) || n < 0 || n !== clampAiCount(this.players.length, n)) return 'Too many cars';
      this.aiCount = n;
    }
    if (s.laps !== undefined) {
      const n = parseLaps(s.laps);
      if (n === null) return 'Invalid lap count';
      this.laps = n;
    }
    if (s.customTrack !== undefined) {
      const def = parseTrackDef(s.customTrack);
      if (!def || JSON.stringify(def).length > MAX_CUSTOM_TRACK_BYTES) return 'That track cannot be used';
      if (validateTrack(def).length) return 'That track has problems; fix them in the editor';
      registerTrack(def);
      this.customTrack = def;
      this.trackId = def.id;
    } else if (s.trackId !== undefined) {
      if (!isTrackId(s.trackId)) return 'Unknown track';
      this.trackId = s.trackId;
      this.customTrack = null;
    }
    if (s.carMode !== undefined) {
      const mode = parseCarMode(s.carMode);
      if (!mode) return 'Unknown car mode';
      this.carMode = mode;
    }
    if (s.rules !== undefined) {
      if (!s.rules || typeof s.rules !== 'object') return 'Invalid options';
      this.rules = normalizeRules({ ...this.rules, ...s.rules });
    }
    this.changed();
    return null;
  }

  setInput(id: string, input: PlayerInput, seq?: number): void {
    const carId = this.carOf.get(id);
    if (carId === undefined || !input) return;
    const clean = { throttle: clamp1(input.throttle), steer: clamp1(input.steer), handbrake: !!input.handbrake };
    if (seq === undefined) {
      this.inputs[carId] = clean;
      return;
    }
    const prev = this.lastSeq.get(id) ?? 0;
    if (seq <= prev) return;
    this.lastSeq.set(id, seq);
    // The client stepped its car once per input. Playing them one per tick, in
    // order, keeps the server's car on the same path even when packets come in
    // bunches; taking just the newest would skip some and repeat others.
    const q = this.queued.get(id) ?? [];
    q.push({ seq, input: clean });
    while (q.length > MAX_QUEUED_INPUTS) q.shift();
    this.queued.set(id, q);
  }

  /** Seq of the last input the server ran, for snapshot acks. */
  ackOf(id: string): number {
    return this.applied.get(id) ?? 0;
  }

  /** Each player's next queued input for this tick; with none waiting the car keeps its last one. */
  private takeInputs(): void {
    for (const [id, q] of this.queued) {
      const next = q.shift();
      const carId = this.carOf.get(id);
      if (!next || carId === undefined) continue;
      this.inputs[carId] = next.input;
      this.applied.set(id, next.seq);
    }
  }

  /** Advance one sim tick. Returns true when there is a race state to broadcast. */
  tick(): boolean {
    if (!this.race) return false;
    this.takeInputs();
    this.race = step(this.race, this.inputs);
    if (lapsDone(this.race) !== this.lapsMerged) {
      this.lapsMerged = lapsDone(this.race);
      const id = this.race.trackId;
      this.fastestByTrack[id] = copyFastestLaps([...(this.fastestByTrack[id] ?? []), ...this.race.fastestLaps]);
    }
    if (this.phase === 'racing' && (this.race.phase === 'finished' || this.race.tick >= MAX_RACE_TICKS)) {
      this.phase = 'results';
      this.resultsLeft = RESULTS_TICKS;
      this.changed();
    } else if (this.phase === 'results' && --this.resultsLeft <= 0) {
      this.backToLobby();
    }
    return this.race !== null;
  }

  view(): LobbyState {
    return {
      roomId: this.id,
      phase: this.phase,
      players: this.players.map((p) => ({ ...p, host: p.id === this.hostId })),
      aiCount: this.aiCount,
      laps: this.laps,
      trackId: this.trackId,
      carMode: this.carMode,
      rules: { ...this.rules },
      ...(this.customTrack ? { customTrack: this.customTrack } : {}),
      cars: Object.fromEntries(this.carOf),
      fastestLaps: this.fastestByTrack[this.trackId] ?? [],
    };
  }

  private maybeStart(): void {
    if (this.phase !== 'lobby' || this.players.length === 0) return;
    if (this.players.every((p) => p.ready)) this.startRace();
  }

  private startRace(): void {
    const taken = this.takenColors();
    const freeColors = CAR_COLORS.filter((c) => !taken.includes(c));
    const humanKinds = this.players.map((p) => spawnKind(p.car, this.carMode));
    const entries: CarConfig[] = [
      ...this.players.map(
        (p): CarConfig => ({
          name: p.name,
          color: p.color,
          controller: 'human',
          kind: spawnKind(p.car, this.carMode),
          setup: p.setup,
        }),
      ),
      ...freeColors.slice(0, this.aiCount).map(
        (color, i): CarConfig => ({ name: AI_NAMES[i] ?? `AI ${i + 1}`, color, controller: 'ai', kind: spawnAiKind(i, humanKinds, this.carMode) }),
      ),
    ];
    // Every race starts from a fresh random grid. Players are the first entries.
    const cars = orderGrid(entries, 'random', this.random);
    this.carOf.clear();
    this.lastSeq.clear();
    this.queued.clear();
    this.applied.clear();
    this.players.forEach((p, i) => this.carOf.set(p.id, cars.indexOf(entries[i])));
    this.inputs = {};
    this.lapsMerged = 0;
    this.race = createRace({
      trackId: this.trackId,
      totalLaps: this.laps,
      cars,
      countdownSeconds: COUNTDOWN_SECONDS,
      rules: this.rules,
    });
    this.phase = 'racing';
    this.changed();
  }

  private backToLobby(): void {
    this.phase = 'lobby';
    this.race = null;
    this.carOf.clear();
    this.lastSeq.clear();
    this.queued.clear();
    this.applied.clear();
    this.inputs = {};
    for (const p of this.players) p.ready = false;
    this.changed();
  }

  private changed(): void {
    this.version++;
  }
}

