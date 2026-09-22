import type { PlacementPreview } from '../bridge.js';
import { spriteIndex } from './atlas.js';
import { writeColourway, writeInstance } from './instances.js';
import { LAYER_FOREGROUND, LAYER_PROP, layeredDepth, screenX, screenY } from './iso.js';
import { emissiveForSprite, sampleLight, type TileLighting } from './lighting.js';
import { spriteDrawOffsetX, spriteDrawOffsetY } from './sprite-anchors.js';
import { writeFootprintProjection } from './footprint-depth.js';

const RING = spriteIndex('selectionRing');
const VALID = [0.75, 0.9, 1] as const;
const INVALID = [229 / 255, 140 / 255, 133 / 255] as const;

/** Floor tiles ringed in the preview tints: the Walls tool's chosen line. */
export interface TileHighlight {
  readonly tiles: readonly (readonly [number, number])[];
  readonly valid: boolean;
}

export function tileHighlightCount(highlight: TileHighlight | null): number {
  return highlight ? highlight.tiles.length : 0;
}

/** Appends one ring per tile, at the depth the placement preview's rings use. */
export function writeTileHighlight(out: Float32Array, slot: number,
  highlight: TileHighlight | null, originX: number, originY: number,
  gridSize: number, scale: number): number {
  if (!highlight) return slot;
  const tint = highlight.valid ? VALID : INVALID;
  for (const [x, y] of highlight.tiles) {
    writeInstance(out, slot++, screenX(x, y, originX, scale), screenY(x, y, originY, scale),
      layeredDepth(x, y, gridSize, LAYER_PROP + 0.25), RING, ...tint, 1);
  }
  return slot;
}

export function placementInstanceCount(preview: PlacementPreview | null): number {
  return preview && preview.width > 0 && preview.depth > 0
    ? preview.width * preview.depth + 1 + (preview.foreground === null ? 0 : 1) : 0;
}

/**
 * Appends a tinted candidate without changing the original object's rows.
 * The candidate stands in for the object while it is chosen, so it is drawn
 * in the object's colourway ([RC-render]). A purchase's candidate is drawn in
 * the colourway chosen in the Buy tool's Colour list.
 */
export function writePlacementPreview(out: Float32Array, slot: number,
  preview: PlacementPreview | null, originX: number, originY: number,
  gridSize: number, scale: number, lighting: TileLighting | null,
  colourwayShifts: Float32Array | null = null, colourway = 0): number {
  if (!preview || placementInstanceCount(preview) === 0) return slot;
  const tint = preview.valid ? VALID : INVALID;
  for (let dy = 0; dy < preview.depth; dy += 1) {
    for (let dx = 0; dx < preview.width; dx += 1) {
      const x = preview.x + dx, y = preview.y + dy;
      writeInstance(out, slot++, screenX(x, y, originX, scale), screenY(x, y, originY, scale),
        layeredDepth(x, y, gridSize, LAYER_PROP + 0.25), RING, ...tint, 1);
    }
  }
  const x = preview.x + (preview.width - 1) / 2;
  const y = preview.y + (preview.depth - 1) / 2;
  const light = lighting ? sampleLight(lighting, Math.floor(x), Math.floor(y)) : 0;
  for (let layer = 0; layer < 2; layer += 1) {
    const sprite = layer === 0 ? preview.sprite : preview.foreground;
    if (sprite === null) continue;
    writeInstance(out, slot++, screenX(x, y, originX, scale) + spriteDrawOffsetX(sprite) * scale,
      screenY(x, y, originY, scale) + spriteDrawOffsetY(sprite) * scale,
      layeredDepth(x, y, gridSize, (layer === 0 ? LAYER_PROP : LAYER_FOREGROUND) + 0.5),
      sprite, ...tint, Math.max(light, emissiveForSprite(sprite)));
    if (colourwayShifts !== null) writeColourway(out, slot - 1, colourwayShifts, colourway);
    writeFootprintProjection(out, slot - 1, preview.width, preview.depth, sprite, gridSize);
  }
  return slot;
}
