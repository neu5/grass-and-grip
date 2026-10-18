import { createRace, step, TICK_RATE, type CarConfig, type GameState, type PlayerInput, type TickInputs } from '../sim';
import { CAR_COLORS, LAP_OPTIONS, MAX_PLAYERS, type LobbyState, type RoomPhase } from './protocol';

export const COUNTDOWN_SECONDS = 5;
export const RESULTS_TICKS = 6 * TICK_RATE;
export const MAX_RACE_TICKS = 15 * 60 * TICK_RATE;
const TRACK_ID = 'meadow';
const AI_NAMES = ['Rosa', 'Viktor', 'Kenji'];
const MAX_NAME_LENGTH = 16;

export interface RoomPlayer {
  id: string;
  name: string;
  color: string;
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
  aiCount = 3;
  laps = 3;
  phase: RoomPhase = 'lobby';
  race: GameState | null = null;
  /** Player id -> car id for the current race. */
  readonly carOf = new Map<string, number>();
  /** Bumped whenever the lobby view changes, so the server knows when to broadcast it. */
  version = 0;
  private inputs: TickInputs = {};
  private resultsLeft = 0;

  constructor(readonly id: string) {}

  get hostId(): string | null {
    return this.players[0]?.id ?? null;
  }

  takenColors(): string[] {
    return this.players.map((p) => p.color);
  }

  /** Returns an error message, or null on success. */
  join(id: string, rawName: string, color: string): string | null {
    if (this.players.some((p) => p.id === id)) return 'Already joined';
    if (this.players.length >= MAX_PLAYERS) return 'Room is full';
    if (!(CAR_COLORS as readonly string[]).includes(color)) return 'Unknown color';
    if (this.takenColors().includes(color)) return 'Color already taken';
    const name = String(rawName ?? '').trim().slice(0, MAX_NAME_LENGTH) || `Player ${this.players.length + 1}`;
    this.players.push({ id, name, color, ready: false });
    this.aiCount = Math.min(this.aiCount, MAX_PLAYERS - this.players.length);
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

  setSettings(id: string, s: { aiCount?: number; laps?: number }): string | null {
    if (id !== this.hostId) return 'Only the host can change settings';
    if (this.phase !== 'lobby') return 'Race in progress';
    if (s.aiCount !== undefined) {
      const n = Math.floor(Number(s.aiCount));
      if (!Number.isFinite(n) || n < 0 || n > MAX_PLAYERS - this.players.length) return 'Too many cars';
      this.aiCount = n;
    }
    if (s.laps !== undefined) {
      if (!(LAP_OPTIONS as readonly number[]).includes(Number(s.laps))) return 'Invalid lap count';
      this.laps = Number(s.laps);
    }
    this.changed();
    return null;
  }

  setInput(id: string, input: PlayerInput): void {
    const carId = this.carOf.get(id);
    if (carId === undefined || !input) return;
    this.inputs[carId] = { throttle: clamp1(input.throttle), steer: clamp1(input.steer), handbrake: !!input.handbrake };
  }

  /** Advance one sim tick. Returns true when there is a race state to broadcast. */
  tick(): boolean {
    if (!this.race) return false;
    this.race = step(this.race, this.inputs);
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
      cars: Object.fromEntries(this.carOf),
    };
  }

  private maybeStart(): void {
    if (this.phase !== 'lobby' || this.players.length === 0) return;
    if (this.players.every((p) => p.ready)) this.startRace();
  }

  private startRace(): void {
    const taken = this.takenColors();
    const freeColors = CAR_COLORS.filter((c) => !taken.includes(c));
    const cars: CarConfig[] = [
      ...this.players.map((p): CarConfig => ({ name: p.name, color: p.color, controller: 'human' })),
      ...freeColors.slice(0, this.aiCount).map((color, i): CarConfig => ({ name: AI_NAMES[i], color, controller: 'ai' })),
    ];
    this.carOf.clear();
    this.players.forEach((p, i) => this.carOf.set(p.id, i));
    this.inputs = {};
    this.race = createRace({ trackId: TRACK_ID, totalLaps: this.laps, cars, countdownSeconds: COUNTDOWN_SECONDS });
    this.phase = 'racing';
    this.changed();
  }

  private backToLobby(): void {
    this.phase = 'lobby';
    this.race = null;
    this.carOf.clear();
    this.inputs = {};
    for (const p of this.players) p.ready = false;
    this.changed();
  }

  private changed(): void {
    this.version++;
  }
}
