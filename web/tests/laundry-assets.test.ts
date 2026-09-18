import { describe, expect, it } from 'vitest';
import * as atlas from '../src/render/atlas.js';
import { packSpriteTable } from '../src/render/sprites.js';
import { pickSprite, type PickSource } from '../src/input.js';

describe('reviewed laundry facings', () => {
  it.each(['', 'NW', 'SW', 'NE'])('registers and picks facing %s', (suffix) => {
    const index = atlas.spriteIndex(`offlineLaundry${suffix}`);
    expect(index).toBe(1117 + ['', 'NW', 'SW', 'NE'].indexOf(suffix));
    const table = packSpriteTable();
    expect([...table.slice(index * 8 + 4, index * 8 + 6)]).toEqual([96, 120]);
    expect(atlas.SPRITES[index].pixel_density).toBe(2);
    expect(atlas.SPRITE_ANCHORS[index][1]).toBeCloseTo(116.000437, 4);
    const source: PickSource = {
      count: 1,
      positions: () => new Float32Array([0, 0]),
      kinds: () => new Uint32Array([1]),
      ids: () => new Uint32Array([16]),
      sprites: () => new Uint32Array([index]),
      activities: () => new Uint32Array([0]),
    };
    expect(pickSprite(source, 0, -20, 0, 0)).toEqual({ entity: 16, isAgent: false });
    expect(pickSprite(source, 0, -90, 0, 0)).toBeNull();
    expect(pickSprite(source, -40, -20, 0, 0)).toBeNull();
    expect(atlas.SPRITE_PAIRS[index]).toBeUndefined();
    expect(atlas.INTERACTION_SPRITES[index]).toBeUndefined();
  });
});
