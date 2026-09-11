import { SPRITES } from './atlas.js';

/** Atlas rectangles are physical texels; world-space dimensions are logical pixels. */
export function spriteWidth(index: number): number {
  const sprite = SPRITES[index];
  return sprite.w / (sprite.pixel_density ?? 1);
}

export function spriteHeight(index: number): number {
  const sprite = SPRITES[index];
  return sprite.h / (sprite.pixel_density ?? 1);
}
