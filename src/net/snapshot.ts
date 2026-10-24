import { copyFastestLaps, DEFAULT_RULES, type Prop, normalizeRules, normalizeSetup, toCarKind, type CarState, type FastestLap, type GameState } from '../sim';
import type { CompactCar, CompactFastestLap, CompactSnapshot } from './protocol';

/** Position / velocity stored in tenths. Angle in milliradians. Wear/fuel/damage 0–1 as 0–1000. */
export const POS_Q = 10;
export const ANG_Q = 1000;
export const WEAR_Q = 1000;
export const FUEL_Q = 1000;
export const DAMAGE_Q = 1000;

const q = (v: number, scale: number) => Math.round(v * scale);
const u = (v: number, scale: number) => v / scale;

function encodeCar(car: CarState): CompactCar {
  return {
    i: car.id,
    n: car.name,
    col: car.color,
    knd: car.kind,
    ...(car.setup && (car.setup.gearing || car.setup.steering || car.setup.grip)
      ? { su: [car.setup.gearing, car.setup.steering, car.setup.grip] as [number, number, number] }
      : {}),
    ctl: car.controller,
    x: q(car.x, POS_Q),
    y: q(car.y, POS_Q),
    vx: q(car.vx, POS_Q),
    vy: q(car.vy, POS_Q),
    a: q(car.angle, ANG_Q),
    sl: q(car.slip, POS_Q),
    tw: q(car.tyreWear ?? 0, WEAR_Q),
    fu: q(car.fuel ?? 1, FUEL_Q),
    dm: q(car.damage ?? 0, DAMAGE_Q),
    g: car.onGrass ? 1 : 0,
    h: car.handbrake ? 1 : 0,
    lc: car.lapsCompleted,
    nc: car.nextCheckpoint,
    lst: car.lapStartTick,
    llt: car.lastLapTicks,
    blt: car.bestLapTicks,
    ft: car.finishTick,
  };
}

function decodeCar(c: CompactCar, prev?: CarState): CarState {
  return {
    id: c.i,
    name: c.n,
    color: c.col,
    kind: toCarKind(c.knd),
    setup: normalizeSetup(c.su ? { gearing: c.su[0], steering: c.su[1], grip: c.su[2] } : undefined),
    controller: c.ctl,
    x: u(c.x, POS_Q),
    y: u(c.y, POS_Q),
    vx: u(c.vx, POS_Q),
    vy: u(c.vy, POS_Q),
    angle: u(c.a, ANG_Q),
    slip: u(c.sl, POS_Q),
    tyreWear: u(c.tw ?? 0, WEAR_Q),
    fuel: u(c.fu ?? FUEL_Q, FUEL_Q),
    damage: u(c.dm ?? 0, DAMAGE_Q),
    onGrass: !!c.g,
    handbrake: !!c.h,
    lapsCompleted: c.lc,
    nextCheckpoint: c.nc,
    lapStartTick: c.lst,
    lastLapTicks: c.llt,
    bestLapTicks: c.blt,
    finishTick: c.ft,
    ai: prev?.ai ?? null,
  };
}

function encodeFastest(entry: FastestLap): CompactFastestLap {
  return { n: entry.name, t: entry.ticks, tid: entry.trackId, c: entry.car, col: entry.color };
}

function decodeFastest(entry: CompactFastestLap): FastestLap {
  return {
    name: entry.n,
    ticks: entry.t,
    trackId: entry.tid,
    car: toCarKind(entry.c),
    color: entry.col,
  };
}

const PROP_ANG_Q = 100;

function encodeProps(props: Prop[]): number[] {
  const out: number[] = [];
  for (const p of props) out.push(q(p.x, POS_Q), q(p.y, POS_Q), q(p.angle, PROP_ANG_Q), p.down ? 1 : 0);
  return out;
}

/** Cones arrive without velocity; only the server moves them. */
function decodeProps(flat: number[]): Prop[] {
  const out: Prop[] = [];
  for (let i = 0; i + 3 < flat.length; i += 4) {
    out.push({ x: u(flat[i], POS_Q), y: u(flat[i + 1], POS_Q), vx: 0, vy: 0, angle: u(flat[i + 2], PROP_ANG_Q), spin: 0, down: flat[i + 3] === 1 });
  }
  return out;
}

function encodeRules(state: GameState): [number, number, number, number, number] {
  const r = state.rules ?? DEFAULT_RULES;
  return [r.damage, r.tyreWear, r.fuel, r.collisions ? 1 : 0, r.aiLevel];
}

export function encodeSnapshot(state: GameState, ack = 0): CompactSnapshot {
  return {
    k: state.tick,
    p: state.phase,
    st: state.startTick,
    tl: state.totalLaps,
    tid: state.trackId,
    ru: encodeRules(state),
    c: state.cars.map(encodeCar),
    ...(state.props?.length ? { pr: encodeProps(state.props) } : {}),
    fl: (state.fastestLaps ?? []).map(encodeFastest),
    ack,
  };
}

export function decodeSnapshot(snap: CompactSnapshot, prev?: GameState): GameState {
  return {
    tick: snap.k,
    trackId: snap.tid ?? prev?.trackId ?? 'meadow',
    phase: snap.p,
    startTick: snap.st,
    totalLaps: snap.tl,
    rules: snap.ru
      ? normalizeRules({ damage: snap.ru[0], tyreWear: snap.ru[1], fuel: snap.ru[2], collisions: snap.ru[3] === 1, aiLevel: snap.ru[4] })
      : (prev?.rules ?? { ...DEFAULT_RULES }),
    props: snap.pr ? decodeProps(snap.pr) : (prev?.props ?? []),
    cars: snap.c.map((c) => decodeCar(c, prev?.cars.find((x) => x.id === c.i))),
    fastestLaps: copyFastestLaps(snap.fl?.map(decodeFastest) ?? prev?.fastestLaps),
    trackRecord: prev?.trackRecord ?? null,
  };
}
