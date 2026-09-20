import { LAYER_FOREGROUND, LAYER_PROP, layeredDepth, screenX, screenY } from './iso.js';
import { writeInstance, type InstanceArray } from './instances.js';
import { sampleLight, type TileLighting } from './lighting.js';
import { spriteDrawOffsetX, spriteDrawOffsetY } from './sprite-anchors.js';

/** Separate from entity rows so a doorway cannot become a selectable object. */
export interface PortalSource {
  readonly portalCount: number;
  portalPositions(): Float32Array;
  portalFrames(): Uint32Array;
  portalDepthOffsets(): Float32Array;
  portalLeaves(reducedMotion: boolean): Uint32Array;
}

/** Appends frame and leaf to the existing GPU draw without allocating per frame. */
export function writePortals(
  out: InstanceArray, slot: number, source: PortalSource,
  originX: number, originY: number, gridSize: number, scale: number,
  reducedMotion: boolean, lighting: TileLighting | null,
): number {
  const positions = source.portalPositions();
  const frames = source.portalFrames();
  const depthOffsets = source.portalDepthOffsets();
  const leaves = source.portalLeaves(reducedMotion);
  for (let i = 0; i < source.portalCount; i++) {
    const x = positions[i * 2];
    const y = positions[i * 2 + 1];
    const light = lighting === null ? 0 : sampleLight(lighting, Math.floor(x), Math.floor(y));
    for (let layer = 0; layer < 2; layer++) {
      const sprite = layer === 0 ? frames[i] : leaves[i];
      writeInstance(out, slot++,
        screenX(x, y, originX, scale) + spriteDrawOffsetX(sprite) * scale,
        screenY(x, y, originY, scale) + spriteDrawOffsetY(sprite) * scale,
        layeredDepth(x + depthOffsets[i], y, gridSize, layer === 0 ? LAYER_PROP : LAYER_FOREGROUND),
        sprite, 1, 1, 1, light);
    }
  }
  return slot;
}
