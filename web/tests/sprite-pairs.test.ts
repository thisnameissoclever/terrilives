import { expect, it } from 'vitest';
import { packSpriteTable } from '../src/render/sprites.js';

const sprites = [0, 1, 2, 3].map((i) => ({ name: `fixture${i}`, x: i * 194, y: 0, w: 192, h: 240, pixel_density: 2 }));
const anchors = { 0: [48, 116], 1: [48, 116], 2: [48, 116], 3: [48, 116] } as const;

it('packs pair indices plus one while keeping ordinary table padding zero', () => {
  const table = packSpriteTable(sprites, 1024, 256, { 1: { furniture: 2, outline: 3 } }, anchors);
  expect(Array.from(table.slice(4, 8))).toEqual([96, 120, 0, 0]);
  expect(Array.from(table.slice(12, 16))).toEqual([96, 120, 3, 4]);
  expect(table[8]).toBeCloseTo(194 / 1024);
});

it('rejects bad indices, density, size and anchors before uploading GPU tables', () => {
  for (const index of [-1, 1.5, 4, NaN]) {
    expect(() => packSpriteTable(sprites, 1024, 256, { 1: { furniture: index, outline: 3 } }, anchors)).toThrow(/index/);
  }
  const pairs = { 1: { furniture: 2, outline: 3 } };
  expect(() => packSpriteTable(sprites.map((s, i) => i === 2 ? { ...s, pixel_density: 1 } : s), 1024, 256, pairs, anchors)).toThrow(/registration/);
  expect(() => packSpriteTable(sprites.map((s, i) => i === 2 ? { ...s, w: 190 } : s), 1024, 256, pairs, anchors)).toThrow(/registration/);
  expect(() => packSpriteTable(sprites, 1024, 256, pairs, { ...anchors, 2: [48, 115] })).toThrow(/registration/);
});
