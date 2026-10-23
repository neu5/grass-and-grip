import { standings, type CarKind, type GameState } from '../sim';

/** Points for 1st to 8th. */
export const POINTS = [10, 8, 6, 5, 4, 3, 2, 1] as const;

export const SEASON_KEY = 'gg-season';

export interface SeasonDriver {
  name: string;
  color: string;
  kind: CarKind;
}

export interface RoundResult {
  trackId: string;
  /** Driver names, winner first. */
  order: string[];
}

/** A run of races on several tracks with the same drivers and options. */
export interface Season<O = unknown> {
  tracks: string[];
  /** Index of the next race to run; equals tracks.length when the season is over. */
  round: number;
  drivers: SeasonDriver[];
  results: RoundResult[];
  /** Race options reused every round (plain data). */
  options: O;
}

export interface TableRow {
  name: string;
  color: string;
  kind: CarKind;
  points: number;
  wins: number;
  /** How many times the driver finished 1st, 2nd, ... (for tie-breaks). */
  finishes: number[];
}

export function newSeason<O>(tracks: string[], drivers: SeasonDriver[], options: O): Season<O> {
  return { tracks: [...tracks], round: 0, drivers: drivers.map((d) => ({ ...d })), results: [], options };
}

export function seasonOver(season: Season): boolean {
  return season.round >= season.tracks.length;
}

/** Finishing order of a race that just ended, by name. */
export function raceOrder(state: GameState): string[] {
  return standings(state).map((c) => c.name);
}

/** Record one race and move to the next round. Pure: returns a new season. */
export function scoreRound<O>(season: Season<O>, order: string[]): Season<O> {
  if (seasonOver(season)) return season;
  return {
    ...season,
    round: season.round + 1,
    results: [...season.results, { trackId: season.tracks[season.round], order: [...order] }],
  };
}

export function pointsFor(position: number): number {
  return POINTS[position] ?? 0;
}

/** Championship table: most points, then most wins, then best finishes (countback). */
export function seasonTable(season: Season): TableRow[] {
  const rows = new Map<string, TableRow>();
  for (const d of season.drivers) {
    rows.set(d.name, { ...d, points: 0, wins: 0, finishes: new Array(POINTS.length).fill(0) });
  }
  for (const r of season.results) {
    r.order.forEach((name, pos) => {
      const row = rows.get(name);
      if (!row) return;
      row.points += pointsFor(pos);
      if (pos === 0) row.wins++;
      if (pos < row.finishes.length) row.finishes[pos]++;
    });
  }
  return [...rows.values()].sort((a, b) => {
    if (a.points !== b.points) return b.points - a.points;
    for (let i = 0; i < a.finishes.length; i++) {
      if (a.finishes[i] !== b.finishes[i]) return b.finishes[i] - a.finishes[i];
    }
    return season.drivers.findIndex((d) => d.name === a.name) - season.drivers.findIndex((d) => d.name === b.name);
  });
}

/**
 * Starting order for the next round: a random grid for the first race, then
 * the championship order (leader on pole, last place at the back).
 */
export function seasonGrid(season: Season): 'random' | string[] {
  return season.results.length === 0 ? 'random' : seasonTable(season).map((r) => r.name);
}

type KeyStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function store(s?: KeyStore): KeyStore | null {
  if (s) return s;
  try {
    return localStorage;
  } catch {
    return null;
  }
}

export function saveSeason(season: Season, s?: KeyStore): void {
  try {
    store(s)?.setItem(SEASON_KEY, JSON.stringify(season));
  } catch {
    // Storage full or blocked: the season still runs, it just won't resume.
  }
}

export function loadSeason<O>(s?: KeyStore): Season<O> | null {
  try {
    const raw = store(s)?.getItem(SEASON_KEY);
    if (!raw) return null;
    const season = JSON.parse(raw) as Season<O>;
    if (!Array.isArray(season.tracks) || !Array.isArray(season.drivers) || !Array.isArray(season.results)) return null;
    return season;
  } catch {
    return null;
  }
}

export function clearSeason(s?: KeyStore): void {
  try {
    store(s)?.removeItem(SEASON_KEY);
  } catch {
    // Nothing to clear.
  }
}
