import type { CarKind, CarMode, FastestLap, Phase, PlayerInput } from '../sim';

export type { CarKind };
export {
  CAR_KINDS,
  CAR_KIND_NAMES,
  CAR_MODES,
  CAR_MODE_NAMES,
  DEFAULT_CAR_MODE,
  TRACK_IDS,
  TRACK_NAMES,
  isTrackId,
  parseCarMode,
} from '../sim';
export type { CarMode, TrackId } from '../sim';

/** Humans + AI in one race. Humans 1–8; AI fills the rest. */
export const MAX_PLAYERS = 8;
export const CAR_COLORS = [
  '#e8443a',
  '#3a8ee8',
  '#f2c230',
  '#3fbf5f',
  '#9b59d0',
  '#f0f0f0',
  '#e67e22',
  '#1abc9c',
] as const;
export const COLOR_NAMES: Record<string, string> = {
  '#e8443a': 'Red',
  '#3a8ee8': 'Blue',
  '#f2c230': 'Yellow',
  '#3fbf5f': 'Green',
  '#9b59d0': 'Purple',
  '#f0f0f0': 'White',
  '#e67e22': 'Orange',
  '#1abc9c': 'Teal',
};
export const AI_NAMES = ['Rosa', 'Viktor', 'Kenji', 'Mina', 'Luca', 'Asha', 'Omar'] as const;

/** AI slots left after `humanCount` humans, clamped to the 8-car field. */
export function clampAiCount(humanCount: number, aiCount: number): number {
  const humans = Math.max(0, Math.min(MAX_PLAYERS, Math.floor(Number(humanCount)) || 0));
  const n = Math.floor(Number(aiCount));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, MAX_PLAYERS - humans);
}
export const MIN_LAPS = 1;
export const MAX_LAPS = 99;
export const DEFAULT_LAPS = 3;

/** Integer laps in 1–99, or null if the value is missing/out of range. */
export function parseLaps(v: unknown): number | null {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < MIN_LAPS || n > MAX_LAPS) return null;
  return n;
}

/** Snap a UI value into 1–99; blank/non-numeric becomes the default (3). */
export function clampLaps(v: unknown): number {
  if (v === '' || v === null || v === undefined) return DEFAULT_LAPS;
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return DEFAULT_LAPS;
  return Math.max(MIN_LAPS, Math.min(MAX_LAPS, n));
}

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
  /** Host-set. Default mixed (pick your car). F1 forces every spawned car. */
  carMode: CarMode;
  /** car id per player id in the current race */
  cars: Record<string, number>;
  /** Room top 3 for the current track (server memory). */
  fastestLaps: FastestLap[];
}

export type ClientMessage =
  | { t: 'join'; name: string; color: string; car?: CarKind }
  | { t: 'ready'; ready: boolean }
  | { t: 'settings'; aiCount?: number; laps?: number; trackId?: string; carMode?: CarMode }
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

export interface CompactFastestLap {
  n: string;
  t: number;
  tid: string;
  c: CarKind;
  col: string;
}

export interface CompactSnapshot {
  k: number;
  p: Phase;
  st: number;
  tl: number;
  tid: string;
  c: CompactCar[];
  /** Fastest-first top 3 for this track. */
  fl?: CompactFastestLap[];
  /** Last input seq the server applied for the receiving client. */
  ack: number;
}
