import { SURFACE_LAYOUTS } from './atlas.js';

export interface SurfaceLayout {
  readonly kind: 'counter' | 'table' | 'stove';
  readonly points: readonly (readonly [number, number])[];
  /** Single used plate, pair, prep bowl, accumulated prep, and served meal. */
  readonly props: readonly number[];
}

export function surfaceLayout(sprite: number): SurfaceLayout | undefined {
  return SURFACE_LAYOUTS[sprite];
}

/** Counter prep and waiting meals occupy separate authored places. */
export function surfaceItemCount(layout: SurfaceLayout | undefined, dirty: number, food: number, settings?: number, cooking=0): number {
  if (!layout) return 0;
  if (layout.kind === 'stove') return Number(cooking >= 1 && cooking <= 4);
  if (layout.kind === 'table' && settings !== undefined) {
    let count=0;
    for (let slot=0;slot<4;slot++) if (((settings >>> (4*slot)) & 15)>0) count++;
    return count;
  }
  return layout.kind === 'counter' ? Number(dirty > 0) + Math.min(food, 3) : Math.min(dirty, 4);
}

export function surfacePointIndex(layout: SurfaceLayout, dirty: number, item: number, settings?: number, cooking=0): number {
  if (layout.kind === 'stove') return Math.max(0,cooking-1);
  if (layout.kind === 'table' && settings !== undefined) {
    for (let slot=0;slot<4;slot++) if (((settings >>> (4*slot)) & 15)>0 && item--===0) return slot;
    return 0;
  }
  return layout.kind === 'counter' && dirty === 0 ? item + 1 : item;
}

export function surfaceItemSprite(layout: SurfaceLayout, dirty: number, item: number, settings?: number, cooking=0): number {
  if (layout.kind === 'stove') return layout.props[Math.max(0,cooking-1)];
  if (layout.kind === 'table' && settings !== undefined) {
    const setting=surfacePointIndex(layout,dirty,item,settings);
    return layout.props[((settings >>> (4*setting)) & 15) > 1 ? 1 : 0];
  }
  if (layout.kind === 'table') return layout.props[dirty > 4 + item ? 1 : 0];
  if (dirty === 0 || item > 0) return layout.props[4];
  return layout.props[dirty >= 6 ? 3 : dirty >= 3 ? 2 : dirty >= 2 ? 1 : 0];
}
