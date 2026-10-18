import type { GameState, PlayerInput } from '../sim';

export const MAX_PLAYERS = 4;
export const CAR_COLORS = ['#e8443a', '#3a8ee8', '#f2c230', '#3fbf5f'] as const;
export const COLOR_NAMES: Record<string, string> = {
  '#e8443a': 'Red',
  '#3a8ee8': 'Blue',
  '#f2c230': 'Yellow',
  '#3fbf5f': 'Green',
};
export const LAP_OPTIONS = [1, 3, 5] as const;

export type RoomPhase = 'lobby' | 'racing' | 'results';

export interface LobbyPlayer {
  id: string;
  name: string;
  color: string;
  ready: boolean;
  host: boolean;
}

export interface LobbyState {
  roomId: string;
  phase: RoomPhase;
  players: LobbyPlayer[];
  aiCount: number;
  laps: number;
  /** car id per player id in the current race */
  cars: Record<string, number>;
}

export type ClientMessage =
  | { t: 'join'; name: string; color: string }
  | { t: 'ready'; ready: boolean }
  | { t: 'settings'; aiCount?: number; laps?: number }
  | { t: 'input'; input: PlayerInput };

export type ServerMessage =
  | { t: 'welcome'; id: string }
  | { t: 'lobby'; lobby: LobbyState }
  | { t: 'error'; message: string }
  | { t: 'state'; state: GameState };
