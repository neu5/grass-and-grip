import { describe, expect, it } from 'vitest';
import { soundEvents } from '../src/client/soundEvents';
import { createRace, step, type GameState } from '../src/sim';

function race(trackId = 'meadow', countdown = 3): GameState {
  return createRace({
    trackId,
    totalLaps: 1,
    cars: [{ name: 'T', color: '#fff', controller: 'human' }],
    countdownSeconds: countdown,
  });
}

/** Step until an event of `kind` is heard (up to 20 ticks). */
function untilEvent(s: GameState, kind: string) {
  for (let i = 0; i < 20; i++) {
    const next = step(s, {});
    const hit = soundEvents(s, next).find((e) => e.kind === kind);
    if (hit) return hit;
    s = next;
  }
  return undefined;
}

describe('sound events', () => {
  it('beeps each countdown second and once more, higher, on GO', () => {
    let s = race();
    const beeps: boolean[] = [];
    for (let i = 0; i < 200; i++) {
      const next = step(s, {});
      for (const e of soundEvents(s, next)) if (e.kind === 'beep') beeps.push(e.final);
      s = next;
    }
    expect(beeps).toEqual([false, false, true]);
  });

  it('hears a crash into the wall, scaled by the hit', () => {
    let s = race('meadow', 0);
    s.phase = 'racing';
    s.cars[0].x = 40;
    s.cars[0].y = 500;
    s.cars[0].vx = -400;
    const crash = untilEvent(s, 'crash');
    expect(crash).toBeDefined();
    expect(crash && crash.kind === 'crash' && crash.strength).toBeGreaterThan(0.3);
  });

  it('hears a crash even with damage switched off', () => {
    let s = createRace({
      trackId: 'meadow',
      totalLaps: 1,
      cars: [{ name: 'T', color: '#fff', controller: 'human' }],
      countdownSeconds: 0,
      rules: { damage: 0, tyreWear: 1, fuel: 1, collisions: true, aiLevel: 70 },
    });
    s.phase = 'racing';
    s.cars[0].x = 40;
    s.cars[0].y = 500;
    s.cars[0].vx = -400;
    expect(untilEvent(s, 'crash')).toBeDefined();
  });

  it('hears a cone being hit, laps and the finish', () => {
    let s = race('alpine', 0);
    s.phase = 'racing';
    const cone = s.props![0];
    s.cars[0].x = cone.x - 30;
    s.cars[0].y = cone.y;
    s.cars[0].vx = 300;
    s.cars[0].angle = 0;
    let heard = false;
    for (let i = 0; i < 20 && !heard; i++) {
      const next = step(s, {});
      heard = soundEvents(s, next).some((e) => e.kind === 'cone');
      s = next;
    }
    expect(heard).toBe(true);

    const a = race('meadow', 0);
    const b = structuredClone(a);
    b.cars[0].lapsCompleted = 1;
    b.cars[0].finishTick = 10;
    expect(soundEvents(a, b).map((e) => e.kind)).toContain('finish');
    const c = structuredClone(a);
    c.totalLaps = 3;
    c.cars[0].lapsCompleted = 1;
    expect(soundEvents(a, c).map((e) => e.kind)).toContain('lap');
  });

  it('hears the pit crew while a stopped car is serviced', () => {
    const a = race('meadow', 0);
    a.cars[0].fuel = 0.5;
    const b = structuredClone(a);
    b.cars[0].fuel = 0.51;
    expect(soundEvents(a, b).map((e) => e.kind)).toContain('pit');
  });
});
