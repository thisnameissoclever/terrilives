import { expect, it } from 'vitest';
import { placementInstanceCount, writePlacementPreview } from '../src/render/placement-preview.js';
import { FLOATS_PER_INSTANCE } from '../src/render/instances.js';
import { spriteIndex } from '../src/render/atlas.js';
import { spriteDrawOffsetX, spriteDrawOffsetY } from '../src/render/sprite-anchors.js';
import type { PlacementPreview } from '../src/bridge.js';

const preview: PlacementPreview = { valid: true, reason: null, x: 2, y: 4, facing: 0,
  width: 2, depth: 1, sprite: spriteIndex('selectionRing'), foreground: spriteIndex('selectionRing') };

it('writes every rectangular footprint tile plus centered art and foreground without treating emissive as alpha', () => {
  expect(placementInstanceCount(preview)).toBe(4);
  const data = new Float32Array(6 * FLOATS_PER_INSTANCE).fill(-99);
  expect(writePlacementPreview(data, 1, preview, 100, 100, 16, 1, null)).toBe(5);
  expect(Array.from(data.slice(0, 8))).toEqual(Array(8).fill(-99));
  expect([data[8], data[9], data[16], data[17]]).toEqual([36, 226, 68, 247]);
  expect(data[24]).toBe(52 + spriteDrawOffsetX(preview.sprite));
  expect(data[25]).toBe(236.5 + spriteDrawOffsetY(preview.sprite));
  expect(data[28]).toBeCloseTo(0.75);
  expect(data[29]).toBeCloseTo(0.9);
  expect(data[30]).toBeCloseTo(1);
  expect(data[31]).toBe(0);
  expect(data[35]).toBe(preview.foreground);
  expect(Array.from(data.slice(40))).toEqual(Array(8).fill(-99));
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
