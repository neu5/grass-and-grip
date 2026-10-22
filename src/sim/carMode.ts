import type { CarKind } from './types';

/** Host-set grid: mixed lets each driver pick; F1 forces every car. */
export type CarMode = 'mixed' | 'f1';

export const CAR_MODES = ['mixed', 'f1'] as const;
export const DEFAULT_CAR_MODE: CarMode = 'mixed';
export const CAR_MODE_NAMES: Record<CarMode, string> = {
  mixed: 'Mixed',
  f1: 'F1',
};

export function parseCarMode(v: unknown): CarMode | null {
  return v === 'mixed' || v === 'f1' ? v : null;
}

/** Rally pick is ignored when the host locks the grid to F1. */
export function spawnKind(picked: CarKind | undefined, mode: CarMode = DEFAULT_CAR_MODE): CarKind {
  if (mode === 'f1') return 'f1';
  return picked === 'f1' ? 'f1' : 'rally';
}

/** First AI fills in the missing body so both styles show; the rest alternate. F1 mode: all F1. */
export function spawnAiKind(index: number, humans: CarKind[], mode: CarMode = DEFAULT_CAR_MODE): CarKind {
  if (mode === 'f1') return 'f1';
  if (index === 0) {
    if (!humans.includes('f1')) return 'f1';
    if (!humans.includes('rally')) return 'rally';
  }
  return index % 2 === 0 ? 'f1' : 'rally';
}
