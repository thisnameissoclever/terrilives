import { expect, it } from 'vitest';
import { placementInstanceCount, writePlacementPreview } from '../src/render/placement-preview.js';
import {
  FLOATS_PER_INSTANCE, OFFSET_EMISSIVE, OFFSET_SPRITE,
  OFFSET_TINT_R, OFFSET_TINT_G, OFFSET_TINT_B,
  OFFSET_WALL_MASK, OFFSET_WALL_DEPTH_STEP,
  OFFSET_FOOTPRINT_SPAN, OFFSET_PROJECTION_ANCHOR_X, OFFSET_COLOURWAY_HUE,
} from '../src/render/instances.js';
import { spriteIndex } from '../src/render/atlas.js';
import { spriteDrawOffsetX, spriteDrawOffsetY } from '../src/render/sprite-anchors.js';
import type { PlacementPreview } from '../src/bridge.js';

const preview: PlacementPreview = { valid: true, reason: null, x: 2, y: 4, facing: 0,
  width: 2, depth: 1, sprite: spriteIndex('selectionRing'), foreground: spriteIndex('selectionRing') };

it('writes every rectangular footprint tile plus centered art and foreground without treating emissive as alpha', () => {
  expect(placementInstanceCount(preview)).toBe(4);
  const data = new Float32Array(6 * FLOATS_PER_INSTANCE).fill(-99);
  expect(writePlacementPreview(data, 1, preview, 100, 100, 16, 1, null)).toBe(5);
  expect(Array.from(data.slice(0, FLOATS_PER_INSTANCE))).toEqual(Array(FLOATS_PER_INSTANCE).fill(-99));
  const first = FLOATS_PER_INSTANCE;
  const second = 2 * FLOATS_PER_INSTANCE;
  const body = 3 * FLOATS_PER_INSTANCE;
  expect([data[first], data[first + 1], data[second], data[second + 1]])
    .toEqual([36, 226, 68, 247]);
  expect(data[body]).toBe(52 + spriteDrawOffsetX(preview.sprite));
  expect(data[body + 1]).toBe(236.5 + spriteDrawOffsetY(preview.sprite));
  expect(data[body + OFFSET_TINT_R]).toBeCloseTo(0.75);
  expect(data[body + OFFSET_TINT_G]).toBeCloseTo(0.9);
  expect(data[body + OFFSET_TINT_B]).toBeCloseTo(1);
  expect(data[body + OFFSET_EMISSIVE]).toBe(0);
  expect(data[4 * FLOATS_PER_INSTANCE + OFFSET_SPRITE]).toBe(preview.foreground);
  for (let row = 1; row < 3; row += 1) {
    expect(data[row * FLOATS_PER_INSTANCE + OFFSET_WALL_MASK]).toBe(0);
    expect(data[row * FLOATS_PER_INSTANCE + OFFSET_WALL_DEPTH_STEP]).toBe(0);
  }
  for (let row = 3; row < 5; row += 1) {
    const base = row * FLOATS_PER_INSTANCE;
    expect(data[base + OFFSET_WALL_MASK]).toBe(-1);
    expect(data[base + OFFSET_WALL_DEPTH_STEP]).toBeGreaterThan(0);
    expect(data[base + OFFSET_FOOTPRINT_SPAN]).toBe(0.5);
    expect(data[base + OFFSET_PROJECTION_ANCHOR_X]).toBe(spriteDrawOffsetX(preview.sprite));
  }
  expect(Array.from(data.slice(5 * FLOATS_PER_INSTANCE))).toEqual(Array(FLOATS_PER_INSTANCE).fill(-99));
});

it('keeps refused furniture and red footprint visible, and emits nothing without a selection', () => {
  const refused = { ...preview, valid: false, foreground: null };
  const data = new Float32Array(3 * FLOATS_PER_INSTANCE);
  expect(placementInstanceCount(refused)).toBe(3);
  expect(writePlacementPreview(data, 0, refused, 0, 0, 16, 1, null)).toBe(3);
  expect(data[4]).toBeCloseTo(229 / 255);
  expect(data[5]).toBeCloseTo(140 / 255);
  expect(data[6]).toBeCloseTo(133 / 255);
  expect(placementInstanceCount(null)).toBe(0);
  expect(writePlacementPreview(data, 3, null, 0, 0, 16, 1, null)).toBe(3);
});

// [RC-render] in docs/specs/2026-09-22-colourways.md: the candidate stands in
// for the chosen object, so its art and foreground take the object's
// colourway, while its footprint rings keep only their tint.
it('draws the candidate in the colourway of the chosen object', () => {
  const shifts = new Float32Array([0, 1, 0, 120, 1.4, -0.04]);
  const data = new Float32Array(4 * FLOATS_PER_INSTANCE).fill(-99);
  expect(writePlacementPreview(data, 0, preview, 100, 100, 16, 1, null, shifts, 1)).toBe(4);
  const colourway = (row: number) =>
    Array.from(data.slice(row * FLOATS_PER_INSTANCE + OFFSET_COLOURWAY_HUE, (row + 1) * FLOATS_PER_INSTANCE));
  expect(colourway(0)).toEqual([0, 0, 0, 0]);
  expect(colourway(1)).toEqual([0, 0, 0, 0]);
  for (const row of [2, 3]) {
    expect(colourway(row)).toEqual([120, expect.closeTo(0.4), expect.closeTo(-0.04), 0]);
  }
  writePlacementPreview(data, 0, preview, 100, 100, 16, 1, null);
  for (const row of [2, 3]) expect(colourway(row)).toEqual([0, 0, 0, 0]);
});
