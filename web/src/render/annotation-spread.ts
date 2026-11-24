/**
 * Keeps activity symbols and conversation bubbles readable on a crowded
 * screen (issue 360). After the frame is built, two bubbles that overlap move
 * apart sideways, and a bubble an on-screen control or another bubble covers
 * makes the smallest move, sideways, up or down, that clears it. No bubble
 * moves further than its own width from where it was drawn, so it stays
 * readable as its person's; one that cannot clear within that stays where it
 * is, partly covered.
 *
 * Runs every frame, so it allocates nothing once its buffers have grown to
 * the largest household seen ([D11]).
 */

import {SPRITES} from './atlas.js';
import {FLOATS_PER_INSTANCE, OFFSET_SCREEN_X, OFFSET_SCREEN_Y, OFFSET_SPRITE} from './instances.js';
import {TILE_HALF_HEIGHT} from './iso.js';

/**
 * On-screen controls in canvas pixels: `count` rectangles packed as left,
 * top, width, height in `rects`.
 */
export interface ControlRects {
  readonly rects: Float64Array;
  readonly count: number;
}

/** Space left between two bubbles, or a bubble and a control, in CSS pixels. */
const GAP_CSS = 4;
/** Passes of pairwise separation; three settle any group a household can form. */
const PASSES = 3;

const NO_CONTROLS: ControlRects = {rects: new Float64Array(0), count: 0};

export class AnnotationSpread {
  private capacity = 0;
  private x = new Float64Array(0);
  private y = new Float64Array(0);
  private x0 = new Float64Array(0);
  private y0 = new Float64Array(0);
  private half = new Float64Array(0);
  private height = new Float64Array(0);
  private order = new Int32Array(0);
  private count = 0;
  private gap = GAP_CSS;
  private viewWidth = 0;
  private viewHeight = 0;
  private controls = NO_CONTROLS;

  /**
   * Rewrites the screen position of the annotations in `start` to
   * `start + count`. The view is the canvas's size in pixels, and
   * `pixelRatio` is canvas pixels per CSS pixel.
   */
  spread(instances: Float32Array, start: number, count: number, scale: number,
    controls: ControlRects, viewWidth: number, viewHeight: number, pixelRatio = 1): void {
    if (count === 0) return;
    this.grow(count);
    this.count = count;
    this.gap = GAP_CSS * pixelRatio;
    this.viewWidth = viewWidth;
    this.viewHeight = viewHeight;
    this.controls = controls;
    const drop = TILE_HALF_HEIGHT * scale;
    for (let i = 0; i < count; i++) {
      const base = (start + i) * FLOATS_PER_INSTANCE;
      const sprite = SPRITES[instances[base + OFFSET_SPRITE]];
      const density = sprite?.pixel_density ?? 1;
      this.x[i] = this.x0[i] = instances[base + OFFSET_SCREEN_X];
      // The renderer draws a sprite's bottom half a tile below its position.
      this.y[i] = this.y0[i] = instances[base + OFFSET_SCREEN_Y] + drop;
      this.half[i] = ((sprite?.w ?? 0) / density) * scale / 2;
      this.height[i] = ((sprite?.h ?? 0) / density) * scale;
    }
    this.sortByHead();
    this.separate();
    for (let k = 0; k < count; k++) this.clear(this.order[k]);
    for (let i = 0; i < count; i++) {
      const base = (start + i) * FLOATS_PER_INSTANCE;
      instances[base + OFFSET_SCREEN_X] = this.x[i];
      instances[base + OFFSET_SCREEN_Y] = this.y[i] - drop;
    }
  }

  private grow(count: number): void {
    if (count <= this.capacity) return;
    const size = Math.max(count, this.capacity * 2, 8);
    this.capacity = size;
    this.x = new Float64Array(size);
    this.y = new Float64Array(size);
    this.x0 = new Float64Array(size);
    this.y0 = new Float64Array(size);
    this.half = new Float64Array(size);
    this.height = new Float64Array(size);
    this.order = new Int32Array(size);
  }

  /**
   * Whether box `a` goes left of box `b`: strictly by head position, by row
   * only when the heads are exactly level, so the order is total and each
   * bubble stays on its person's side.
   */
  private leftOf(a: number, b: number): boolean {
    return this.x0[a] < this.x0[b] || (this.x0[a] === this.x0[b] && a < b);
  }

  /** Orders boxes left to right by where their people are, with insertion sort: no comparator closure. */
  private sortByHead(): void {
    for (let i = 0; i < this.count; i++) {
      const box = this.order[i] = i;
      let j = i;
      while (j > 0 && this.leftOf(box, this.order[j - 1])) {
        this.order[j] = this.order[j - 1];
        j--;
      }
      this.order[j] = box;
    }
  }

  private reach(i: number): number {
    return this.half[i] * 2;
  }

  /**
   * Brings a box wholly on screen when its person's head is on screen, but
   * never beyond its reach; a bubble over someone off screen stays with them.
   */
  private tether(i: number): void {
    const half = this.half[i], x0 = this.x0[i];
    if (x0 >= 0 && x0 <= this.viewWidth && half * 2 <= this.viewWidth) {
      this.x[i] = Math.min(this.viewWidth - half, Math.max(half, this.x[i]));
    }
    this.x[i] = Math.min(x0 + this.reach(i), Math.max(x0 - this.reach(i), this.x[i]));
  }

  /**
   * How far box `i` may move in `direction` (-1 left, 1 right) before the
   * screen edge stops it. A box over someone off screen may move further off
   * without limit but not toward the screen at all, so separation never
   * brings their bubble into view.
   */
  private room(i: number, direction: -1 | 1): number {
    const x0 = this.x0[i];
    const offLeft = x0 < 0, offRight = x0 > this.viewWidth;
    if (offLeft || offRight) return (direction === 1) === offRight ? Infinity : 0;
    return direction === -1
      ? Math.max(0, this.x[i] - this.half[i])
      : Math.max(0, this.viewWidth - this.half[i] - this.x[i]);
  }

  private rowsMeet(a: number, b: number): boolean {
    return this.y[a] - this.height[a] < this.y[b] + this.gap && this.y[b] - this.height[b] < this.y[a] + this.gap;
  }

  /**
   * Pushes horizontally overlapping pairs apart in their fixed left-to-right
   * order. Each takes half the push unless the screen edge stops it, when the
   * other takes the rest; then each is held within its reach.
   */
  private separate(): void {
    const n = this.count;
    for (let i = 0; i < n; i++) this.tether(i);
    for (let pass = 0; pass < PASSES; pass++) {
      for (let r = 1; r < n; r++) {
        for (let l = 0; l < r; l++) {
          const left = this.order[l], right = this.order[r];
          if (!this.rowsMeet(left, right)) continue;
          const needed = this.half[left] + this.half[right] + this.gap - (this.x[right] - this.x[left]);
          if (needed <= 0) continue;
          const leftRoom = this.room(left, -1);
          const rightRoom = this.room(right, 1);
          const leftShare = Math.min(leftRoom, Math.max(needed / 2, needed - rightRoom));
          this.x[left] -= leftShare;
          this.x[right] += Math.min(rightRoom, needed - leftShare);
        }
      }
      for (let i = 0; i < n; i++) this.tether(i);
    }
  }

  /** Whether box `i` at (x, y) comes within the gap of the rectangle. */
  private meets(i: number, x: number, y: number, left: number, top: number, width: number, height: number): boolean {
    const gap = this.gap;
    return x - this.half[i] < left + width + gap && x + this.half[i] > left - gap
      && y - this.height[i] < top + height + gap && y > top - gap;
  }

  /** Whether box `i` fits at (x, y): on screen, clear of every control and every other box. */
  private fits(i: number, x: number, y: number): boolean {
    if (x - this.half[i] < 0 || x + this.half[i] > this.viewWidth || y - this.height[i] < 0 || y > this.viewHeight) {
      return false;
    }
    const rects = this.controls.rects;
    for (let c = 0; c < this.controls.count; c++) {
      const w = rects[c * 4 + 2], h = rects[c * 4 + 3];
      if (w > 0 && h > 0 && this.meets(i, x, y, rects[c * 4], rects[c * 4 + 1], w, h)) return false;
    }
    for (let o = 0; o < this.count; o++) {
      if (o === i) continue;
      if (this.meets(i, x, y, this.x[o] - this.half[o], this.y[o] - this.height[o], this.half[o] * 2, this.height[o])) {
        return false;
      }
    }
    return true;
  }

  private best = 0;
  private bestX = 0;
  private bestY = 0;

  /** Considers one candidate place for box `i`, keeping the nearest that fits within its reach. */
  private consider(i: number, x: number, y: number): void {
    if (Math.hypot(x - this.x0[i], y - this.y0[i]) > this.reach(i)) return;
    const distance = Math.hypot(x - this.x[i], y - this.y[i]);
    if (distance < this.best && this.fits(i, x, y)) {
      this.best = distance;
      this.bestX = x;
      this.bestY = y;
    }
  }

  /** The four places beside a rectangle that clear it, for box `i`. */
  private considerAround(i: number, left: number, top: number, width: number, height: number): void {
    if (!this.meets(i, this.x[i], this.y[i], left, top, width, height)) return;
    const gap = this.gap;
    this.consider(i, left - this.half[i] - gap, this.y[i]);
    this.consider(i, left + width + this.half[i] + gap, this.y[i]);
    this.consider(i, this.x[i], top - gap);
    this.consider(i, this.x[i], top + height + this.height[i] + gap);
  }

  /** Moves a covered box to the nearest clear place within its reach, if there is one. */
  private clear(i: number): void {
    if (this.fits(i, this.x[i], this.y[i])) return;
    this.best = Infinity;
    this.bestX = this.x[i];
    this.bestY = this.y[i];
    const rects = this.controls.rects;
    for (let c = 0; c < this.controls.count; c++) {
      this.considerAround(i, rects[c * 4], rects[c * 4 + 1], rects[c * 4 + 2], rects[c * 4 + 3]);
    }
    for (let o = 0; o < this.count; o++) {
      if (o !== i) this.considerAround(i, this.x[o] - this.half[o], this.y[o] - this.height[o], this.half[o] * 2, this.height[o]);
    }
    this.x[i] = this.bestX;
    this.y[i] = this.bestY;
  }
}
