import { describe, expect, it } from 'vitest';
import * as renderer from '../src/render/sprites.js';

describe('paged sprite storage and registered contributions', () => {
  it('packs the page separately from unchanged size and pair fields', () => {
    const sprites = [{ name: 'one', x: 2, y: 4, w: 8, h: 10, pixel_density: 2, page: 1 }];
    const table = renderer.packSpriteTable(sprites, 16, 16, {}, {});
    expect(Array.from(table)).toEqual([.125, .25, .625, .875, 4, 5, 0, 0, 0, 0, 1, 0]);
  });

  it('retains layer offsets without interpreting them as legacy pair indices', () => {
    const sprites = [{ name: 'body', x: 0, y: 0, w: 70, h: 31, pixel_density: 2, page: 2 }];
    const table = renderer.packSpriteTable(sprites, 2048, 2048, {}, {}, { 0: [17.5, 79] });
    expect(Array.from(table.slice(4))).toEqual([35, 15.5, 0, 0, 17.5, 79, 2, 1]);
  });

  it('rejects bad page identities and real array-layer limits', () => {
    for (const page of [-1, 1.5, NaN, 99999]) {
      expect(() => renderer.packSpriteTable([{ name: 'x', x: 0, y: 0, w: 1, h: 1, page }], 16, 16, {}, {})).toThrow(/page/);
    }
    expect(typeof renderer.validateAtlasPageCount).toBe('function');
    expect(() => renderer.validateAtlasPageCount(17, 16)).toThrow(/array.*limit/);
    expect(() => renderer.validateAtlasPageCount(17, 256)).not.toThrow();
    expect(() => renderer.validateAtlasPageCount(17, NaN)).toThrow(/array.*limit/);
  });

  it('rejects trim metadata shared with any legacy pair role', () => {
    const sprites = [0, 1, 2].map(index => ({ name: String(index), x: 0, y: 0, w: 8, h: 8 }));
    const anchors = { 0: [4, 4] as const, 1: [4, 4] as const, 2: [4, 4] as const };
    for (const index of [0, 1, 2]) {
      expect(() => renderer.packSpriteTable(sprites, 16, 16,
        { 0: { furniture: 1, outline: 2 } }, anchors, { [index]: [1, 1] })).toThrow(/trim.*pair/);
    }
  });
});
