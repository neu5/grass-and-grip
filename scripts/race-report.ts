/**
 * What every car did in races saved from the game (pause or race over → Download laps).
 *
 *   npx tsx scripts/race-report.ts grass-and-grip-laps.json        every saved race
 *   npx tsx scripts/race-report.ts grass-and-grip-laps.json 2      just the third one
 *
 * Plays each race back tick by tick and, per car: place, best lap, pit stops,
 * the most tyre wear it raced on, time on nearly bald tyres, and the longest
 * spells off the road (where, how fast, in which pit phase).
 */
import { readFileSync } from 'node:fs';
import {
  carSampleIndex,
  getTrack,
  inPitLane,
  onRacingSurface,
  pitBoxIndex,
  replayRace,
  standings,
  ticksToTime,
  traceRows,
  TRACE_EVERY,
  type GameState,
  type RaceLog,
} from '../src/sim';

const [file, only] = process.argv.slice(2);
if (!file) {
  console.error('usage: npx tsx scripts/race-report.ts <download.json> [race index]');
  process.exit(1);
}
const download = JSON.parse(readFileSync(file, 'utf8'));
const races: RaceLog[] = Array.isArray(download) ? [] : (download.races ?? []);
if (!races.length) {
  console.error('No races in this file: it only has best laps. Play a race, then Download laps again.');
  process.exit(1);
}

interface Spell {
  start: number;
  ticks: number;
  from: number;
  to: number;
  speed: number;
  wear: number;
  phase: string;
}

interface CarLog {
  stops: number;
  maxWear: number;
  worn: number;
  off: number;
  spells: Spell[];
  open: Spell | null;
  phase: string;
  /** A human sitting in a stall, so a stop counts once. */
  inBox: boolean;
}

const secs = (ticks: number) => (ticks / 60).toFixed(1);

function report(log: RaceLog, index: number) {
  const track = getTrack(log.config.trackId);
  const n = track.samples.length;
  const rules = log.config.rules;
  console.log(
    `\n## Race ${index}: ${log.config.trackId}, ${log.config.totalLaps} laps, ${log.savedAt}${log.finished ? '' : ' (not finished)'}`,
  );
  if (rules) console.log(`AI ${rules.aiLevel}%, tyre wear x${rules.tyreWear}, fuel x${rules.fuel}, damage x${rules.damage}`);

  const cars: CarLog[] = log.cars.map(() => ({ stops: 0, maxWear: 0, worn: 0, off: 0, spells: [], open: null, phase: 'race', inBox: false }));
  const trace = new Map<number, (number | string)[][]>();
  for (const row of log.trace) {
    const t = row[0] as number;
    trace.set(t, [...(trace.get(t) ?? []), row]);
  }
  let outOfStep: number | null = null;

  const end = replayRace(log, (s: GameState) => {
    if (outOfStep === null && s.tick % TRACE_EVERY === 0 && trace.has(s.tick)) {
      if (JSON.stringify(traceRows(s)) !== JSON.stringify(trace.get(s.tick))) outOfStep = s.tick;
    }
    if (s.phase !== 'racing') return;
    s.cars.forEach((c, i) => {
      const m = cars[i];
      if (c.finishTick !== null) return;
      const phase = c.ai?.pitPhase ?? 'race';
      if (phase === 'box' && m.phase !== 'box') m.stops++;
      if (c.controller === 'human') {
        const inBox = pitBoxIndex(track, c.x, c.y) >= 0 && Math.hypot(c.vx, c.vy) < 24;
        if (inBox && !m.inBox) m.stops++;
        if (inBox) m.inBox = true;
        else if (!inPitLane(track, c.x, c.y)) m.inBox = false;
      }
      m.phase = c.controller === 'human' ? (inPitLane(track, c.x, c.y) ? 'pits' : 'race') : phase;
      const racing = m.phase === 'race';
      if (racing) {
        m.maxWear = Math.max(m.maxWear, c.tyreWear);
        if (c.tyreWear > 0.9) m.worn++;
      }
      const off = !onRacingSurface(track, c.x, c.y);
      const idx = carSampleIndex(track, c);
      if (off) {
        m.off++;
        m.open ??= { start: s.tick, ticks: 0, from: idx, to: idx, speed: Math.hypot(c.vx, c.vy), wear: c.tyreWear, phase: m.phase };
        m.open.ticks++;
        m.open.to = idx;
      } else if (m.open) {
        m.spells.push(m.open);
        m.open = null;
      }
    });
  });

  if (outOfStep !== null) console.log(`Note: the replay drifts from the saved trace at ${ticksToTime(outOfStep)}; figures after that are a guess.`);
  const order = standings(end);
  console.log('\n| place | car | kind | best lap | stops | max wear racing | on >90% tyres | off road |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const c of order) {
    const m = cars[c.id];
    const who = c.controller === 'human' ? `**${c.name}**` : c.name;
    console.log(
      `| ${order.indexOf(c) + 1} | ${who} | ${c.kind} | ${c.bestLapTicks !== null ? ticksToTime(c.bestLapTicks) : '–'} | ${m.stops} | ${Math.round(m.maxWear * 100)}% | ${secs(m.worn)}s | ${secs(m.off)}s |`,
    );
  }
  const spells = cars
    .flatMap((m, id) => m.spells.map((sp) => ({ ...sp, name: log.cars[id].name })))
    .filter((sp) => sp.ticks >= 30)
    .sort((a, b) => b.ticks - a.ticks)
    .slice(0, 10);
  if (spells.length) {
    console.log('\nLongest spells off the road (road position as % of the lap):');
    for (const sp of spells) {
      console.log(
        `- ${sp.name} at ${ticksToTime(sp.start)}: ${secs(sp.ticks)}s from ${Math.round((sp.from / n) * 100)}% to ${Math.round((sp.to / n) * 100)}%, in at ${Math.round(sp.speed)}, tyres ${Math.round(sp.wear * 100)}%, ${sp.phase}`,
      );
    }
  }
}

const pick = only !== undefined ? [Number(only)] : races.map((_, i) => i);
for (const i of pick) {
  if (!races[i]) {
    console.error(`No race ${i}: the file has ${races.length}.`);
    process.exit(1);
  }
  report(races[i], i);
}
