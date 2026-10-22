import {
  createRace,
  DEFAULT_CAR_MODE,
  DEFAULT_RULES,
  isTrackId,
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
  readonly fastestByTrack: Record<string, FastestLap[]> = {};
  /** Player id -> car id for the current race. */
  readonly carOf = new Map<string, number>();
  /** Bumped whenever the lobby view changes, so the server knows when to broadcast it. */
  version = 0;
  private inputs: TickInputs = {};
  private lastSeq = new Map<string, number>();
  private resultsLeft = 0;

  constructor(readonly id: string) {}

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
    if (seq !== undefined) {
      const prev = this.lastSeq.get(id) ?? 0;
      if (seq <= prev) return;
      this.lastSeq.set(id, seq);
    }
    this.inputs[carId] = { throttle: clamp1(input.throttle), steer: clamp1(input.steer), handbrake: !!input.handbrake };
  }

  /** Last input seq applied for this player, for snapshot acks. */
  ackOf(id: string): number {
    return this.lastSeq.get(id) ?? 0;
  }

  /** Advance one sim tick. Returns true when there is a race state to broadcast. */
  tick(): boolean {
    if (!this.race) return false;
    this.race = step(this.race, this.inputs);
    this.fastestByTrack[this.race.trackId] = this.race.fastestLaps;
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
    const cars: CarConfig[] = [
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
    this.carOf.clear();
    this.lastSeq.clear();
    this.players.forEach((p, i) => this.carOf.set(p.id, i));
    this.inputs = {};
    this.race = createRace({
      trackId: this.trackId,
      totalLaps: this.laps,
      cars,
      countdownSeconds: COUNTDOWN_SECONDS,
      rules: this.rules,
      fastestLaps: this.fastestByTrack[this.trackId],
    });
    this.phase = 'racing';
    this.changed();
  }

  private backToLobby(): void {
    this.phase = 'lobby';
    this.race = null;
    this.carOf.clear();
    this.lastSeq.clear();
    this.inputs = {};
    for (const p of this.players) p.ready = false;
    this.changed();
  }

  private changed(): void {
    this.version++;
  }
}

