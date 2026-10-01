import { LAYER_FOREGROUND, LAYER_PROP, layeredDepth, screenX, screenY } from './iso.js';
import {
  writeInstance, writeShade, type InstanceArray, FLOATS_PER_INSTANCE,
  SURFACE_DEPTH_PROJECTION, OFFSET_WALL_MASK, OFFSET_WALL_DEPTH_STEP,
  OFFSET_FOOTPRINT_SPAN, OFFSET_PROJECTION_ANCHOR_X,
} from './instances.js';
import { spriteIndex } from './atlas.js';
import { sampleLight, type TileLighting } from './lighting.js';
import { OPEN_SKY, sampleShade, type SkyExposure } from './sky.js';
import { spriteDrawOffsetX, spriteDrawOffsetY } from './sprite-anchors.js';

const oldFrame = spriteIndex('frontDoorFrameSELeft');
const oldClosed = spriteIndex('frontDoorClosedSELeft');
const oldOpen = spriteIndex('frontDoorOpenSELeft');
const models = Array.from({ length: 4 }, (_, facing) => ({
  frame: spriteIndex(`doorFrame${facing}`),
  frameDepth: spriteIndex(`doorFrame${facing}Depth`),
  leaves: Array.from({ length: 9 }, (_, phase) => spriteIndex(`doorLeaf${facing}_${phase}`)),
  depths: Array.from({ length: 9 }, (_, phase) => spriteIndex(`doorLeaf${facing}_${phase}Depth`)),
}));

/** Separate from entity rows so a doorway cannot become a selectable object. */
export interface PortalSource {
  readonly portalCount: number;
  portalPositions(): Float32Array;
  portalFrames(): Uint32Array;
  portalDepthOffsets(): Float32Array;
  portalLeaves(reducedMotion: boolean): Uint32Array;
  portalOpenness?(): Float32Array;
  portalPreviousOpenness?(): Float32Array;
  /** The tile across each row's line, `[x, y]` pairs. */
  portalFarSides(): Float32Array;
}

/**
 * Appends frame and leaf to the existing GPU draw without allocating per frame.
 * A portal is lit like the wall it stands in, from the brighter of its own tile
 * and the tile across its line, so a door between a lit room and a dark one
 * matches the wall around it. The sky's shade follows the same rule: the less
 * shaded side, as a wall panel takes ([OS-daylight]).
 */
export function writePortals(
  out: InstanceArray, slot: number, source: PortalSource,
  originX: number, originY: number, gridSize: number, scale: number,
  reducedMotion: boolean, lighting: TileLighting | null,
  sky: SkyExposure = OPEN_SKY,
  alpha = 1,
): number {
  const positions = source.portalPositions();
  const frames = source.portalFrames();
  const depthOffsets = source.portalDepthOffsets();
  const leaves = source.portalLeaves(reducedMotion);
  const farSides = source.portalFarSides();
  const openness = source.portalOpenness?.();
  const previous = source.portalPreviousOpenness?.();
  for (let i = 0; i < source.portalCount; i++) {
    const x = positions[i * 2];
    const y = positions[i * 2 + 1];
    const dx = farSides[i * 2] - x, dy = farSides[i * 2 + 1] - y;
    const model = frames[i] === oldFrame ? models[dx > .5 ? 0 : dy > .5 ? 1 : dx < -.5 ? 2 : 3] : undefined;
    const fallback = leaves[i] === oldClosed ? 0 : leaves[i] === oldOpen ? 1 : .5;
    const current = openness?.[i] ?? fallback;
    const amount = reducedMotion ? fallback : (previous?.[i] ?? current) * (1 - alpha) + current * alpha;
    const phase = Math.round(Math.min(1, Math.max(0, amount)) * 8);
    const light = lighting === null ? 0 : Math.max(
      sampleLight(lighting, Math.floor(x), Math.floor(y)),
      sampleLight(lighting, Math.floor(farSides[i * 2]), Math.floor(farSides[i * 2 + 1])),
    );
    const shade = Math.min(
      sampleShade(sky, Math.floor(x), Math.floor(y)),
      sampleShade(sky, Math.floor(farSides[i * 2]), Math.floor(farSides[i * 2 + 1])),
    );
    for (let layer = 0; layer < 2; layer++) {
      const original = layer === 0 ? frames[i] : leaves[i];
      const sprite = model === undefined ? original : layer === 0 ? model.frame : model.leaves[phase];
      writeInstance(out, slot++,
        screenX(x, y, originX, scale) + spriteDrawOffsetX(sprite) * scale,
        screenY(x, y, originY, scale) + spriteDrawOffsetY(sprite) * scale,
        layeredDepth(x + depthOffsets[i], y, gridSize, layer === 0 ? LAYER_PROP : LAYER_FOREGROUND),
        sprite, 1, 1, 1, light);
      writeShade(out, slot - 1, shade);
      if (model !== undefined) {
        const base = (slot - 1) * FLOATS_PER_INSTANCE;
        out[base + OFFSET_WALL_MASK] = SURFACE_DEPTH_PROJECTION;
        out[base + OFFSET_WALL_DEPTH_STEP] =
          layeredDepth(0, 0, gridSize, LAYER_PROP) - layeredDepth(1, 0, gridSize, LAYER_PROP);
        out[base + OFFSET_FOOTPRINT_SPAN] = layer === 0 ? model.frameDepth : model.depths[phase];
        out[base + OFFSET_PROJECTION_ANCHOR_X] = depthOffsets[i];
      }
    }
  }
  return slot;
}
