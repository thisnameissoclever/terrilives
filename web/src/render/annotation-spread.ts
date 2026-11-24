/**
 * Keeps activity symbols and conversation bubbles readable on a crowded
 * screen (issue 360). After the frame is built, two bubbles that overlap move
 * apart sideways, and a bubble an on-screen control covers makes the
 * smallest move, sideways, up or down, that clears it. No bubble moves
 * further than its own width from where it was drawn, so it stays readable
 * as its person's; one that cannot clear within that stays where it is.
 */

import {SPRITES} from './atlas.js';
import {FLOATS_PER_INSTANCE, OFFSET_SCREEN_X, OFFSET_SCREEN_Y, OFFSET_SPRITE} from './instances.js';
import {TILE_HALF_HEIGHT} from './iso.js';

/** A screen rectangle in canvas pixels. */
export interface ScreenRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Space left between two bubbles, or a bubble and a control, in canvas pixels. */
const GAP = 4;
/** Passes of pairwise separation; three settle any group a household can form. */
const PASSES = 3;

/**
 * One annotation's drawn box: centred on x, hanging `height` up from its
 * drawn bottom at y. The renderer draws a sprite's bottom half a tile below
 * its instance position, `drop` here.
 */
interface Box {
  index: number; x: number; y: number; half: number; height: number; drop: number;
  /** Where the frame drew it, over its person's head. */
  readonly x0: number; readonly y0: number;
}

function boxOf(instances: Float32Array, index: number, scale: number): Box {
  const base = index * FLOATS_PER_INSTANCE;
  const sprite = SPRITES[instances[base + OFFSET_SPRITE]];
  const density = sprite?.pixel_density ?? 1;
  const drop = TILE_HALF_HEIGHT * scale;
  const x = instances[base + OFFSET_SCREEN_X];
  const y = instances[base + OFFSET_SCREEN_Y] + drop;
  return {
    index, x, y, x0: x, y0: y,
    half: ((sprite?.w ?? 0) / density) * scale / 2,
    height: ((sprite?.h ?? 0) / density) * scale,
    drop,
  };
}

/** How far a box may move in all from where it was drawn: its own width. */
function reach(box: Box): number {
  return box.half * 2;
}

/**
 * Brings a box on screen, but never beyond its reach of where it was drawn:
 * a bubble over someone well off screen stays off screen with them.
 */
function tethered(box: Box, viewWidth: number): void {
  onScreen(box, viewWidth);
  box.x = Math.min(box.x0 + reach(box), Math.max(box.x0 - reach(box), box.x));
}

/** Whether a box at (x, y) and a rectangle come within GAP of each other. */
function touches(box: Box, x: number, y: number, rect: ScreenRect): boolean {
  return x - box.half < rect.left + rect.width + GAP && x + box.half > rect.left - GAP
    && y - box.height < rect.top + rect.height + GAP && y > rect.top - GAP;
}

/** Keeps a box wholly on screen sideways, so one over a person at the edge is not cut off. */
function onScreen(box: Box, viewWidth: number): void {
  if (box.half * 2 <= viewWidth) box.x = Math.min(viewWidth - box.half, Math.max(box.half, box.x));
}

/**
 * Pushes horizontally overlapping pairs apart, each moving half the overlap.
 * After every pass each box is held within its reach and on screen, so a box
 * held at the edge pushes its neighbour the rest of the way on the next
 * pass. Where the reach runs out, the pair keeps some overlap rather than
 * drift away from its people.
 */
function separate(boxes: Box[], viewWidth: number): void {
  for (const box of boxes) tethered(box, viewWidth);
  for (let pass = 0; pass < PASSES; pass++) {
    boxes.sort((a, b) => a.x - b.x || a.index - b.index);
    for (let i = 1; i < boxes.length; i++) {
      for (let j = 0; j < i; j++) {
        const left = boxes[j], right = boxes[i];
        if (left.y - left.height >= right.y + GAP || right.y - right.height >= left.y + GAP) continue;
        const needed = left.half + right.half + GAP - (right.x - left.x);
        if (needed <= 0) continue;
        // Each takes half, unless the screen edge stops it; then the other takes the rest.
        const leftRoom = Math.max(0, left.x - left.half);
        const rightRoom = Math.max(0, viewWidth - right.half - right.x);
        const leftShare = Math.min(leftRoom, Math.max(needed / 2, needed - rightRoom));
        left.x -= leftShare;
        right.x += Math.min(rightRoom, needed - leftShare);
      }
    }
    for (const box of boxes) tethered(box, viewWidth);
  }
}

/** Moves a covered box to the nearest clear place within its reach, if there is one. */
function clear(box: Box, obstacles: readonly ScreenRect[], viewWidth: number, viewHeight: number): void {
  const fits = (x: number, y: number) => x - box.half >= 0 && x + box.half <= viewWidth
    && y - box.height >= 0 && y <= viewHeight
    && obstacles.every(rect => rect.width <= 0 || rect.height <= 0 || !touches(box, x, y, rect));
  if (fits(box.x, box.y)) return;
  let bestX = box.x, bestY = box.y, best = Infinity;
  for (const rect of obstacles) {
    if (!touches(box, box.x, box.y, rect)) continue;
    const moves: [number, number][] = [
      [rect.left - box.half - GAP, box.y],
      [rect.left + rect.width + box.half + GAP, box.y],
      [box.x, rect.top - GAP],
      [box.x, rect.top + rect.height + box.height + GAP],
    ];
    for (const [x, y] of moves) {
      const distance = Math.hypot(x - box.x, y - box.y);
      const fromHead = Math.hypot(x - box.x0, y - box.y0);
      if (fromHead <= reach(box) && distance < best && fits(x, y)) {
        best = distance;
        bestX = x;
        bestY = y;
      }
    }
  }
  box.x = bestX;
  box.y = bestY;
}

/**
 * Rewrites the screen position of the annotations in `start` to
 * `start + count`. `controls` are the on-screen controls in canvas pixels;
 * the view is the canvas's size in pixels.
 */
export function spreadAnnotations(instances: Float32Array, start: number, count: number, scale: number,
  controls: readonly ScreenRect[], viewWidth: number, viewHeight: number): void {
  if (count === 0) return;
  const boxes: Box[] = [];
  for (let i = start; i < start + count; i++) boxes.push(boxOf(instances, i, scale));
  separate(boxes, viewWidth);
  // A bubble moved clear of a control must not land on one already placed,
  // so each placed bubble becomes an obstacle for the next.
  boxes.sort((a, b) => a.x - b.x || a.index - b.index);
  const obstacles: ScreenRect[] = [...controls];
  for (const box of boxes) {
    clear(box, obstacles, viewWidth, viewHeight);
    obstacles.push({left: box.x - box.half, top: box.y - box.height, width: box.half * 2, height: box.height});
  }
  for (const box of boxes) {
    instances[box.index * FLOATS_PER_INSTANCE + OFFSET_SCREEN_X] = box.x;
    instances[box.index * FLOATS_PER_INSTANCE + OFFSET_SCREEN_Y] = box.y - box.drop;
  }
}
