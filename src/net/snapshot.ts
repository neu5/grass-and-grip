import type { CarState, GameState } from '../sim';
import type { CompactCar, CompactSnapshot } from './protocol';

/** Position / velocity stored in tenths. Angle in milliradians. */
export const POS_Q = 10;
export const ANG_Q = 1000;

const q = (v: number, scale: number) => Math.round(v * scale);
const u = (v: number, scale: number) => v / scale;

function encodeCar(car: CarState): CompactCar {
  return {
    i: car.id,
    n: car.name,
    col: car.color,
    ctl: car.controller,
    x: q(car.x, POS_Q),
    y: q(car.y, POS_Q),
    vx: q(car.vx, POS_Q),
    vy: q(car.vy, POS_Q),
    a: q(car.angle, ANG_Q),
    sl: q(car.slip, POS_Q),
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
    controller: c.ctl,
    x: u(c.x, POS_Q),
    y: u(c.y, POS_Q),
    vx: u(c.vx, POS_Q),
    vy: u(c.vy, POS_Q),
    angle: u(c.a, ANG_Q),
    slip: u(c.sl, POS_Q),
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

export function encodeSnapshot(state: GameState, ack = 0): CompactSnapshot {
  return {
    k: state.tick,
    p: state.phase,
    st: state.startTick,
    tl: state.totalLaps,
    c: state.cars.map(encodeCar),
    ack,
  };
}

export function decodeSnapshot(snap: CompactSnapshot, prev?: GameState): GameState {
  return {
    tick: snap.k,
    trackId: prev?.trackId ?? 'meadow',
    phase: snap.p,
    startTick: snap.st,
    totalLaps: snap.tl,
    cars: snap.c.map((c) => decodeCar(c, prev?.cars.find((x) => x.id === c.i))),
  };
}
