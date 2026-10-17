import type { PlacementPreview } from '../bridge.js';
import { spriteIndex } from './atlas.js';
import { writeColourway, writeInstance, writeShade } from './instances.js';
import { LAYER_FOREGROUND, LAYER_PROP, layeredDepth, screenX, screenY } from './iso.js';
import { emissiveForSprite, sampleLight, type TileLighting } from './lighting.js';
import { spriteDrawOffsetX, spriteDrawOffsetY } from './sprite-anchors.js';
import { writeFootprintProjection } from './footprint-depth.js';
import { OPEN_SKY, sampleShade, type SkyExposure } from './sky.js';
import { coveredWindowLines, type WindowDefinition, type WindowEditPreview, type WindowPlacement } from '../architecture/windows.js';
import type { WallLine } from '../ui/wall-tool.js';
import {fixturePlacementOffset,type FixtureRegistrationSource} from './fixture-registration.js';
import {writePlacementMarker} from './ground-selection.js';

const lineKey = (line: WallLine): string => `${line.axis}/${line.x}/${line.y}`;
export const windowOwnerKey = (window: WindowPlacement): string => `window/${lineKey(window)}/${window.model}`;

/** A render-only layout from the accepted preview, including opaque wall restored by a narrower span. */
export function windowPreviewLayout(edges: Uint32Array, windows: readonly WindowPlacement[],
  catalogue: readonly WindowDefinition[], preview: WindowEditPreview | null | undefined):
  { edges: Uint32Array; windows: readonly WindowPlacement[]; ghostKey: string | null } {
  if (!preview?.valid) return { edges, windows, ghostKey: null };
  const affected = new Set(preview.affectedLines.map(lineKey));
  const nextWindows = windows.filter(window => !coveredWindowLines(window, catalogue).some(line => affected.has(lineKey(line))));
  if (preview.placement) nextWindows.push(preview.placement);
  const occupied = new Set(preview.placement ? coveredWindowLines(preview.placement, catalogue).map(lineKey) : []);
  const nextEdges: number[] = [];
  for (let i = 0; i < edges.length; i += 4) {
    if (!affected.has(`${edges[i]}/${edges[i + 1]}/${edges[i + 2]}`)) nextEdges.push(...edges.subarray(i, i + 4));
  }
  for (const line of preview.affectedLines) if (!occupied.has(lineKey(line))) nextEdges.push(line.axis, line.x, line.y, 0);
  return { edges: new Uint32Array(nextEdges), windows: nextWindows,
    ghostKey: preview.placement ? windowOwnerKey(preview.placement) : null };
}

export function tintWindowPreview(out: Float32Array, offset: number): void {
  out.set(VALID, offset + 4);
}

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

/**
 * Appends one ring sprite per tile, a quarter layer above the prop layer at
 * that tile. A highlight marks a line of tiles rather than one object, so it
 * keeps the per-tile ring instead of the placement preview's floor marker.
 */
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

/** One floor marker, the art and an optional foreground layer; nothing for an empty preview. */
export function placementInstanceCount(preview: PlacementPreview | null): number {
  return preview && preview.width > 0 && preview.depth > 0
    ? 2 + (preview.foreground === null ? 0 : 1) : 0;
}

/**
 * Appends a tinted candidate without changing the original object's rows.
 * The candidate stands in for the object while it is chosen, so it is drawn
 * in the object's colourway ([RC-render]). A purchase's candidate is drawn in
 * the colourway chosen in the Buy tool's Colour list. Its art takes the sky's
 * shade on the tile it would stand on, as the placed object will
 * ([OS-daylight]). One floor marker sized to the footprint goes first
 * ([PM-marker] in docs/specs/2026-10-17-placement-marker.md); it is drawn
 * after the opaque scene, so it stays unshaded and the art hides its middle.
 */
export function writePlacementPreview(out: Float32Array, slot: number,
  preview: PlacementPreview | null, originX: number, originY: number,
  gridSize: number, scale: number, lighting: TileLighting | null,
  colourwayShifts: Float32Array | null = null, colourway = 0,
  sky: SkyExposure = OPEN_SKY,physicalSource?:FixtureRegistrationSource): number {
  if (!preview || placementInstanceCount(preview) === 0) return slot;
  const tint = preview.valid ? VALID : INVALID;
  const centreX = preview.x + (preview.width - 1) / 2;
  const centreY = preview.y + (preview.depth - 1) / 2;
  const offset=physicalSource?fixturePlacementOffset(physicalSource,preview.sprite,centreX,centreY):null;
  const x=centreX+(offset?.[0]??0),y=centreY+(offset?.[1]??0);
  // The marker shares the art's physical registration, as the housemate marker follows a registered fixture.
  writePlacementMarker(out, slot++, screenX(x, y, originX, scale), screenY(x, y, originY, scale),
    preview.width, preview.depth, preview.valid);
  const light = lighting ? sampleLight(lighting, Math.floor(x), Math.floor(y)) : 0;
  const shade = sampleShade(sky, Math.floor(x), Math.floor(y));
  for (let layer = 0; layer < 2; layer += 1) {
    const sprite = layer === 0 ? preview.sprite : preview.foreground;
    if (sprite === null) continue;
    writeInstance(out, slot++, screenX(x, y, originX, scale) + spriteDrawOffsetX(sprite) * scale,
      screenY(x, y, originY, scale) + spriteDrawOffsetY(sprite) * scale,
      layeredDepth(x, y, gridSize, (layer === 0 ? LAYER_PROP : LAYER_FOREGROUND) + 0.5),
      sprite, ...tint, Math.max(light, emissiveForSprite(sprite)));
    if (colourwayShifts !== null) writeColourway(out, slot - 1, colourwayShifts, colourway);
    writeShade(out, slot - 1, shade);
    writeFootprintProjection(out, slot - 1, preview.width, preview.depth, sprite, gridSize);
  }
  return slot;
}
