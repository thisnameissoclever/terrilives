import { SPRITES, SURFACE_LAYOUTS } from './atlas.js';

const coverage = new Map<number, Uint8Array>();

/** Retain decoded alpha only for the small surface dish props. */
export function setDishCoverage(sprite: number, alpha: Uint8Array): void {
  const rect = SPRITES[sprite];
  if (alpha.length !== rect.w * rect.h) throw new Error('Dish alpha dimensions differ from the atlas sprite');
  coverage.set(sprite, alpha);
}

export function loadDishCoverage(atlas: ImageBitmap, page = 0): void {
  const sprites = new Set<number>();
  for (const layout of Object.values(SURFACE_LAYOUTS)) {
    if (layout.kind !== 'stove') for (const sprite of layout.props.slice(0, 4)) sprites.add(sprite);
  }
  for (const sprite of sprites) {
    const rect = SPRITES[sprite];
    if ((rect.page ?? 0) !== page) continue;
    const canvas = new OffscreenCanvas(rect.w, rect.h);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Dish alpha requires a canvas image reader');
    context.drawImage(atlas, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
    const pixels = context.getImageData(0, 0, rect.w, rect.h).data;
    setDishCoverage(sprite, Uint8Array.from({ length: rect.w * rect.h }, (_, i) => pixels[i * 4 + 3]));
  }
}

/** Match the shader's linear alpha sampling and half-opaque discard threshold. */
export function sampleDishCoverage(sprite: number, x: number, y: number): number {
  const alpha = coverage.get(sprite);
  if (!alpha) return 0;
  const rect = SPRITES[sprite], density = rect.pixel_density ?? 1;
  x = Math.max(0, Math.min(rect.w - 1, x * density - .5));
  y = Math.max(0, Math.min(rect.h - 1, y * density - .5));
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(x0 + 1, rect.w - 1), y1 = Math.min(y0 + 1, rect.h - 1);
  const ax = x - x0, ay = y - y0;
  return ((alpha[y0 * rect.w + x0] * (1 - ax) + alpha[y0 * rect.w + x1] * ax) * (1 - ay)
    + (alpha[y1 * rect.w + x0] * (1 - ax) + alpha[y1 * rect.w + x1] * ax) * ay) / 255;
}
