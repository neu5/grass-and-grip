import { describe, expect, it } from 'vitest';
import { SnapshotBuffer, extrapolateCar, mergeOwn } from '../src/net/interpolate';
import { InputQueue, lerpCar, reconcile, replayUnacked, smoothCar } from '../src/net/prediction';
import { decodeSnapshot, encodeSnapshot, POS_Q } from '../src/net/snapshot';
import { COUNTDOWN_SECONDS, MAX_QUEUED_INPUTS, Room } from '../src/net/room';
import { CAR_COLORS } from '../src/net/protocol';
import { createRace, DT, NO_INPUT, step, stepOwnCar, TICK_RATE, type GameState, type PlayerInput } from '../src/sim';

const gas: PlayerInput = { throttle: 1, steer: 0, handbrake: false };
const turn: PlayerInput = { throttle: 1, steer: 1, handbrake: false };

function solo(): GameState {
  return createRace({
    trackId: 'meadow',
    totalLaps: 1,
    cars: [{ name: 'P1', color: '#e33', controller: 'human' }],
    countdownSeconds: 0,
  });
}

function drive(state: GameState, ticks: number, input: PlayerInput): GameState {
  for (let i = 0; i < ticks; i++) state = step(state, { 0: input });
  return state;
}

describe('InputQueue', () => {
  it('tags each push with a rising seq and drops acked inputs', () => {
    const q = new InputQueue();
    const a = q.push(10, gas);
    const b = q.push(11, turn);
    const c = q.push(12, NO_INPUT);
    expect(a.seq).toBe(1);
    expect(b.seq).toBe(2);
    expect(c.seq).toBe(3);
    expect(q.lastSeq).toBe(3);
    expect(q.unacked.map((i) => i.seq)).toEqual([1, 2, 3]);
    q.ack(2);
    expect(q.unacked.map((i) => i.input)).toEqual([NO_INPUT]);
    expect(q.unacked[0].seq).toBe(3);
  });

  it('reset starts seq at 1 again', () => {
    const q = new InputQueue();
    q.push(1, gas);
    q.push(2, gas);
    q.reset();
    expect(q.push(3, turn).seq).toBe(1);
    expect(q.unacked).toHaveLength(1);
  });
});

describe('stepOwnCar / prediction', () => {
  it('matches full step() for a solo car', () => {
    let full = solo();
    let own = solo();
    for (let i = 0; i < 180; i++) {
      const input = i % 40 > 30 ? turn : gas;
      full = step(full, { 0: input });
      own = stepOwnCar(own, 0, input);
    }
    expect(own.cars[0].x).toBeCloseTo(full.cars[0].x, 8);
    expect(own.cars[0].y).toBeCloseTo(full.cars[0].y, 8);
    expect(own.cars[0].angle).toBeCloseTo(full.cars[0].angle, 8);
    expect(own.tick).toBe(full.tick);
  });

  it('replay of unacked inputs matches continued local prediction', () => {
    const q = new InputQueue();
    let predicted = solo();
    const script = [gas, gas, turn, turn, gas, NO_INPUT, turn, gas];
    for (const input of script) {
      q.push(predicted.tick, input);
      predicted = stepOwnCar(predicted, 0, input);
    }
    let server = solo();
    for (let i = 0; i < 3; i++) server = stepOwnCar(server, 0, script[i]);
    q.ack(3);
    const replayed = replayUnacked(server, 0, q.unacked);
    expect(replayed.cars[0].x).toBeCloseTo(predicted.cars[0].x, 8);
    expect(replayed.cars[0].y).toBeCloseTo(predicted.cars[0].y, 8);
    expect(replayed.tick).toBe(predicted.tick);
  });

  it('reconcile rewinds and replays without snapping to the server pose', () => {
    const predicted = drive(solo(), 40, turn);
    const server = drive(solo(), 20, gas);
    const q = new InputQueue();
    let s = server;
    for (let i = 0; i < 20; i++) {
      q.push(s.tick, gas);
      s = stepOwnCar(s, 0, gas);
    }
    const next = reconcile(predicted, server, 0, q.unacked);
    const auth = s.cars[0];
    const live = predicted.cars[0];
    const out = next.cars[0];
    const lo = Math.min(live.x, auth.x);
    const hi = Math.max(live.x, auth.x);
    expect(out.x).toBeGreaterThan(lo);
    expect(out.x).toBeLessThan(hi);
    expect(Math.abs(out.x - live.x)).toBeLessThan(Math.abs(auth.x - live.x));
  });
});

describe('lerpCar', () => {
  it('is halfway between two poses at t=0.5', () => {
    const a = { ...solo().cars[0], x: 0, y: 0 };
    const b = { ...a, x: 10, y: 4 };
    const mid = lerpCar(a, b, 0.5);
    expect(mid.x).toBeCloseTo(5);
    expect(mid.y).toBeCloseTo(2);
  });
});

describe('smoothCar', () => {
  it('moves toward the target without landing on it in one step', () => {
    const from = solo().cars[0];
    const to = { ...from, x: from.x + 8, y: from.y + 4, angle: from.angle + 0.4 };
    const out = smoothCar(from, to);
    expect(out.x).toBeGreaterThan(from.x);
    expect(out.x).toBeLessThan(to.x);
    expect(out.y).toBeGreaterThan(from.y);
    expect(out.y).toBeLessThan(to.y);
  });
});

describe('compact snapshots', () => {
  it('round-trips needed fields within one quantization step', () => {
    const state = drive(solo(), 90, turn);
    const again = decodeSnapshot(encodeSnapshot(state, 4));
    expect(again.tick).toBe(state.tick);
    expect(again.phase).toBe(state.phase);
    expect(again.cars[0].name).toBe('P1');
    expect(again.cars[0].kind).toBe('rally');
    const f1 = createRace({
      trackId: 'meadow',
      totalLaps: 1,
      cars: [{ name: 'F', color: '#e33', controller: 'human', kind: 'f1' }],
      countdownSeconds: 0,
    });
    expect(decodeSnapshot(encodeSnapshot(f1)).cars[0].kind).toBe('f1');
    expect(Math.abs(again.cars[0].x - state.cars[0].x)).toBeLessThan(1 / POS_Q + 1e-9);
    expect(Math.abs(again.cars[0].y - state.cars[0].y)).toBeLessThan(1 / POS_Q + 1e-9);
    expect(encodeSnapshot(state).c[0]).not.toHaveProperty('ai');
    expect(again.cars[0].tyreWear).toBeDefined();
    expect(again.cars[0].fuel).toBeDefined();
    const worn = { ...state, cars: [{ ...state.cars[0], tyreWear: 0.42, fuel: 0.63, damage: 0.37 }] };
    const round = decodeSnapshot(encodeSnapshot(worn));
    expect(Math.abs(round.cars[0].tyreWear - 0.42)).toBeLessThan(1 / 1000 + 1e-9);
    expect(Math.abs(round.cars[0].fuel - 0.63)).toBeLessThan(1 / 1000 + 1e-9);
    expect(Math.abs(round.cars[0].damage - 0.37)).toBeLessThan(1 / 1000 + 1e-9);
  });
});

describe('snapshot interpolation', () => {
  it('interpolates between two snaps and extrapolates on a short gap', () => {
    const a = drive(solo(), 30, gas);
    const b = drive(a, 3, gas);
    const buf = new SnapshotBuffer();
    // Three ticks apart, arriving on time (50 ms).
    buf.push(a, 1000);
    buf.push(b, 1050);
    const mid = buf.sample(1000 + 100 + 25)!;
    expect(mid.alpha).toBeCloseTo(0.5, 5);
    expect(mid.prev.tick).toBe(a.tick);
    expect(mid.curr.tick).toBe(b.tick);

    const late = buf.sample(1050 + 100 + 40)!;
    const extra = extrapolateCar(b.cars[0], 0.04);
    expect(late.curr.cars[0].x).toBeCloseTo(extra.x, 5);
    expect(late.curr.cars[0].y).toBeCloseTo(extra.y, 5);
  });

  it('plays snapshots on the server clock, so a late one and an early one still move steadily', () => {
    let s = drive(solo(), 30, gas);
    const buf = new SnapshotBuffer();
    // Every 3 ticks (50 ms) on the server; the second packet is 40 ms late and bunches with the third.
    const arrive = [1000, 1090, 1100, 1150, 1200];
    const ticks: number[] = [];
    for (const at of arrive) {
      ticks.push(s.tick);
      buf.push(s, at);
      s = drive(s, 3, gas);
    }
    // Rendering 100 ms behind: each 10 ms moves the same 0.6 of a tick.
    const at = (now: number) => {
      const smp = buf.sample(now)!;
      return smp.prev.tick + (smp.curr.tick - smp.prev.tick) * smp.alpha;
    };
    for (let now = 1110; now < 1290; now += 10) expect(at(now + 10) - at(now)).toBeCloseTo(0.6, 5);
    expect(at(1100)).toBeCloseTo(ticks[0], 5);
  });

  it('mergeOwn keeps remotes from the buffer and the predicted local car', () => {
    const remote = drive(solo(), 10, NO_INPUT);
    remote.cars[0] = { ...remote.cars[0], x: 10, name: 'remote' };
    const own = drive(solo(), 10, gas);
    own.cars[0] = { ...own.cars[0], x: 99, name: 'pred' };
    const merged = mergeOwn(remote, own, 0);
    expect(merged.cars[0].x).toBe(99);
    expect(merged.tick).toBe(own.tick);
  });
});

describe('room input seq', () => {
  it('acks the seq it has played and ignores stale packets', () => {
    const room = new Room('seq');
    expect(room.join('p0', 'Ada', CAR_COLORS[0])).toBeNull();
    room.setReady('p0', true);
    expect(room.ackOf('p0')).toBe(0);
    room.setInput('p0', gas, 1);
    room.setInput('p0', turn, 2);
    room.setInput('p0', NO_INPUT, 1);
    // Received is not played: the ack moves one tick at a time.
    expect(room.ackOf('p0')).toBe(0);
    room.tick();
    expect(room.ackOf('p0')).toBe(1);
    room.tick();
    expect(room.ackOf('p0')).toBe(2);
    room.setInput('p0', gas, 3);
    for (let i = 0; i < COUNTDOWN_SECONDS * TICK_RATE + 8; i++) room.tick();
    const mine = room.race!.cars[room.carOf.get('p0')!];
    expect(Math.hypot(mine.vx, mine.vy)).toBeGreaterThan(0);
  });

  it('plays inputs that arrive in a bunch one per tick, in order, like the client drove them', () => {
    const room = new Room('bunch');
    room.join('p0', 'Ada', CAR_COLORS[0]);
    room.setSettings('p0', { aiCount: 0 });
    room.setReady('p0', true);
    const id = room.carOf.get('p0')!;
    // Countdown over, then the client's own copy starts from the same state.
    for (let i = 0; i < COUNTDOWN_SECONDS * TICK_RATE + 1; i++) room.tick();
    let client = room.race!;
    const drive = Array.from({ length: 24 }, (_, i): PlayerInput => (i % 6 < 2 ? turn : i % 6 < 4 ? gas : { throttle: 1, steer: -1, handbrake: false }));
    for (const input of drive) client = stepOwnCar(client, id, input);
    // The network delivers them four at a time, between server ticks.
    let seq = 0;
    for (let i = 0; i < drive.length; i += 4) {
      for (const input of drive.slice(i, i + 4)) room.setInput('p0', input, ++seq);
      for (let k = 0; k < 4; k++) room.tick();
    }
    expect(room.ackOf('p0')).toBe(drive.length);
    const server = room.race!.cars[id];
    const mine = client.cars[id];
    expect(server.x).toBeCloseTo(mine.x, 6);
    expect(server.y).toBeCloseTo(mine.y, 6);
    expect(server.angle).toBeCloseTo(mine.angle, 6);
  });

  it('keeps only a short queue, so a stalled server does not build up lag', () => {
    const room = new Room('cap');
    room.join('p0', 'Ada', CAR_COLORS[0]);
    room.setReady('p0', true);
    for (let s = 1; s <= MAX_QUEUED_INPUTS + 10; s++) room.setInput('p0', gas, s);
    room.tick();
    expect(room.ackOf('p0')).toBe(11);
  });
});

describe('fixed dt', () => {
  it('keeps the predicted step on the sim timestep', () => {
    expect(DT).toBeCloseTo(1 / 60);
  });
});
