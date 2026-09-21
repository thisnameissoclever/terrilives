import {
  FLOATS_PER_INSTANCE, FOOTPRINT_PROJECTION, OFFSET_WALL_MASK,
  OFFSET_WALL_DEPTH_STEP, OFFSET_FOOTPRINT_SPAN, OFFSET_PROJECTION_ANCHOR_X,
} from './instances.js';
import { layeredDepth, LAYER_PROP } from './iso.js';
import { spriteDrawOffsetX } from './sprite-anchors.js';

/** Project an already-written row through its centered collision footprint. */
export function writeFootprintProjection(out: Float32Array, slot: number,
  width: number, depth: number, sprite: number, gridSize: number): void {
  // A square footprint's column midpoints all have its center depth. Keep
  // those rows flat, as well as sources without compiled footprint metadata.
  if (width <= 0 || depth <= 0 || width === depth) return;
  const base = slot * FLOATS_PER_INSTANCE;
  out[base + OFFSET_WALL_MASK] = FOOTPRINT_PROJECTION;
  out[base + OFFSET_WALL_DEPTH_STEP] =
    layeredDepth(0, 0, gridSize, LAYER_PROP) - layeredDepth(1, 0, gridSize, LAYER_PROP);
  out[base + OFFSET_FOOTPRINT_SPAN] = (width - depth) / 2;
  out[base + OFFSET_PROJECTION_ANCHOR_X] = spriteDrawOffsetX(sprite);
}
