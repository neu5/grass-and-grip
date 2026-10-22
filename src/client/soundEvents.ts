import type { GameState } from '../sim';

export type SoundEvent =
  | { kind: 'beep'; final: boolean }
  | { kind: 'crash'; car: number; strength: number }
  | { kind: 'cone'; index: number; x: number; y: number; strength: number }
  | { kind: 'lap'; car: number }
  | { kind: 'finish'; car: number }
  | { kind: 'pit'; car: number };

/** Speed lost in one step that counts as a hit even with damage off. */
const CRASH_SPEED_DROP = 140;

function secondsLeft(s: GameState): number {
  return Math.ceil((s.startTick - s.tick) / 60);
}

/**
 * One-shot sounds implied by two consecutive states (ticks or snapshots).
 * Pure, so it works the same for local play and online snapshots.
 */
export function soundEvents(prev: GameState, curr: GameState): SoundEvent[] {
  const out: SoundEvent[] = [];
  if (curr.phase === 'countdown' && secondsLeft(curr) !== secondsLeft(prev) && secondsLeft(curr) > 0) {
    out.push({ kind: 'beep', final: false });
  }
  if (prev.phase === 'countdown' && curr.phase !== 'countdown') out.push({ kind: 'beep', final: true });

  for (const c of curr.cars) {
    const p = prev.cars.find((q) => q.id === c.id);
    if (!p) continue;
    const dmg = (c.damage ?? 0) - (p.damage ?? 0);
    const drop = Math.hypot(p.vx, p.vy) - Math.hypot(c.vx, c.vy);
    if (dmg > 0.004 || drop > CRASH_SPEED_DROP) {
      out.push({ kind: 'crash', car: c.id, strength: Math.min(1, Math.max(dmg * 8, drop / 400)) });
    }
    if (c.lapsCompleted > p.lapsCompleted) {
      out.push(c.finishTick !== null && p.finishTick === null ? { kind: 'finish', car: c.id } : { kind: 'lap', car: c.id });
    }
    // Being serviced: a bar went back up while sitting still.
    const serviced = (c.fuel ?? 1) > (p.fuel ?? 1) + 1e-6 || (c.tyreWear ?? 0) < (p.tyreWear ?? 0) - 1e-6 || dmg < -1e-6;
    if (serviced && Math.hypot(c.vx, c.vy) < 5) out.push({ kind: 'pit', car: c.id });
  }

  const before = prev.props ?? [];
  (curr.props ?? []).forEach((b, i) => {
    const a = before[i];
    if (!a) return;
    // A cone that was still (or barely moving) and is now flying.
    const moved = Math.hypot(b.x - a.x, b.y - a.y);
    const was = Math.hypot(a.vx, a.vy);
    if ((moved > 1.5 && was < 20) || (!a.down && b.down)) out.push({ kind: 'cone', index: i, x: b.x, y: b.y, strength: Math.min(1, moved / 6) });
  });
  return out;
}
