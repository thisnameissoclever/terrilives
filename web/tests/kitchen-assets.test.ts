import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import * as atlas from '../src/render/atlas.js';
import { TILE_HALF_HEIGHT } from '../src/render/iso.js';
import { packSpriteTable } from '../src/render/sprites.js';
import { pickSprite, type PickSource } from '../src/input.js';

describe('reviewed kitchen sprites', () => {
  it('registers four stove facings without selecting the empty upper canvas', () => {
    const table = packSpriteTable();
    for (const [offset, suffix] of ['', 'NW', 'SW', 'NE'].entries()) {
      const index = atlas.spriteIndex(`offlineStove${suffix}`);
      expect(index).toBe(1093 + offset);
      expect([...table.slice(index * 8 + 4, index * 8 + 6)]).toEqual([96, 120]);
      expect(atlas.SPRITES[index].pixel_density).toBe(2);
      expect(atlas.SPRITE_ANCHORS[index][1]).toBeCloseTo(116.000437, 4);
      const source: PickSource = {
        count: 1,
        positions: () => new Float32Array([0, 0]),
        kinds: () => new Uint32Array([1]),
        ids: () => new Uint32Array([8]),
        sprites: () => new Uint32Array([index]),
        activities: () => new Uint32Array([0]),
      };
      expect(pickSprite(source, 0, -20, 0, 0)).toEqual({ entity: 8, isAgent: false });
      expect(pickSprite(source, 0, -85, 0, 0)).toBeNull();
      expect(pickSprite(source, -47, -20, 0, 0)).toBeNull();
      expect(atlas.SPRITE_PAIRS[index]).toBeUndefined();
      expect(atlas.INTERACTION_SPRITES[index]).toBeUndefined();
    }
  });
  it('does not select the refrigerator through its transparent canvas margins', () => {
    for (const suffix of ['', 'NW', 'SW', 'NE']) {
      const source: PickSource = {
        count: 1,
        positions: () => new Float32Array([0, 0]),
        kinds: () => new Uint32Array([1]),
        ids: () => new Uint32Array([7]),
        sprites: () => new Uint32Array([atlas.spriteIndex(`offlineFridge${suffix}`)]),
        activities: () => new Uint32Array([0]),
      };
      expect(pickSprite(source, 0, -40, 0, 0)).toEqual({ entity: 7, isAgent: false });
      expect(pickSprite(source, -42, -40, 0, 0)).toBeNull();
      expect(pickSprite(source, 0, -93, 0, 0)).toBeNull();
    }
  });
  it('appends four dense fridge facings with the world origin on the tile centre', () => {
    const table = packSpriteTable();
    for (const [offset, suffix] of ['', 'NW', 'SW', 'NE'].entries()) {
      const index = atlas.spriteIndex(`offlineFridge${suffix}`);
      expect(index).toBe(1089 + offset);
      const sprite = atlas.SPRITES[index];
      expect([sprite.w, sprite.h, sprite.pixel_density]).toEqual([192, 240, 2]);
      expect([...table.slice(index * 8 + 4, index * 8 + 6)]).toEqual([96, 120]);
      const anchor = atlas.SPRITE_ANCHORS[index];
      // frame.ts contributes height-anchorY; the shader contributes 21-height.
      // The source origin at logical y=95 must consequently land on world y=0.
      expect(120 - anchor[1] + TILE_HALF_HEIGHT - 120 + 95.000437).toBeCloseTo(0, 5);
      expect(anchor[0]).toBeCloseTo(48, 4);
      expect(atlas.SPRITE_PAIRS[index]).toBeUndefined();
      expect(atlas.INTERACTION_SPRITES[index]).toBeUndefined();
    }
  });

  it('preserves all preceding Sim, attachment and animation registration', () => {
    const keys = ['SPRITE_ANCHORS', 'SPRITE_CONTENT_TOPS', 'SPRITE_CONTENT_BOUNDS',
      'SPRITE_PAIRS', 'INTERACTION_SPRITES', 'SPRITE_HAND_ANCHORS',
      'SPRITE_HAND_FOREGROUND', 'RIGGED_SIM_CLIPS', 'RIGGED_SIM_VARIANTS'] as const;
    const data = keys.map((key) => [key, key.startsWith('RIGGED_') ? atlas[key] :
      Object.fromEntries(Object.entries(atlas[key]).filter(([index]) => Number(index) < 1089))]);
    expect(createHash('sha256').update(JSON.stringify(data)).digest('hex')).toBe(
      '9e367e13fb7cabb6a4ca94f0d6f67c43f7be8373ce37f294286e33257c0bb62a',
    );
  });
});
