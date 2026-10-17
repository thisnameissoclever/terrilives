import { ATLAS_PAGE_FILES, SPRITES, SPRITE_ANCHORS, SPRITE_CONTENT_BOUNDS } from '../render/atlas.js';
import { spriteHeight, spriteWidth } from '../render/sprite-size.js';

// The store catalogue's pictures - rule 2 of
// docs/specs/2026-10-17-store-catalogue.md. Each card's canvas gets the
// item's base-facing sprite as the game draws it, cropped to its content
// bounds, with the foreground layer aligned by the sprites' anchors. The
// atlas pages are large, so they are fetched one at a time, decoded once
// and released after every card on them is drawn.

export interface PreviewCard {
  readonly canvas: HTMLCanvasElement;
  /** The background sprite's atlas index. */
  readonly sprite: number;
  /** The foreground sprite's atlas index, if the object has one. */
  readonly foreground: number | null;
}

interface Layer {
  readonly index: number;
  /** The logical content box inside the sprite. */
  readonly bounds: readonly [number, number, number, number];
  readonly density: number;
}

function layer(index: number): Layer | null {
  const sprite = SPRITES[index];
  if (!sprite) return null;
  const density = sprite.pixel_density ?? 1;
  const bounds = SPRITE_CONTENT_BOUNDS[index] ?? [0, 0, sprite.w / density, sprite.h / density];
  return { index, bounds, density };
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

/**
 * The union box of the card's layers in the base sprite's logical space:
 * `[left, top, right, bottom]`.
 */
export function previewBox(card: Pick<PreviewCard, 'sprite' | 'foreground'>): [number, number, number, number] | null {
  const base = layer(card.sprite);
  if (!base) return null;
  let [left, top, right, bottom] = base.bounds;
  if (card.foreground !== null) {
    const front = layer(card.foreground);
    if (front) {
      const [dx, dy] = offset(card.sprite, card.foreground);
      left = Math.min(left, front.bounds[0] + dx);
      top = Math.min(top, front.bounds[1] + dy);
      right = Math.max(right, front.bounds[2] + dx);
      bottom = Math.max(bottom, front.bounds[3] + dy);
    }
  }
  return [left, top, right, bottom];
}

function drawLayer(context: CanvasRenderingContext2D, bitmap: ImageBitmap, item: Layer,
  shift: readonly [number, number], box: readonly [number, number, number, number], canvas: HTMLCanvasElement,
  behind: boolean): void {
  const sprite = SPRITES[item.index];
  const [x0, y0, x1, y1] = item.bounds;
  const boxWidth = box[2] - box[0];
  const boxHeight = box[3] - box[1];
  const scale = Math.min(canvas.width / boxWidth, canvas.height / boxHeight);
  const originX = (canvas.width - boxWidth * scale) / 2;
  const originY = (canvas.height - boxHeight * scale) / 2;
  // A base whose foreground was drawn from an earlier page goes behind it.
  context.globalCompositeOperation = behind ? 'destination-over' : 'source-over';
  context.drawImage(bitmap,
    sprite.x + x0 * item.density, sprite.y + y0 * item.density,
    (x1 - x0) * item.density, (y1 - y0) * item.density,
    originX + (x0 + shift[0] - box[0]) * scale, originY + (y0 + shift[1] - box[1]) * scale,
    (x1 - x0) * scale, (y1 - y0) * scale);
  context.globalCompositeOperation = 'source-over';
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
 * Draws every card's picture, smoothed as the game filters its sprites.
 * Cards whose layers sit on two pages are drawn in two passes, the base
 * always behind the foreground; a page that fails to load is skipped and
 * its cards keep whatever they held, and the error is reported once the
 * rest are drawn.
 */
export async function drawCataloguePreviews(cards: readonly PreviewCard[],
  load: (page: number) => Promise<ImageBitmap> = loadPage): Promise<void> {
  const passes = new Map<number, { card: PreviewCard; item: Layer; shift: [number, number]; box: [number, number, number, number]; foreground: boolean }[]>();
  for (const card of cards) {
    const box = previewBox(card);
    const base = layer(card.sprite);
    if (!box || !base) continue;
    const layers: { item: Layer; shift: [number, number]; foreground: boolean }[] = [{ item: base, shift: [0, 0], foreground: false }];
    if (card.foreground !== null) {
      const front = layer(card.foreground);
      if (front) layers.push({ item: front, shift: offset(card.sprite, card.foreground), foreground: true });
    }
    for (const { item, shift, foreground } of layers) {
      const page = SPRITES[item.index].page ?? 0;
      const list = passes.get(page) ?? [];
      list.push({ card, item, shift, box, foreground });
      passes.set(page, list);
    }
  }
  const foregroundDrawn = new Set<PreviewCard>();
  let failure: unknown = null;
  for (const [page, draws] of [...passes.entries()].sort((a, b) => a[0] - b[0])) {
    let bitmap: ImageBitmap;
    try {
      bitmap = await load(page);
    } catch (error) {
      failure ??= error;
      continue;
    }
    try {
      // Each card lists its base before its foreground, so within one page
      // the base is drawn first.
      for (const { card, item, shift, box, foreground } of draws) {
        const context = card.canvas.getContext('2d');
        if (!context) continue;
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        drawLayer(context, bitmap, item, shift, box, card.canvas, !foreground && foregroundDrawn.has(card));
        if (foreground) foregroundDrawn.add(card);
      }
    } finally {
      bitmap.close();
    }
  }
  if (failure !== null) throw failure;
}
