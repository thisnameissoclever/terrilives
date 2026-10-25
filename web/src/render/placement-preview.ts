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
import {writePlacementMarker,writeSegmentMarker} from './ground-selection.js';

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

/**
 * A stretch of `length` wall lines from one line along its axis, marked on
 * the floor as one bar ([WB-mark]): what the Walls and Window tools have
 * chosen, or the line a click would choose.
 */
export interface LineMark {
  readonly axis: 0 | 1;
  readonly x: number;
  readonly y: number;
  readonly length: number;
  readonly valid: boolean;
  readonly hover?: boolean;
}

/**
 * Floor tiles ringed in the preview tints, the tiles a Room, Floors or Land
 * tool choice covers, and the bars along the wall lines a Walls or Window
 * tool choice covers.
 */
export interface TileHighlight {
  readonly tiles: readonly (readonly [number, number])[];
  readonly valid: boolean;
  /** Tiles in the choice that refuse it, ringed in the refused tint whatever `valid` says. */
  readonly refused?: readonly (readonly [number, number])[];
  readonly lines?: readonly LineMark[];
}

/** Ordered lines merged into one bar per unbroken stretch of the same validity. */
export function lineMarks(lines: readonly WallLine[], valid: readonly boolean[], hover = false): LineMark[] {
  const marks: LineMark[] = [];
  lines.forEach((line, at) => {
    const last = marks.at(-1);
    const along = line.axis === 0 ? line.y : line.x;
    if (last && last.axis === line.axis && last.valid === valid[at]
      && (line.axis === 0 ? last.x === line.x && last.y + last.length === along
        : last.y === line.y && last.x + last.length === along)) {
      marks[marks.length - 1] = { ...last, length: last.length + 1 };
    } else {
      marks.push({ axis: line.axis, x: line.x, y: line.y, length: 1, valid: valid[at], ...(hover ? { hover } : {}) });
    }
  });
  return marks;
}

/** The highlight with the bar for the line under the pointer added, unless that line is already chosen. */
export function withHoverLine(highlight: TileHighlight | null, hover: WallLine | null,
  chosen: readonly WallLine[] = []): TileHighlight | null {
  if (!hover || chosen.some(line => lineKey(line) === lineKey(hover))) return highlight;
  const mark = { axis: hover.axis, x: hover.x, y: hover.y, length: 1, valid: true, hover: true };
  return { tiles: highlight?.tiles ?? [], valid: highlight?.valid ?? true, ...(highlight?.refused ? { refused: highlight.refused } : {}),
    lines: [...(highlight?.lines ?? []), mark] };
}

export function tileHighlightCount(highlight: TileHighlight | null): number {
  return highlight ? highlight.tiles.length + (highlight.refused?.length ?? 0) + (highlight.lines?.length ?? 0) : 0;
}

/**
 * Appends one ring sprite per tile, a quarter layer above the prop layer at
 * that tile, then one floor bar per line mark. A tile highlight marks a set
 * of tiles, an area, rather than one object, so it keeps the per-tile ring
 * instead of the placement preview's floor marker.
 */
export function writeTileHighlight(out: Float32Array, slot: number,
  highlight: TileHighlight | null, originX: number, originY: number,
  gridSize: number, scale: number): number {
  if (!highlight) return slot;
  const ring = (tiles: readonly (readonly [number, number])[], tint: readonly [number, number, number]) => {
    for (const [x, y] of tiles) {
      writeInstance(out, slot++, screenX(x, y, originX, scale), screenY(x, y, originY, scale),
        layeredDepth(x, y, gridSize, LAYER_PROP + 0.25), RING, ...tint, 1);
    }
  };
  ring(highlight.tiles, highlight.valid ? VALID : INVALID);
  ring(highlight.refused ?? [], INVALID);
  for (const mark of highlight.lines ?? []) {
    const x = mark.x - 0.5 + (mark.axis === 1 ? mark.length / 2 : 0);
    const y = mark.y - 0.5 + (mark.axis === 0 ? mark.length / 2 : 0);
    writeSegmentMarker(out, slot++, screenX(x, y, originX, scale), screenY(x, y, originY, scale),
      mark.axis, mark.length, mark.valid, mark.hover === true);
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
 * later in the scene pass, over the opaque scene and under the short walls,
 * so it stays unshaded and the art hides its middle.
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
