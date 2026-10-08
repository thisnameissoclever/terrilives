import {
  FLOATS_PER_INSTANCE, FOOTPRINT_PROJECTION, SURFACE_DEPTH_PROJECTION, OFFSET_WALL_MASK,
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
 * Per-pixel depth for a fixture scene whose body stands off the fixture's tile
 * (the fridge reach). The scene is drawn at the fixture's position, and its
 * companion depth sprite carries each pixel's game-space X+Y relative to that
 * position, as the door depth sprites do: the body and the open door take
 * their physical depth, and the fixture never reads farther than it does
 * when empty. A pixel is therefore hidden only by something physically
 * nearer, such as a wall in front of it, never by a wall behind it.
 */
export function writeSceneDepth(out: Float32Array, slot: number, depthSprite: number, gridSize: number): void {
  const base = slot * FLOATS_PER_INSTANCE;
  out[base + OFFSET_WALL_MASK] = SURFACE_DEPTH_PROJECTION;
  out[base + OFFSET_WALL_DEPTH_STEP] =
    layeredDepth(0, 0, gridSize, LAYER_PROP) - layeredDepth(1, 0, gridSize, LAYER_PROP);
  out[base + OFFSET_FOOTPRINT_SPAN] = depthSprite;
  out[base + OFFSET_PROJECTION_ANCHOR_X] = 0;
}
