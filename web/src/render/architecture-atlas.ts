import type { AtlasSprite } from './atlas.js';

/** Separate opt-in atlas; historical sprite records and pixels stay fixed. */
export interface ArchitectureAtlas {
  readonly color: ImageBitmap;
  readonly width: number;
  readonly height: number;
  /** IEEE 754 binary16, local game X + Y, one value per color texel. */
  readonly depth: Uint16Array<ArrayBuffer>;
  readonly sprites: readonly AtlasSprite[];
}

export function validateArchitectureAtlas(atlas: ArchitectureAtlas): void {
  const { width, height, color, depth, sprites } = atlas;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width > 8192 || height > 8192 || color.width !== width || color.height !== height ||
      depth.length !== width * height || sprites.length === 0) {
    throw new Error('Architecture color, depth and dimensions must agree');
  }
  const names = new Set<string>();
  for (const sprite of sprites) {
    const density = sprite.pixel_density ?? 1;
    if (names.has(sprite.name) || !sprite.name || !Number.isFinite(density) || density <= 0 ||
        ![sprite.x, sprite.y, sprite.w, sprite.h].every(Number.isInteger) ||
        sprite.x < 0 || sprite.y < 0 || sprite.w <= 0 || sprite.h <= 0 ||
        sprite.x + sprite.w > width || sprite.y + sprite.h > height) {
      throw new Error('Architecture sprite rectangle or name is invalid');
    }
    names.add(sprite.name);
  }
  // Reject NaN and infinity before they reach frag_depth. Signed finite values
  // are intentional: the back half of a centered wall has negative X + Y.
  for (const bits of depth) {
    if ((bits & 0x7c00) === 0x7c00) throw new Error('Architecture depth must be finite');
  }
}
