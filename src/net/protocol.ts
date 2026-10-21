import type { CarKind, Phase, PlayerInput } from '../sim';

export type { CarKind };
export { CAR_KINDS, CAR_KIND_NAMES, TRACK_IDS, TRACK_NAMES, isTrackId } from '../sim';
export type { TrackId } from '../sim';

export const MAX_PLAYERS = 4;
export const CAR_COLORS = ['#e8443a', '#3a8ee8', '#f2c230', '#3fbf5f'] as const;
export const COLOR_NAMES: Record<string, string> = {
  '#e8443a': 'Red',
  '#3a8ee8': 'Blue',
  '#f2c230': 'Yellow',
  '#3fbf5f': 'Green',
};
export const LAP_OPTIONS = [1, 3, 5] as const;

/** Authoritative race snapshots per second (20–30 Hz). */
export const SNAPSHOT_HZ = 20;

export type RoomPhase = 'lobby' | 'racing' | 'results';

export interface LobbyPlayer {
  id: string;
  name: string;
  color: string;
  car: CarKind;
  ready: boolean;
  host: boolean;
}

export interface LobbyState {
  roomId: string;
  phase: RoomPhase;
  players: LobbyPlayer[];
  aiCount: number;
  laps: number;
  trackId: string;
  /** car id per player id in the current race */
  cars: Record<string, number>;
}

export type ClientMessage =
  | { t: 'join'; name: string; color: string; car?: CarKind }
  | { t: 'ready'; ready: boolean }
  | { t: 'settings'; aiCount?: number; laps?: number; trackId?: string }
  | { t: 'input'; seq: number; tick: number; input: PlayerInput }
  | { t: 'ping'; t0: number };

export type ServerMessage =
  | { t: 'welcome'; id: string }
  | { t: 'lobby'; lobby: LobbyState }
  | { t: 'error'; message: string }
  | { t: 'snap'; snap: CompactSnapshot }
  | { t: 'pong'; t0: number };

/** Quantized, short-key car pose. Identity fields are needed to spawn meshes. */
export interface CompactCar {
  i: number;
  n: string;
  col: string;
  knd: CarKind;
  ctl: 'human' | 'ai';
  x: number;
  y: number;
  vx: number;
  vy: number;
  a: number;
  sl: number;
  /** Tyre wear 0–1000 (0 = fresh, 1000 = fully worn). */
  tw: number;
  /** Remaining fuel 0–1000 (1000 = 100%, 0 = empty). */
  fu: number;
  /** Crash damage 0–1000 (0 = fine, 1000 = wrecked). */
  dm: number;
  g: 0 | 1;
  h: 0 | 1;
  lc: number;
  nc: number;
  lst: number;
  llt: number | null;
  blt: number | null;
  ft: number | null;
}

export interface CompactSnapshot {
  k: number;
  p: Phase;
  st: number;
  tl: number;
  tid: string;
  c: CompactCar[];
  /** Last input seq the server applied for the receiving client. */
  ack: number;
}
