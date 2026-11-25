import { IN_GROUND_POOL_MODEL } from './character/pool-world-layout.js';
import type { FloorOpening } from './tiles.js';

interface PoolTerrainSource {
  ids(): Uint32Array;
  kinds(): Uint32Array;
  positions(): Float32Array;
  footprintWidths(): Uint32Array;
  footprintDepths(): Uint32Array;
  objectModel(entity: number): { readonly id: string } | undefined;
}

interface PoolFloorOpening extends FloorOpening {
  readonly entity: number;
}

/** The deck overlays a ring of ordinary floor tiles around the basin. */
export function inGroundPoolFloorOpenings(source: PoolTerrainSource): readonly PoolFloorOpening[] {
  const ids = source.ids(), kinds = source.kinds(), positions = source.positions();
  const widths = source.footprintWidths(), depths = source.footprintDepths();
  const candidates: PoolFloorOpening[] = [];
  for (let row = 0; row < ids.length; row++) {
    const width = widths[row], depth = depths[row];
    if (kinds[row] !== 1 || width <= 2 || depth <= 2) continue;
    const x = Math.floor(positions[row * 2] - (width - 1) / 2);
    const y = Math.floor(positions[row * 2 + 1] - (depth - 1) / 2);
    candidates.push({ entity: ids[row], x: x + 1, y: y + 1, width: width - 2, depth: depth - 2 });
  }
  // The string-returning WASM call may detach the views used above.
  return candidates.filter(({ entity }) => source.objectModel(entity)?.id === IN_GROUND_POOL_MODEL);
}
