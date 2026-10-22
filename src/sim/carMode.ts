import { CAR_KINDS, CAR_KIND_NAMES, parseCarKind, type CarKind } from './types';

/** Host-set grid: mixed lets each driver pick; a car kind makes it one-make. */
export type CarMode = 'mixed' | CarKind;

export const CAR_MODES = ['mixed', ...CAR_KINDS] as const;
export const DEFAULT_CAR_MODE: CarMode = 'mixed';
export const CAR_MODE_NAMES: Record<CarMode, string> = {
  mixed: 'Mixed',
  ...CAR_KIND_NAMES,
};

export function parseCarMode(v: unknown): CarMode | null {
  return v === 'mixed' ? 'mixed' : parseCarKind(v);
}

/** The pick is ignored when the host locks the grid to one kind. */
export function spawnKind(picked: CarKind | undefined, mode: CarMode = DEFAULT_CAR_MODE): CarKind {
  if (mode !== 'mixed') return mode;
  return parseCarKind(picked) ?? 'rally';
}

/**
 * Mixed: AI starts with the kinds no human drives, then cycles through all of
 * them, so the grid shows every body. One-make: every AI gets that kind.
 */
export function spawnAiKind(index: number, humans: CarKind[], mode: CarMode = DEFAULT_CAR_MODE): CarKind {
  if (mode !== 'mixed') return mode;
  const order = [...CAR_KINDS.filter((k) => !humans.includes(k)), ...CAR_KINDS.filter((k) => humans.includes(k))];
  return order[index % order.length];
}
