import { describe, expect, it } from 'vitest';
import { CAR_COLORS, MAX_PLAYERS, clampAiCount, clampLaps, parseLaps } from '../src/net/protocol';
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

  it('caps the room at 8 players', () => {
    const room = roomWith(...CAR_COLORS);
    expect(room.join('e', 'E', RED)).toBe('Room is full');
    expect(room.players).toHaveLength(8);
    expect(CAR_COLORS).toHaveLength(MAX_PLAYERS);
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
  it('keeps humans + AI within 8 cars', () => {
    const room = roomWith(RED);
    expect(room.aiCount).toBe(7);
    room.join('b', 'B', BLUE);
    expect(room.aiCount).toBe(6);
    expect(room.setSettings('p0', { aiCount: 7 })).toBe('Too many cars');
    expect(room.setSettings('p0', { aiCount: 8 })).toBe('Too many cars');
    expect(room.setSettings('p0', { aiCount: 0 })).toBeNull();
    expect(room.aiCount).toBe(0);
    expect(clampAiCount(1, 9)).toBe(7);
    expect(clampAiCount(8, 1)).toBe(0);
  });

  it('fills remaining grid slots with uniquely colored AI up to 8', () => {
    const room = roomWith(RED);
    expect(room.setSettings('p0', { aiCount: 7 })).toBeNull();
    room.setReady('p0', true);
    expect(room.race!.cars).toHaveLength(8);
    expect(room.race!.cars.filter((c) => c.controller === 'ai')).toHaveLength(7);
    expect(new Set(room.race!.cars.map((c) => c.color)).size).toBe(8);
  });

  it('only lets the host change settings', () => {
    const room = roomWith(RED, BLUE);
    expect(room.setSettings('p1', { laps: 1 })).toBe('Only the host can change settings');
    expect(room.setSettings('p0', { laps: 1 })).toBeNull();
    expect(room.laps).toBe(1);
  });

  it('accepts laps 1–99 and rejects anything outside', () => {
    const room = roomWith(RED);
    expect(room.laps).toBe(3);
    expect(room.setSettings('p0', { laps: 0 })).toBe('Invalid lap count');
    expect(room.setSettings('p0', { laps: 100 })).toBe('Invalid lap count');
    expect(room.setSettings('p0', { laps: -3 })).toBe('Invalid lap count');
    expect(room.setSettings('p0', { laps: Number.NaN })).toBe('Invalid lap count');
    expect(room.setSettings('p0', { laps: Number.POSITIVE_INFINITY })).toBe('Invalid lap count');
    expect(room.laps).toBe(3);
    expect(room.setSettings('p0', { laps: 1 })).toBeNull();
    expect(room.laps).toBe(1);
    expect(room.setSettings('p0', { laps: 4 })).toBeNull();
    expect(room.laps).toBe(4);
    expect(room.setSettings('p0', { laps: 99 })).toBeNull();
    expect(room.laps).toBe(99);
    expect(room.setSettings('p0', { laps: 42.9 })).toBeNull();
    expect(room.laps).toBe(42);
  });

  it('clamps UI values into 1–99 and parseLaps rejects the rest', () => {
    expect(parseLaps(0)).toBeNull();
    expect(parseLaps(100)).toBeNull();
    expect(parseLaps('nope')).toBeNull();
    expect(parseLaps(1)).toBe(1);
    expect(parseLaps(99)).toBe(99);
    expect(clampLaps(0)).toBe(1);
    expect(clampLaps(100)).toBe(99);
    expect(clampLaps('')).toBe(3);
    expect(clampLaps(12)).toBe(12);
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
    expect(room.join('d', 'D', GREEN, 'tank')).toBe('Unknown car');
  });

  it('puts each player in their chosen car and fills AI with the other body', () => {
    const room = new Room('cars');
    expect(room.join('p0', 'Ada', RED, 'f1')).toBeNull();
    room.setSettings('p0', { aiCount: 1 });
    room.setReady('p0', true);
    expect(room.carMode).toBe('mixed');
    expect(room.view().carMode).toBe('mixed');
    expect(room.race!.cars[0].kind).toBe('f1');
    expect(room.race!.cars[1].kind).toBe('rally');
    expect(room.race!.cars[1].controller).toBe('ai');
  });

  it('F1 mode spawns every car as F1 and ignores rally picks', () => {
    const room = new Room('f1grid');
    expect(room.join('p0', 'Ada', RED, 'rally')).toBeNull();
    expect(room.join('p1', 'Bea', BLUE, 'rally')).toBeNull();
    expect(room.setSettings('p0', { carMode: 'f1', aiCount: 2 })).toBeNull();
    expect(room.view().carMode).toBe('f1');
    room.setReady('p0', true);
    room.setReady('p1', true);
    expect(room.race!.cars.map((c) => c.kind)).toEqual(['f1', 'f1', 'f1', 'f1']);
    expect(room.race!.cars.map((c) => c.controller)).toEqual(['human', 'human', 'ai', 'ai']);
    expect(new Set(room.race!.cars.map((c) => c.color)).size).toBe(4);
  });

  it('only the host can set car mode, and mixed stays pick-your-car', () => {
    const room = roomWith(RED, BLUE);
    expect(room.setSettings('p1', { carMode: 'f1' })).toBe('Only the host can change settings');
    expect(room.carMode).toBe('mixed');
    expect(room.setSettings('p0', { carMode: 'tank' })).toBe('Unknown car mode');
    expect(room.setSettings('p0', { carMode: 'f1' })).toBeNull();
    expect(room.carMode).toBe('f1');
    expect(room.setSettings('p0', { carMode: 'mixed', aiCount: 0 })).toBeNull();
    room.players[0].car = 'rally';
    room.players[1].car = 'f1';
    room.setReady('p0', true);
    room.setReady('p1', true);
    expect(room.race!.cars.map((c) => c.kind)).toEqual(['rally', 'f1']);
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
