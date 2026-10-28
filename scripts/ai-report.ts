/**
 * How close the AI drives to what its car can do, per map and car kind.
 *
 *   npx tsx scripts/ai-report.ts                 every map × kind, alone, 3 laps, level 100
 *   npx tsx scripts/ai-report.ts --traffic       also 8 mixed cars × 15 laps with wear, fuel, damage
 *   npx tsx scripts/ai-report.ts --level 70      another AI level
 *   npx tsx scripts/ai-report.ts --maps meadow,harbor --kinds rally,f1
 *   npx tsx scripts/ai-report.ts --human laps.json   compare with laps saved from the game (pause → Download laps)
 *   npx tsx scripts/ai-report.ts --tune 0.98,0.95,1.2  try other full-level plan margins (grip, brake, steer)
 *
 * "Ideal" is the car's own speed plan driven perfectly: the corner and braking
 * limits from `speedProfile`, plus how fast the car can really accelerate.
 * Writes a markdown report to scripts/out/ai-report.md.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CAR_COLORS,
} from '../src/net/protocol';
import {
  CAR_KINDS,
  carSampleIndex,
  createRace,
  distanceToCenterline,
  getTrack,
  PLAN_TUNE,
  racingLine,
  speedProfile,
  step,
  surfaceAt,
  TICK_RATE,
  TRACK_IDS,
  type CarKind,
  type CarState,
  type GameState,
  type Track,
} from '../src/sim';
import { carStats, surfaceFor } from '../src/sim/physics';
import type { LapTelemetry } from '../src/client/lapRecorder';

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const level = Number(opt('level') ?? 100);
const maps = (opt('maps')?.split(',') ?? [...TRACK_IDS]) as string[];
const kinds = (opt('kinds')?.split(',') ?? [...CAR_KINDS]) as CarKind[];
const humanFile = opt('human');
const traffic = args.includes('--traffic');
const out = resolve(dirname(fileURLToPath(import.meta.url)), 'out');
const tune = opt('tune')?.split(',').map(Number);
if (tune) PLAN_TUNE.full = { grip: tune[0], brake: tune[1], steer: tune[2] };

/** Distance along the racing line between samples i and i+1. */
function lineSeg(track: Track, i: number): number {
  const p = racingLine(track).points;
  const a = p[i];
  const b = p[(i + 1) % p.length];
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * The plan's speed at every sample, also capped by how fast the car can pull
 * out of each corner (forward pass), and the ideal time to reach each sample.
 */
export function idealLap(track: Track, kind: CarKind): { speed: number[]; time: number[]; lap: number } {
  const plan = speedProfile(track, { kind }, level / 100);
  const C = carStats({ kind });
  const line = racingLine(track);
  const n = plan.length;
  const v = [...plan];
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      const s = surfaceFor(C, surfaceAt(track, line.points[i].x, line.points[i].y));
      const u = v[i];
      const accel = (C.engineAccel / C.mass) * s.engine - u * s.rolling - u * u * C.airDrag;
      const next = Math.sqrt(Math.max(0, u * u + 2 * Math.max(0, accel) * lineSeg(track, i)));
      const j = (i + 1) % n;
      if (next < v[j]) v[j] = next;
    }
  }
  const time = [0];
  for (let i = 0; i < n - 1; i++) time.push(time[i] + (2 * lineSeg(track, i)) / Math.max(1, v[i] + v[i + 1]));
  const lap = time[n - 1] + (2 * lineSeg(track, n - 1)) / Math.max(1, v[n - 1] + v[0]);
  return { speed: v, time, lap };
}

interface LapTrace {
  ticks: number;
  /** Tick each sample was first reached on this lap (relative to lap start). */
  at: number[];
  /** Lowest speed seen at each sample. */
  minSpeed: number[];
  offRoad: number;
  hits: number;
}

/** Runs one race and keeps a trace of every lap of every car. */
function runRace(trackId: string, cars: CarKind[], laps: number, rules: { damage: 0 | 1; tyreWear: 0 | 1; fuel: 0 | 1 }): LapTrace[][] {
  const track = getTrack(trackId);
  const n = track.samples.length;
  let s: GameState = createRace({
    trackId,
    totalLaps: laps,
    countdownSeconds: 0,
    cars: cars.map((kind, i) => ({ name: `${kind}${i}`, color: CAR_COLORS[i], controller: 'ai', kind })),
    rules: { ...rules, collisions: true, aiLevel: level },
  });
  s.phase = 'racing';
  const fresh = (): LapTrace => ({ ticks: 0, at: new Array(n).fill(-1), minSpeed: new Array(n).fill(Infinity), offRoad: 0, hits: 0 });
  const traces: LapTrace[][] = cars.map(() => []);
  const current = cars.map(() => fresh());
  const startTick = cars.map(() => 0);
  const lapsDone = cars.map(() => 0);
  const lastDamage = cars.map(() => 0);
  const limit = 60 * 60 * laps;
  for (let t = 0; t < limit && s.phase !== 'finished'; t++) {
    s = step(s, {});
    s.cars.forEach((c: CarState, k) => {
      const cur = current[k];
      if (c.lapsCompleted !== lapsDone[k]) {
        cur.ticks = c.lastLapTicks ?? 0;
        // The first lap starts from the grid, behind the line: skip it.
        if (lapsDone[k] > 0) traces[k].push(cur);
        current[k] = fresh();
        startTick[k] = s.tick;
        lapsDone[k] = c.lapsCompleted;
        return;
      }
      if (c.finishTick !== null) return;
      const i = carSampleIndex(track, c);
      const speed = Math.hypot(c.vx, c.vy);
      if (cur.at[i] < 0) cur.at[i] = s.tick - startTick[k];
      cur.minSpeed[i] = Math.min(cur.minSpeed[i], speed);
      if (distanceToCenterline(track, c.x, c.y) > track.def.halfWidth) cur.offRoad++;
      if ((c.damage ?? 0) > lastDamage[k] + 0.005) cur.hits++;
      lastDamage[k] = c.damage ?? 0;
    });
  }
  return traces;
}

/** Corners: samples where the plan bottoms out, at least 40 samples apart. */
function corners(plan: number[]): number[] {
  const n = plan.length;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let low = true;
    for (let d = -20; d <= 20 && low; d++) if (plan[(i + d + n) % n] < plan[i]) low = false;
    if (low && plan[i] < 520 && (!out.length || i - out[out.length - 1] > 40)) out.push(i);
  }
  return out;
}

interface Spot {
  map: string;
  kind: CarKind;
  sample: number;
  lost: number;
  note: string;
}

const fmt = (ticks: number) => (ticks / TICK_RATE).toFixed(2);
const lines: string[] = [`# AI report — level ${level}`, ''];
const spots: Spot[] = [];
const summary: string[] = ['| map | kind | best | ideal | lost | off-road | hits |', '|---|---|---|---|---|---|---|'];
const human: LapTelemetry[] = humanFile ? JSON.parse(readFileSync(humanFile, 'utf8')) : [];

for (const map of maps) {
  const track = getTrack(map);
  const n = track.samples.length;
  const sectors = 10;
  for (const kind of kinds) {
    const ideal = idealLap(track, kind);
    const [laps] = runRace(map, [kind], 3, { damage: 1, tyreWear: 0, fuel: 0 });
    if (!laps.length) {
      summary.push(`| ${map} | ${kind} | DNF | ${ideal.lap.toFixed(2)} | – | – | – |`);
      continue;
    }
    const best = laps.reduce((a, b) => (b.ticks < a.ticks ? b : a));
    const lost = (best.ticks / TICK_RATE / ideal.lap - 1) * 100;
    const off = laps.reduce((a, l) => a + l.offRoad, 0) / laps.length;
    const hits = laps.reduce((a, l) => a + l.hits, 0) / laps.length;
    summary.push(`| ${map} | ${kind} | ${fmt(best.ticks)} | ${ideal.lap.toFixed(2)} | ${lost.toFixed(1)}% | ${off.toFixed(0)} ticks | ${hits.toFixed(1)} |`);
    // Where the time goes: sectors of the lap vs the ideal.
    for (let k = 0; k < sectors; k++) {
      const a = Math.floor((k * n) / sectors);
      const b = Math.floor(((k + 1) * n) / sectors) % n;
      const ta = best.at[a];
      const tb = b === 0 ? best.ticks : best.at[b];
      if (ta < 0 || tb < 0) continue;
      const ideal0 = ideal.time[a];
      const ideal1 = b === 0 ? ideal.lap : ideal.time[b];
      const lostS = (tb - ta) / TICK_RATE - (ideal1 - ideal0);
      spots.push({ map, kind, sample: a, lost: lostS, note: `sector ${k + 1}/${sectors}` });
    }
    for (const c of corners(ideal.speed)) {
      let min = Infinity;
      for (let d = -12; d <= 12; d++) min = Math.min(min, best.minSpeed[(c + d + n) % n]);
      if (Number.isFinite(min) && min < ideal.speed[c] * 0.9) {
        spots.push({ map, kind, sample: c, lost: 0, note: `corner apex ${min.toFixed(0)} vs plan ${ideal.speed[c].toFixed(0)}` });
      }
    }
    const h = human.find((x) => x.trackId === map && x.kind === kind);
    if (h) {
      lines.push(`## ${map} ${kind}: human ${fmt(h.ticks)} vs AI ${fmt(best.ticks)}`, '');
      lines.push(...compareHuman(track, h, best, ideal), '');
    }
  }
}

/** Fill samples a car skipped with the time it reached the next one it hit. */
function filled(at: number[], lapTicks: number): number[] {
  const out = [...at];
  let next = lapTicks;
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i] < 0) out[i] = next;
    else next = out[i];
  }
  return out;
}

/** Per tenth of the lap: who is quicker, the human or the AI, and the slowest speed in it. */
function compareHuman(track: Track, h: LapTelemetry, ai: LapTrace, ideal: { time: number[] }): string[] {
  const n = track.samples.length;
  const at = new Array<number>(n).fill(-1);
  const speed = new Array<number>(n).fill(0);
  for (const p of h.points) {
    const i = carSampleIndex(track, { x: p.x, y: p.y });
    if (at[i] < 0) {
      at[i] = p.t;
      speed[i] = p.v;
    }
  }
  const hAt = filled(at, h.ticks);
  const aAt = filled(ai.at, ai.ticks);
  const rows = ['| part | samples | human | AI | ideal | human gains | human min speed | AI min speed |', '|---|---|---|---|---|---|---|---|'];
  for (let k = 0; k < 10; k++) {
    const a = Math.floor((k * n) / 10);
    const b = Math.floor(((k + 1) * n) / 10);
    const end = (arr: number[], lap: number) => (b >= n ? lap : arr[b]);
    const hs = (end(hAt, h.ticks) - hAt[a]) / TICK_RATE;
    const as = (end(aAt, ai.ticks) - aAt[a]) / TICK_RATE;
    const is = (b >= n ? ideal.time[n - 1] : ideal.time[b]) - ideal.time[a];
    let hMin = Infinity;
    let aMin = Infinity;
    for (let i = a; i < Math.min(b, n); i++) {
      if (speed[i] > 0) hMin = Math.min(hMin, speed[i]);
      aMin = Math.min(aMin, ai.minSpeed[i]);
    }
    rows.push(`| ${k + 1} | ${a}–${b} | ${hs.toFixed(2)} | ${as.toFixed(2)} | ${is.toFixed(2)} | ${(as - hs).toFixed(2)} | ${hMin.toFixed(0)} | ${aMin.toFixed(0)} |`);
  }
  return rows;
}

if (traffic) {
  lines.push('## Traffic: 8 mixed cars, 15 laps, wear + fuel + damage', '', '| map | best | ideal (rally) | median lap | hits/lap | off-road/lap |', '|---|---|---|---|---|---|');
  const mixed: CarKind[] = ['truck', 'buggy', 'rally', 'kart', 'rally', 'kart', 'f1', 'f1'];
  for (const map of maps) {
    const all = runRace(map, mixed, 15, { damage: 1, tyreWear: 1, fuel: 1 }).flat();
    const ticks = all.map((l) => l.ticks).sort((a, b) => a - b);
    const ideal = idealLap(getTrack(map), 'rally').lap;
    lines.push(
      `| ${map} | ${fmt(ticks[0])} | ${ideal.toFixed(2)} | ${fmt(ticks[Math.floor(ticks.length / 2)])} | ${(all.reduce((a, l) => a + l.hits, 0) / all.length).toFixed(2)} | ${(all.reduce((a, l) => a + l.offRoad, 0) / all.length).toFixed(0)} |`,
    );
  }
  lines.push('');
}

spots.sort((a, b) => b.lost - a.lost);
const worst = spots.filter((s) => s.lost > 0).slice(0, 10);
const apexes = spots.filter((s) => s.note.startsWith('corner')).slice(0, 15);
const report = [
  ...lines.slice(0, 2),
  '## Alone, 3 laps (best lap)',
  '',
  ...summary,
  '',
  '## Worst 10 sectors (seconds lost vs ideal)',
  '',
  ...worst.map((s) => `- ${s.map} ${s.kind} ${s.note} (from sample ${s.sample}): ${s.lost.toFixed(2)} s`),
  '',
  '## Corners taken well under plan',
  '',
  ...apexes.map((s) => `- ${s.map} ${s.kind} sample ${s.sample}: ${s.note}`),
  '',
  ...lines.slice(2),
].join('\n');
mkdirSync(out, { recursive: true });
writeFileSync(resolve(out, 'ai-report.md'), report);
console.log(summary.join('\n'));
const totals = summary.slice(2).map((r) => r.split('|').map((c) => c.trim()));
const sum = totals.reduce((a, c) => a + (Number(c[3]) || 0), 0);
const offs = totals.reduce((a, c) => a + (parseFloat(c[6]) || 0), 0);
const hitsAll = totals.reduce((a, c) => a + (Number(c[7]) || 0), 0);
console.log(`\nTOTAL best laps ${sum.toFixed(2)} s, off-road ${offs} ticks, hits ${hitsAll.toFixed(1)}, DNF ${totals.filter((c) => c[3] === 'DNF').length}`);
console.log(`\nWorst sectors:\n${worst.map((s) => `  ${s.map} ${s.kind} ${s.note}: ${s.lost.toFixed(2)} s`).join('\n')}`);
console.log(`\nFull report: ${resolve(out, 'ai-report.md')}`);
