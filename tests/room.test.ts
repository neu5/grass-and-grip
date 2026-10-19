import { describe, expect, it } from 'vitest';
import { CAR_COLORS } from '../src/net/protocol';
import { COUNTDOWN_SECONDS, RESULTS_TICKS, Room } from '../src/net/room';
import { TICK_RATE } from '../src/sim';

const [RED, BLUE, YELLOW, GREEN] = CAR_COLORS;

function roomWith(...colors: string[]): Room {
  const room = new Room('test');
  colors.forEach((c, i) => expect(room.join(`p${i}`, `P${i}`, c)).toBeNull());
  return room;
}

describe('room joining', () => {
  it('keeps car colors unique and validates them', () => {
    const room = roomWith(RED);
    expect(room.join('b', 'B', RED)).toBe('Color already taken');
    expect(room.join('b', 'B', '#123456')).toBe('Unknown color');
    expect(room.join('b', 'B', BLUE)).toBeNull();
    expect(room.join('b', 'B', YELLOW)).toBe('Already joined');
  });

  it('caps the room at 4 players', () => {
    const room = roomWith(RED, BLUE, YELLOW, GREEN);
    expect(room.join('e', 'E', RED)).toBe('Room is full');
    expect(room.players).toHaveLength(4);
  });

  it('trims names and falls back to a default', () => {
    const room = roomWith();
    room.join('a', '   ', RED);
    room.join('b', 'x'.repeat(40), BLUE);
    expect(room.players[0].name).toBe('Player 1');
    expect(room.players[1].name).toHaveLength(16);
  });

  it('passes host to the next player when the host leaves', () => {
    const room = roomWith(RED, BLUE);
    expect(room.hostId).toBe('p0');
    room.leave('p0');
    expect(room.hostId).toBe('p1');
    expect(room.view().players[0].host).toBe(true);
  });
});

describe('room settings', () => {
  it('keeps humans + AI within 4 cars', () => {
    const room = roomWith(RED);
    expect(room.aiCount).toBe(3);
    room.join('b', 'B', BLUE);
    expect(room.aiCount).toBe(2);
    expect(room.setSettings('p0', { aiCount: 3 })).toBe('Too many cars');
    expect(room.setSettings('p0', { aiCount: 0 })).toBeNull();
    expect(room.aiCount).toBe(0);
  });

  it('only lets the host change settings', () => {
    const room = roomWith(RED, BLUE);
    expect(room.setSettings('p1', { laps: 1 })).toBe('Only the host can change settings');
    expect(room.setSettings('p0', { laps: 4 })).toBe('Invalid lap count');
    expect(room.setSettings('p0', { laps: 1 })).toBeNull();
    expect(room.laps).toBe(1);
  });
});

describe('ready flow', () => {
  it('starts the race only once every human is ready', () => {
    const room = roomWith(RED, BLUE);
    room.setReady('p0', true);
    expect(room.phase).toBe('lobby');
    room.setReady('p1', true);
    expect(room.phase).toBe('racing');
    expect(room.race!.phase).toBe('countdown');
    expect(room.race!.startTick).toBe(COUNTDOWN_SECONDS * TICK_RATE);
  });

  it('un-readying keeps the room in the lobby', () => {
    const room = roomWith(RED, BLUE);
    room.setReady('p0', true);
    room.setReady('p0', false);
    room.setReady('p1', true);
    expect(room.phase).toBe('lobby');
  });

  it('starts when the last unready player leaves', () => {
    const room = roomWith(RED, BLUE);
    room.setReady('p0', true);
    room.leave('p1');
    expect(room.phase).toBe('racing');
  });

  it('accepts a repeated car type and rejects an unknown car', () => {
    const room = roomWith(RED);
    expect(room.join('b', 'B', BLUE, 'f1')).toBeNull();
    expect(room.join('c', 'C', YELLOW, 'f1')).toBeNull();
    expect(room.players.map((p) => p.car)).toEqual(['rally', 'f1', 'f1']);
    expect(room.join('d', 'D', GREEN, 'truck')).toBe('Unknown car');
  });

  it('puts each player in their chosen car and fills AI with the other body', () => {
    const room = new Room('cars');
    expect(room.join('p0', 'Ada', RED, 'f1')).toBeNull();
    room.setSettings('p0', { aiCount: 1 });
    room.setReady('p0', true);
    expect(room.race!.cars[0].kind).toBe('f1');
    expect(room.race!.cars[1].kind).toBe('rally');
    expect(room.race!.cars[1].controller).toBe('ai');
  });

  it('builds the grid from humans plus AI in free colors', () => {
    const room = roomWith(BLUE, GREEN);
    room.setSettings('p0', { aiCount: 2 });
    room.setReady('p0', true);
    room.setReady('p1', true);
    const cars = room.race!.cars;
    expect(cars.map((c) => c.controller)).toEqual(['human', 'human', 'ai', 'ai']);
    expect(new Set(cars.map((c) => c.color)).size).toBe(4);
    expect(room.view().cars).toEqual({ p0: 0, p1: 1 });
  });

  it('applies each player input to their own car only after the countdown', () => {
    const room = roomWith(RED, BLUE);
    room.setSettings('p0', { aiCount: 0 });
    room.setReady('p0', true);
    room.setReady('p1', true);
    room.setInput('p1', { throttle: 5, steer: 0, handbrake: false });
    for (let i = 0; i < COUNTDOWN_SECONDS * TICK_RATE; i++) room.tick();
    const startX = room.race!.cars.map((c) => [c.x, c.y]);
    for (let i = 0; i < 30; i++) room.tick();
    const [p0, p1] = room.race!.cars;
    expect([p0.x, p0.y]).toEqual(startX[0]);
    expect(Math.hypot(p1.vx, p1.vy)).toBeGreaterThan(0);
  });

  it('ignores ready changes and spectators during a race', () => {
    const room = roomWith(RED);
    room.setReady('p0', true);
    expect(room.join('late', 'Late', BLUE)).toBeNull();
    expect(room.setReady('late', true)).toBe('Race in progress');
    expect(room.view().cars).toEqual({ p0: 0 });
  });

  it('returns to the lobby with ready flags cleared after the results screen', () => {
    const room = roomWith(RED);
    room.setReady('p0', true);
    for (const car of room.race!.cars) car.finishTick = 1;
    room.race!.phase = 'racing';
    room.race!.tick = room.race!.startTick;
    room.tick();
    expect(room.phase).toBe('results');
    for (let i = 0; i < RESULTS_TICKS; i++) room.tick();
    expect(room.phase).toBe('lobby');
    expect(room.race).toBeNull();
    expect(room.players[0].ready).toBe(false);
  });

  it('goes back to the lobby when every racer leaves mid-race', () => {
    const room = roomWith(RED);
    room.setReady('p0', true);
    room.join('late', 'Late', BLUE);
    room.leave('p0');
    expect(room.phase).toBe('lobby');
    expect(room.race).toBeNull();
  });
});
