import { SPRITE_ANCHORS, SPRITE_CONTENT_BOUNDS, SPRITE_CONTENT_TOPS } from './atlas.js';
import { spriteWidth, spriteHeight } from './sprite-size.js';

/** Scalar accessors keep drawing and picking aligned without frame allocations. */
export function spriteDrawOffsetX(index: number): number {
  const anchor = SPRITE_ANCHORS[index];
  return anchor === undefined ? 0 : spriteWidth(index) / 2 - anchor[0];
}

export function spriteDrawOffsetY(index: number): number {
  const anchor = SPRITE_ANCHORS[index];
  return anchor === undefined ? 0 : spriteHeight(index) - anchor[1];
}

export function spriteAnchorY(index: number): number {
  return SPRITE_ANCHORS[index]?.[1] ?? spriteHeight(index);
}

/** Transparent canvas padding must not move the activity bubble. */
export function spriteContentLift(index: number): number {
  return spriteAnchorY(index) - (SPRITE_CONTENT_TOPS[index] ?? 0);
}

/** Camera headroom follows visible art, not transparent authoring padding. */
export function spriteFramingHeight(index: number): number {
  const top = SPRITE_CONTENT_BOUNDS[index]?.[1] ?? SPRITE_CONTENT_TOPS[index] ?? 0;
  return spriteAnchorY(index) - top;
}
