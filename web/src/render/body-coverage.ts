import { RIGGED_SIM_VARIANTS, SPRITES } from './atlas.js';

interface BodyCoverage {
  readonly opaque: Uint8Array;
  readonly partialPixels: Uint32Array;
  readonly partialAlpha: Uint8Array;
}

const coverage = new Map<number, BodyCoverage>();

/** Keep solid pixels as bits and retain exact alpha for antialiased edges. */
export function setBodyCoverage(sprite: number, alpha: Uint8Array): void {
  const rect = SPRITES[sprite];
  if (!rect || alpha.length !== rect.w * rect.h) {
    throw new Error('Body alpha dimensions differ from the atlas sprite');
  }
  const opaque = new Uint8Array(Math.ceil(alpha.length / 8));
  let partialCount = 0;
  for (let i = 0; i < alpha.length; i++) {
    if (alpha[i] === 255) opaque[i >>> 3] |= 1 << (i & 7);
    else if (alpha[i] > 0) partialCount++;
  }
  const partialPixels = new Uint32Array(partialCount);
  const partialAlpha = new Uint8Array(partialCount);
  let at = 0;
  for (let i = 0; i < alpha.length; i++) {
    if (alpha[i] > 0 && alpha[i] < 255) {
      partialPixels[at] = i;
      partialAlpha[at++] = alpha[i];
    }
  }
  coverage.set(sprite, { opaque, partialPixels, partialAlpha });
}

/** Decode the renderer's body frames once; do not retain the full atlas bitmap. */
export function loadBodyCoverage(atlas: ImageBitmap, page = 0): void {
  const sprites = new Set<number>();
  for (const variant of Object.values(RIGGED_SIM_VARIANTS)) {
    for (const clip of Object.values(variant)) {
      for (const facing of clip.frames) for (const sprite of facing) sprites.add(sprite);
    }
  }
  const canvas = new OffscreenCanvas(1, 1);
  for (const sprite of sprites) {
    const rect = SPRITES[sprite];
    if ((rect.page ?? 0) !== page) continue;
    canvas.width = rect.w;
    canvas.height = rect.h;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Body alpha requires a canvas image reader');
    context.drawImage(atlas, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
    const pixels = context.getImageData(0, 0, rect.w, rect.h).data;
    const alpha = new Uint8Array(rect.w * rect.h);
    for (let i = 0; i < alpha.length; i++) alpha[i] = pixels[i * 4 + 3];
    setBodyCoverage(sprite, alpha);
  }
}

function alphaAt(mask: BodyCoverage, pixel: number): number {
  if ((mask.opaque[pixel >>> 3] & (1 << (pixel & 7))) !== 0) return 255;
  let low = 0, high = mask.partialPixels.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (mask.partialPixels[middle] < pixel) low = middle + 1;
    else high = middle;
  }
  return mask.partialPixels[low] === pixel ? mask.partialAlpha[low] : 0;
}

/** Use the same linear sampling and half-opaque threshold as the body shader. */
export function sampleBodyCoverage(sprite: number, x: number, y: number): number | null {
  const mask = coverage.get(sprite);
  if (!mask) return null;
  const rect = SPRITES[sprite], density = rect.pixel_density ?? 1;
  x = Math.max(0, Math.min(rect.w - 1, x * density - .5));
  y = Math.max(0, Math.min(rect.h - 1, y * density - .5));
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, rect.w - 1), y1 = Math.min(y0 + 1, rect.h - 1);
  const ax = x - x0, ay = y - y0;
  return ((alphaAt(mask, y0 * rect.w + x0) * (1 - ax) + alphaAt(mask, y0 * rect.w + x1) * ax) * (1 - ay)
    + (alphaAt(mask, y1 * rect.w + x0) * (1 - ax) + alphaAt(mask, y1 * rect.w + x1) * ax) * ay) / 255;
}
