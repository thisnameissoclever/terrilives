import { expect, it } from 'vitest';
import { packPresentationLayers } from '../src/render/visible-scene-layers.js';
import { packShelfLayers, shelfPresence } from '../src/render/shelf-sprites.js';

it('preserves all old layer references and packs three independently visible bodies', () => {
  const table = packPresentationLayers(9, { 7: [0, 1, -1, 2] }, { 8: [0, 1, 2, 3, 4] });
  expect(Array.from(table.slice(7 * 8, 8 * 8))).toEqual([1, 2, 0, 3, 0, 0, 0, 0]);
  expect(Array.from(table.slice(8 * 8))).toEqual([1, 2, 3, 4, 5, 0, 9, 0]);
  expect(() => packPresentationLayers(9, {}, { 8: [0, 1, 2, 99, 4] })).toThrow(/range/);
});

it('packs every six-bit shelf state and distinguishes exact zero pairs from absent mask storage', () => {
  const pairs: [number, number][] = Array.from({ length: 256 }, () => [-1, -1]);
  pairs[64 + 33] = [1, 2];
  const table = packShelfLayers(packPresentationLayers(5, {}), 5, { 0: { base: 4, rows: pairs } });
  expect(Array.from(table.slice(0, 8))).toEqual([0, 0, 0, 0, 0, 6, 5, 0]);
  expect(Array.from(table.slice((5 + 64 + 33) * 8, (5 + 64 + 33) * 8 + 2))).toEqual([2, 3]);
  expect(shelfPresence(1, new Uint32Array([0, 1]), new Uint32Array([0, 1]), new Uint32Array([0, 0xfedcba]))).toBe(0xfedcba);
  expect(shelfPresence(0, new Uint32Array([0]), new Uint32Array([0]), new Uint32Array(0))).toBe(0);
  expect(() => shelfPresence(0, new Uint32Array([1]), new Uint32Array([1]), new Uint32Array(0))).toThrow(/live/);
  pairs[1] = [-1, 2];
  expect(() => packShelfLayers(packPresentationLayers(5, {}), 5, { 0: { base: 4, rows: pairs } })).toThrow(/pair/);
});
