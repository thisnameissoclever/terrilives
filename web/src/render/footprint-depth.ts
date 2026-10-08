import {
  FLOATS_PER_INSTANCE, FOOTPRINT_PROJECTION, OFFSET_DEPTH, OFFSET_WALL_MASK,
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

/**
 * Depth for a fixture scene whose body stands on the tile in front of the
 * fixture (the fridge reach). The scene is drawn at the fixture's position,
 * but a single depth there would put the body behind any wall beside the
 * front tile. The two tiles are treated as one two-tile footprint: depth is
 * taken at their midpoint and varies by screen column along their shared
 * axis, so the fixture's columns keep the fixture tile's depth and the
 * body's columns take the front tile's, as a Sim standing there would.
 * Rows whose tiles are not orthogonal neighbours are left unchanged.
 */
export function writeReachProjection(out: Float32Array, slot: number, sprite: number, gridSize: number,
  fixtureX: number, fixtureY: number, bodyX: number, bodyY: number, layer: number): void {
  const dx = Math.round(bodyX - fixtureX), dy = Math.round(bodyY - fixtureY);
  if (Math.abs(dx) + Math.abs(dy) !== 1) return;
  const base = slot * FLOATS_PER_INSTANCE;
  out[base + OFFSET_DEPTH] = layeredDepth(fixtureX + dx / 2, fixtureY + dy / 2, gridSize, layer);
  out[base + OFFSET_WALL_MASK] = FOOTPRINT_PROJECTION;
  out[base + OFFSET_WALL_DEPTH_STEP] =
    layeredDepth(0, 0, gridSize, LAYER_PROP) - layeredDepth(1, 0, gridSize, LAYER_PROP);
  // A run along x is two tiles wide; a run along y is two tiles deep.
  out[base + OFFSET_FOOTPRINT_SPAN] = dx !== 0 ? 0.5 : -0.5;
  // The shader measures columns from the projection anchor; move it from the
  // fixture to the midpoint, half a tile step along screen x.
  out[base + OFFSET_PROJECTION_ANCHOR_X] = spriteDrawOffsetX(sprite) - (dx - dy) * 16;
}
