import { SPRITES, SPRITE_ANCHORS, SPRITE_CONTENT_TOPS } from './atlas.js';

/** Scalar accessors keep drawing and picking aligned without frame allocations. */
export function spriteDrawOffsetX(index: number): number {
  const anchor = SPRITE_ANCHORS[index];
  return anchor === undefined ? 0 : SPRITES[index].w / 2 - anchor[0];
}

export function spriteDrawOffsetY(index: number): number {
  const anchor = SPRITE_ANCHORS[index];
  return anchor === undefined ? 0 : SPRITES[index].h - anchor[1];
}

export function spriteAnchorY(index: number): number {
  return SPRITE_ANCHORS[index]?.[1] ?? SPRITES[index].h;
}

/** Transparent canvas padding must not move the activity bubble. */
export function spriteContentLift(index: number): number {
  return spriteAnchorY(index) - (SPRITE_CONTENT_TOPS[index] ?? 0);
}
