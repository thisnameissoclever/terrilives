import { ATLAS_PAGE_FILES, SPRITES, SPRITE_ANCHORS, type AtlasSprite } from '../render/atlas.js';
import { spriteHeight, spriteWidth } from '../render/sprite-size.js';

// The store catalogue's pictures - rule 2 of
// docs/specs/2026-10-17-store-catalogue.md. Each card's canvas gets the
// item's base-facing sprite as the game draws it, cropped to its visible
// pixels, with the foreground layer aligned by the sprites' anchors. The
// recorded content bounds are not used for the crop: some seat sprites
// record the whole canvas so a seated person fits, which would shrink
// their pictures. The atlas pages are large, so they are fetched one at a
// time; while a page is held, each layer on it is cut down to its visible
// pixels, and the page is released before the next is fetched. The cards
// are drawn from those small cut-outs once every page has been read.

export interface PreviewCard {
  readonly canvas: HTMLCanvasElement;
  /** The background sprite's atlas index. */
  readonly sprite: number;
  /** The foreground sprite's atlas index, if the object has one. */
  readonly foreground: number | null;
}

/** A layer cut out of its atlas page down to its visible pixels. */
export interface LayerCrop {
  readonly image: CanvasImageSource;
  /** Where the visible pixels sit inside the sprite, `[left, top, right, bottom]` in logical pixels. */
  readonly bounds: readonly [number, number, number, number];
  close(): void;
}

/** Cuts a sprite's visible pixels out of its atlas page; null when it has none. */
export type CropLayer = (page: ImageBitmap, sprite: AtlasSprite) => Promise<LayerCrop | null>;

/**
 * The box `[left, top, right, bottom]` of the pixels with any alpha in an
 * RGBA buffer `width` pixels wide, right and bottom exclusive, or null when
 * every pixel is transparent.
 */
export function visibleBounds(rgba: ArrayLike<number>, width: number, height: number): [number, number, number, number] | null {
  let left = width;
  let top = height;
  let right = 0;
  let bottom = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] === 0) continue;
      if (x < left) left = x;
      if (x + 1 > right) right = x + 1;
      if (y < top) top = y;
      if (y + 1 > bottom) bottom = y + 1;
    }
  }
  return right > left ? [left, top, right, bottom] : null;
}

/** A sprite's anchor in logical pixels; the renderer's default is its bottom center. */
function anchor(index: number): readonly [number, number] {
  return SPRITE_ANCHORS[index] ?? [spriteWidth(index) / 2, spriteHeight(index)];
}

/** Where `other` sits relative to `base`, in logical pixels, by their anchors. */
function offset(base: number, other: number): [number, number] {
  const anchorBase = anchor(base);
  const anchorOther = anchor(other);
  return [anchorBase[0] - anchorOther[0], anchorBase[1] - anchorOther[1]];
}

/** Cuts the sprite's visible pixels out of the page through a scratch canvas. */
async function cropLayer(page: ImageBitmap, sprite: AtlasSprite): Promise<LayerCrop | null> {
  const density = sprite.pixel_density ?? 1;
  const scratch = document.createElement('canvas');
  scratch.width = sprite.w;
  scratch.height = sprite.h;
  const context = scratch.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('No 2D canvas for a catalogue picture');
  context.drawImage(page, sprite.x, sprite.y, sprite.w, sprite.h, 0, 0, sprite.w, sprite.h);
  const box = visibleBounds(context.getImageData(0, 0, sprite.w, sprite.h).data, sprite.w, sprite.h);
  if (!box) return null;
  const [left, top, right, bottom] = box;
  const image = await createImageBitmap(scratch, left, top, right - left, bottom - top);
  return {
    image,
    bounds: [left / density, top / density, right / density, bottom / density],
    close: () => image.close(),
  };
}

/** Fetches and decodes one atlas page; the caller closes the bitmap. */
async function loadPage(page: number): Promise<ImageBitmap> {
  const file = ATLAS_PAGE_FILES[page];
  if (!file) throw new Error(`No atlas page ${page}`);
  const response = await fetch(new URL(file, new URL(import.meta.env.BASE_URL, location.href)));
  if (!response.ok) throw new Error(`Atlas page ${page} returned ${response.status}`);
  return createImageBitmap(await response.blob());
}

/**
 * Draws one card from its layers' cut-outs, base first, scaled to fit the
 * canvas around the visible pixels of both layers.
 */
function drawCard(card: PreviewCard, crops: ReadonlyMap<number, LayerCrop | null>): void {
  const layers: { crop: LayerCrop; shift: readonly [number, number] }[] = [];
  const base = crops.get(card.sprite);
  if (base) layers.push({ crop: base, shift: [0, 0] });
  const front = card.foreground === null ? null : crops.get(card.foreground);
  if (front && card.foreground !== null) layers.push({ crop: front, shift: offset(card.sprite, card.foreground) });
  if (layers.length === 0) return;
  const box = layers.reduce((union, { crop, shift }) => [
    Math.min(union[0], crop.bounds[0] + shift[0]), Math.min(union[1], crop.bounds[1] + shift[1]),
    Math.max(union[2], crop.bounds[2] + shift[0]), Math.max(union[3], crop.bounds[3] + shift[1]),
  ], [Infinity, Infinity, -Infinity, -Infinity]);
  const context = card.canvas.getContext('2d');
  if (!context) return;
  const { width, height } = card.canvas;
  const scale = Math.min(width / (box[2] - box[0]), height / (box[3] - box[1]));
  const originX = (width - (box[2] - box[0]) * scale) / 2;
  const originY = (height - (box[3] - box[1]) * scale) / 2;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  for (const { crop, shift } of layers) {
    const [left, top, right, bottom] = crop.bounds;
    context.drawImage(crop.image,
      originX + (left + shift[0] - box[0]) * scale, originY + (top + shift[1] - box[1]) * scale,
      (right - left) * scale, (bottom - top) * scale);
  }
}

/**
 * Draws every card's picture, smoothed as the game filters its sprites.
 * A page that fails to load, a layer that fails to be cut out, or a card
 * that fails to draw leaves each card it touches blank, never half drawn;
 * the other cards are still drawn and the first error is reported last.
 */
export async function drawCataloguePreviews(cards: readonly PreviewCard[],
  load: (page: number) => Promise<ImageBitmap> = loadPage, crop: CropLayer = cropLayer): Promise<void> {
  const byPage = new Map<number, Set<number>>();
  for (const card of cards) {
    for (const index of [card.sprite, card.foreground]) {
      if (index === null || !SPRITES[index]) continue;
      const page = SPRITES[index].page ?? 0;
      byPage.set(page, (byPage.get(page) ?? new Set()).add(index));
    }
  }
  const crops = new Map<number, LayerCrop | null>();
  const unread = new Set<number>();
  let failure: unknown = null;
  try {
    for (const [page, indexes] of [...byPage.entries()].sort((a, b) => a[0] - b[0])) {
      let bitmap: ImageBitmap;
      try {
        bitmap = await load(page);
      } catch (error) {
        failure ??= error;
        for (const index of indexes) unread.add(index);
        continue;
      }
      try {
        for (const index of indexes) {
          try {
            crops.set(index, await crop(bitmap, SPRITES[index]));
          } catch (error) {
            failure ??= error;
            unread.add(index);
          }
        }
      } finally {
        bitmap.close();
      }
    }
    for (const card of cards) {
      if (!SPRITES[card.sprite] || unread.has(card.sprite)
        || (card.foreground !== null && unread.has(card.foreground))) continue;
      try {
        drawCard(card, crops);
      } catch (error) {
        failure ??= error;
        card.canvas.getContext('2d')?.clearRect(0, 0, card.canvas.width, card.canvas.height);
      }
    }
  } finally {
    for (const layer of crops.values()) layer?.close();
  }
  if (failure !== null) throw failure;
}
