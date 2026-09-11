import { describe, expect, it } from 'vitest';
import { packSpriteTable, validateAtlasDimensions, loadAtlasTexture } from '../src/render/sprites.js';
import { SPRITES, ATLAS_WIDTH } from '../src/render/atlas.js';

describe('texture density boundary', () => {
  it('rejects unsupported devices before fetching or allocating the atlas', async () => {
    const device = { limits: { maxTextureDimension2D: 1024 } } as GPUDevice;
    await expect(loadAtlasTexture(device)).rejects.toThrow(/texture dimension limit 1024/);
  });
  it('packs physical UVs but logical GPU quad dimensions', () => {
    const table = packSpriteTable();
    const index = SPRITES.findIndex(sprite => sprite.pixel_density === 2);
    expect(index).toBeGreaterThanOrEqual(0);
    const sprite = SPRITES[index];
    expect(table[index * 8 + 4]).toBe(sprite.w / 2);
    expect(table[index * 8 + 5]).toBe(sprite.h / 2);
    expect(table[index * 8 + 2]).toBeCloseTo((sprite.x + sprite.w) / ATLAS_WIDTH);
  });

  it('rejects either dimension above baseline or actual device limit', () => {
    expect(() => validateAtlasDimensions(2048, 7000, 8192)).not.toThrow();
    for (const dimensions of [[8193, 1, 16384], [1, 8193, 16384], [4097, 1, 4096], [1, 4097, 4096]]) {
      expect(() => validateAtlasDimensions(...dimensions as [number, number, number])).toThrow(/texture dimension/);
    }
  });
});
