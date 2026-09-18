import { describe, expect, it } from 'vitest';
import * as atlas from '../src/render/atlas.js';
import { packSpriteTable } from '../src/render/sprites.js';
import { pickSprite, type PickSource } from '../src/input.js';

describe('registered two-tile bathtub views', () => {
  it.each(['', 'NW', 'SW', 'NE'])('keeps scale and transparent-margin picking for %s', (suffix) => {
    const index = atlas.spriteIndex(`offlineBathtub${suffix}`);
    expect(index).toBe(1121 + ['', 'NW', 'SW', 'NE'].indexOf(suffix));
    const table = packSpriteTable();
    expect([...table.slice(index * 8 + 4, index * 8 + 6)]).toEqual([160, 176]);
    expect(atlas.SPRITES[index].pixel_density).toBe(2);
    expect(atlas.SPRITE_ANCHORS[index][0]).toBeCloseTo(80, 4);
    expect(atlas.SPRITE_ANCHORS[index][1]).toBeCloseTo(144.000437, 4);
    const source: PickSource = {
      count: 1,
      positions: () => new Float32Array([0, 0]),
      kinds: () => new Uint32Array([1]),
      ids: () => new Uint32Array([17]),
      sprites: () => new Uint32Array([index]),
      activities: () => new Uint32Array([0]),
    };
    // Every rotated tub covers its origin tile, but not the top canvas margin.
    expect(pickSprite(source, 0, -10, 0, 0)).toEqual({ entity: 17, isAgent: false });
    expect(pickSprite(source, 0, -110, 0, 0)).toBeNull();
    expect(pickSprite(source, 79, -10, 0, 0)).toBeNull();
    expect(atlas.SPRITE_PAIRS[index]).toBeUndefined();
    expect(atlas.INTERACTION_SPRITES[index]).toBeUndefined();
  });
});
