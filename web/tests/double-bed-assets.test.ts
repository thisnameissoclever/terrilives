import { describe, expect, it } from 'vitest';
import * as atlas from '../src/render/atlas.js';
import { packSpriteTable } from '../src/render/sprites.js';
import { pickSprite, type PickSource } from '../src/input.js';

describe('double-width bed views', () => {
  it.each(['', 'NW', 'SW', 'NE'])('keeps registration and transparent picking margins for %s', (suffix) => {
    const index = atlas.spriteIndex(`offlineDoubleBed${suffix}`);
    expect(index).toBe(1133 + ['', 'NW', 'SW', 'NE'].indexOf(suffix));
    expect([...packSpriteTable().slice(index * 8 + 4, index * 8 + 6)]).toEqual([160, 176]);
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
    expect(pickSprite(source, 0, -10, 0, 0)).toEqual({ entity: 17, isAgent: false });
    expect(pickSprite(source, 0, -130, 0, 0)).toBeNull();
    expect(pickSprite(source, 79, -10, 0, 0)).toBeNull();
    expect(atlas.SPRITE_PAIRS[index]).toBeUndefined();
    expect(atlas.INTERACTION_SPRITES[index]).toBeUndefined();
  });
});
