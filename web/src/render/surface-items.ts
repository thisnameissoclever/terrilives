import { SURFACE_LAYOUTS } from './atlas.js';

export interface SurfaceLayout {
  readonly kind: 'counter' | 'table';
  readonly points: readonly (readonly [number, number])[];
  /** Single used plate, pair, prep bowl, accumulated prep, and served meal. */
  readonly props: readonly number[];
}

export function surfaceLayout(sprite: number): SurfaceLayout | undefined {
  return SURFACE_LAYOUTS[sprite];
}

/** Counter prep and waiting meals occupy separate authored places. */
export function surfaceItemCount(layout: SurfaceLayout | undefined, dirty: number, food: number): number {
  if (!layout) return 0;
  return layout.kind === 'counter' ? Number(dirty > 0) + Math.min(food, 3) : Math.min(dirty, 4);
}

export function surfacePointIndex(layout: SurfaceLayout, dirty: number, item: number): number {
  return layout.kind === 'counter' && dirty === 0 ? item + 1 : item;
}

export function surfaceItemSprite(layout: SurfaceLayout, dirty: number, item: number): number {
  if (layout.kind === 'table') return layout.props[dirty > 4 + item ? 1 : 0];
  if (dirty === 0 || item > 0) return layout.props[4];
  return layout.props[dirty >= 6 ? 3 : dirty >= 3 ? 2 : dirty >= 2 ? 1 : 0];
}
