import { expect, it } from 'vitest';
import { placementInstanceCount, writePlacementPreview } from '../src/render/placement-preview.js';
import {
  FLOATS_PER_INSTANCE, OFFSET_EMISSIVE, OFFSET_SPRITE,
  OFFSET_TINT_R, OFFSET_TINT_G, OFFSET_TINT_B,
  OFFSET_WALL_MASK, OFFSET_WALL_DEPTH_STEP,
  OFFSET_FOOTPRINT_SPAN, OFFSET_PROJECTION_ANCHOR_X, OFFSET_COLOURWAY_HUE, OFFSET_SHADE,
} from '../src/render/instances.js';
import { spriteIndex } from '../src/render/atlas.js';
import { spriteDrawOffsetX, spriteDrawOffsetY } from '../src/render/sprite-anchors.js';
import {
  GROUND_MARKER_COMMAND, GROUND_MARKER_DEPTH, MARKER_BLUE, MARKER_RED, placementMarkerSemiAxis,
} from '../src/render/ground-selection.js';
import type { PlacementPreview } from '../src/bridge.js';

const preview: PlacementPreview = { valid: true, reason: null, x: 2, y: 4, facing: 0,
  width: 2, depth: 1, sprite: spriteIndex('selectionRing'), foreground: spriteIndex('selectionRing') };
const row = (data: Float32Array, index: number) =>
  Array.from(data.slice(index * FLOATS_PER_INSTANCE, (index + 1) * FLOATS_PER_INSTANCE));
const f32 = Math.fround;

// [PM-marker] in docs/specs/2026-10-17-placement-marker.md: one floor marker
// for the object, centered on its footprint, then the art and its foreground.
it('writes one footprint marker, then centered art and foreground without treating emissive as alpha', () => {
  expect(placementInstanceCount(preview)).toBe(3);
  const data = new Float32Array(5 * FLOATS_PER_INSTANCE).fill(-99);
  expect(writePlacementPreview(data, 1, preview, 100, 100, 16, 1, null)).toBe(4);
  expect(row(data, 0)).toEqual(Array(FLOATS_PER_INSTANCE).fill(-99));
  // The footprint covers tiles (2, 4) and (3, 4), so its center is (2.5, 4).
  expect(row(data, 1)).toEqual([
    52, 236.5, f32(GROUND_MARKER_DEPTH), spriteIndex('selectionRing'),
    ...MARKER_BLUE.map(f32), 1,
    GROUND_MARKER_COMMAND, 0, f32(placementMarkerSemiAxis(2)), f32(placementMarkerSemiAxis(1)),
    0, 0, 0, 0,
  ]);
  const body = 2 * FLOATS_PER_INSTANCE;
  expect(data[body]).toBe(52 + spriteDrawOffsetX(preview.sprite));
  expect(data[body + 1]).toBe(236.5 + spriteDrawOffsetY(preview.sprite));
  expect(data[body + OFFSET_TINT_R]).toBeCloseTo(0.75);
  expect(data[body + OFFSET_TINT_G]).toBeCloseTo(0.9);
  expect(data[body + OFFSET_TINT_B]).toBeCloseTo(1);
  expect(data[body + OFFSET_EMISSIVE]).toBe(0);
  expect(data[3 * FLOATS_PER_INSTANCE + OFFSET_SPRITE]).toBe(preview.foreground);
  for (let index = 2; index < 4; index += 1) {
    const base = index * FLOATS_PER_INSTANCE;
    expect(data[base + OFFSET_WALL_MASK]).toBe(-1);
    expect(data[base + OFFSET_WALL_DEPTH_STEP]).toBeGreaterThan(0);
    expect(data[base + OFFSET_FOOTPRINT_SPAN]).toBe(0.5);
    expect(data[base + OFFSET_PROJECTION_ANCHOR_X]).toBe(spriteDrawOffsetX(preview.sprite));
  }
  expect(row(data, 4)).toEqual(Array(FLOATS_PER_INSTANCE).fill(-99));
});

it.each([[1, 1], [2, 2], [1, 2], [2, 1], [3, 1], [3, 2]])(
  'marks a %i by %i footprint with exactly one marker and no per-tile ring', (width, depth) => {
    const footprint = { ...preview, width, depth, foreground: null };
    const data = new Float32Array(8 * FLOATS_PER_INSTANCE);
    const count = writePlacementPreview(data, 0, footprint, 0, 0, 16, 1, null);
    expect(count).toBe(2);
    const modes = Array.from({ length: count }, (_, index) => data[index * FLOATS_PER_INSTANCE + OFFSET_WALL_MASK]);
    expect(modes.filter(mode => mode === GROUND_MARKER_COMMAND)).toHaveLength(1);
    expect(modes[0]).toBe(GROUND_MARKER_COMMAND);
    expect(data[OFFSET_FOOTPRINT_SPAN]).toBe(f32(placementMarkerSemiAxis(width)));
    expect(data[OFFSET_PROJECTION_ANCHOR_X]).toBe(f32(placementMarkerSemiAxis(depth)));
  });

it('draws a refused placement marker red, keeps refused art in its tint, and emits nothing without a selection', () => {
  const refused = { ...preview, valid: false, foreground: null };
  const data = new Float32Array(3 * FLOATS_PER_INSTANCE);
  expect(placementInstanceCount(refused)).toBe(2);
  expect(writePlacementPreview(data, 0, refused, 0, 0, 16, 1, null)).toBe(2);
  expect([data[OFFSET_TINT_R], data[OFFSET_TINT_G], data[OFFSET_TINT_B]]).toEqual(MARKER_RED.map(f32));
  expect(data[OFFSET_WALL_MASK]).toBe(GROUND_MARKER_COMMAND);
  const art = FLOATS_PER_INSTANCE;
  expect(data[art + OFFSET_TINT_R]).toBeCloseTo(229 / 255);
  expect(data[art + OFFSET_TINT_G]).toBeCloseTo(140 / 255);
  expect(data[art + OFFSET_TINT_B]).toBeCloseTo(133 / 255);
  expect(placementInstanceCount(null)).toBe(0);
  expect(placementInstanceCount({ ...preview, width: 0 })).toBe(0);
  expect(writePlacementPreview(data, 3, null, 0, 0, 16, 1, null)).toBe(3);
});

// [RC-render] in docs/specs/2026-09-22-colourways.md: the candidate stands in
// for the chosen object, so its art and foreground take the object's
// colourway, while its floor marker keeps only its color.
it('draws the candidate in the colourway of the chosen object', () => {
  const shifts = new Float32Array([0, 1, 0, 120, 1.4, -0.04]);
  const data = new Float32Array(4 * FLOATS_PER_INSTANCE).fill(-99);
  expect(writePlacementPreview(data, 0, preview, 100, 100, 16, 1, null, shifts, 1)).toBe(3);
  const colourway = (index: number) =>
    Array.from(data.slice(index * FLOATS_PER_INSTANCE + OFFSET_COLOURWAY_HUE, (index + 1) * FLOATS_PER_INSTANCE));
  expect(colourway(0)).toEqual([0, 0, 0, 0]);
  for (const index of [1, 2]) {
    expect(colourway(index)).toEqual([120, expect.closeTo(0.4), expect.closeTo(-0.04), 0]);
  }
  writePlacementPreview(data, 0, preview, 100, 100, 16, 1, null);
  for (const index of [1, 2]) expect(colourway(index)).toEqual([0, 0, 0, 0]);
});

// Review finding [F2] on PR 116: the preview took no sky shade, so a piece
// being placed in a dim room looked brighter than it would once placed.
it('shades the preview art by the tile it would stand on, and leaves the marker unshaded', () => {
  // The preview's centre is (2.5, 4), which stands on tile (2, 4).
  const values = new Float32Array(5 * 6).fill(1);
  values[4 * 5 + 2] = 0.25;
  const data = new Float32Array(4 * FLOATS_PER_INSTANCE).fill(-99);
  writePlacementPreview(data, 0, preview, 100, 100, 16, 1, null, null, 0, { width: 5, height: 6, values });
  expect([0, 1, 2].map((index) => data[index * FLOATS_PER_INSTANCE + OFFSET_SHADE])).toEqual([0, 0.75, 0.75]);
  writePlacementPreview(data, 0, preview, 100, 100, 16, 1, null);
  expect(data[FLOATS_PER_INSTANCE + OFFSET_SHADE]).toBe(0);
});
