import type { BedScene } from './bed-sprites.js';

export interface SharedSeatProfile {
  readonly model: string;
  readonly seatIds: readonly string[];
  readonly cycleTicks: 16;
  /** Completed single-seat action exports may coexist with neutral sitting art. */
  readonly actions?: readonly number[];
  readonly scenes: Readonly<Record<number, BedScene>>;
}
export type SharedSeatCatalog = Readonly<Record<number, SharedSeatProfile>>;

/** Seat actions are empty/sit/read; each owner keeps its own shirt palette. */
export function sharedSeatKey(actions: number, phase: number, palette0: number,
  palette1: number, palette2: number): number {
  return (actions * 4 + phase) * 27 + palette0 + 3 * palette1 + 9 * palette2;
}

export function sharedSeatPhase(tick: number, reducedMotion: boolean): number {
  return reducedMotion ? 0 : Math.floor(tick / 4) % 4;
}
