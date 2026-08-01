/**
 * The camera: one scale, one origin, and the arithmetic of the gestures
 * that move them.
 *
 * The origin BECAME free state when pan landed ([V8]): it starts at
 * `cameraOrigin`'s centred answer and from then on belongs to the
 * player's drags and anchored zooms, bounded by `clampOrigin` so the
 * lot can never be flung entirely off screen. That is also what
 * unlocked the zoom the option text originally asked for - anchored at
 * the cursor or the pinch midpoint rather than the lot centre, because
 * "keep this point still while everything scales around it" is exactly
 * a pan, and pan now exists.
 *
 * Three input routes, one state: wheel, pinch and drag all end in the
 * same clamped scale and origin, so nothing downstream knows which
 * device asked. Pure arithmetic, no DOM - the wiring lives in
 * `input.ts` and the tests live here.
 */

import { TILE_HALF_HEIGHT, TILE_HALF_WIDTH } from './iso.js';

/** The live camera. `main.ts` owns the one instance; gestures move it
 * through the helpers below and a dirty flag rebuilds what must agree. */
export interface Camera {
  scale: number;
  originX: number;
  originY: number;
}

/**
 * The zoom band. 0.5x fits the whole lot with margin on a small window;
 * 2.5x fills a 1280-wide canvas with about six tiles, which is close
 * enough to count a sim's buttons. Multiplicative steps inside a
 * clamped band, so holding the wheel saturates instead of running away.
 */
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 2.5;

/** `scale` forced into the zoom band. NaN becomes 1, not a clamp edge:
 * a corrupt delta should leave the camera sane, not slammed wide. */
export function clampZoom(scale: number): number {
  if (Number.isNaN(scale)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
}

/**
 * How fast the wheel zooms: the scale multiplies by e^(this) per pixel
 * of wheel delta. At the typical ~100-pixel notch that is about 12% per
 * click - eight notches to double - which is the "smooth" Tim chose
 * over stepped presets.
 */
const WHEEL_ZOOM_RATE = 0.0012;

/**
 * The scale after a wheel event. Wheel-up (negative `deltaY`) zooms IN,
 * matching every map the player has ever scrolled.
 *
 * Exponential in the delta rather than linear, because zoom is
 * perceived as a ratio: the step from 0.5x to 0.6x is a fifth more
 * house, while the same +0.1 from 2.4x is a twenty-fourth. e^(-d*r)
 * makes every notch the same fraction, so the wheel feels even across
 * the whole band.
 */
export function wheelZoom(scale: number, deltaY: number): number {
  return clampZoom(scale * Math.exp(-deltaY * WHEEL_ZOOM_RATE));
}

/**
 * The scale mid-pinch: the scale the gesture STARTED at, multiplied by
 * how far apart the fingers have moved since. Anchoring to the start
 * rather than compounding per move event is what keeps a pinch stable -
 * per-event compounding turns event-rate jitter into zoom jitter, and a
 * pinch held still would drift.
 *
 * A degenerate start distance answers the start scale unchanged: two
 * pointers can land on the same pixel, and a division by zero here
 * would clamp the camera to an edge on the first move.
 */
export function pinchZoom(
  startScale: number,
  startDistance: number,
  distance: number,
): number {
  if (startDistance <= 0) return clampZoom(startScale);
  return clampZoom(startScale * (distance / startDistance));
}

/** Distance between two pointers, for the pinch's ratio. */
export function pointerDistance(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  return Math.hypot(x1 - x0, y1 - y0);
}

/**
 * How far a pointer may wander, in CSS pixels, and still be a click.
 * Past this it is a drag and the eventual `click` event is poisoned. 5
 * is the number platforms themselves use for tap slop; a threshold of
 * 0 would turn every slightly shaky tap into a one-pixel pan and a
 * lost selection.
 */
export const DRAG_THRESHOLD_PX = 5;

/**
 * The origin after zooming so that `anchor` - a screen point in buffer
 * pixels - stays over the same spot of the world.
 *
 * The whole of anchored zoom is one similarity: a world point sits at
 * `world * k * scale + origin`, so holding its screen position fixed
 * across a scale change means the origin moves to
 * `anchor - (anchor - origin) * (newScale / oldScale)`. This is what
 * the original option text meant by cursor-centred zoom, and why it
 * had to wait for pan: the result is an origin no longer derived from
 * anything, which only became a legal state when `clampOrigin` arrived
 * to bound it.
 *
 * A degenerate `oldScale` answers the origin unchanged rather than
 * dividing by zero; the clamp on scale means it cannot happen from the
 * shipped gestures, but this function does not know its caller.
 */
export function zoomAnchoredOrigin(
  originX: number,
  originY: number,
  anchorX: number,
  anchorY: number,
  oldScale: number,
  newScale: number,
): { x: number; y: number } {
  if (oldScale <= 0) return { x: originX, y: originY };
  const ratio = newScale / oldScale;
  return {
    x: anchorX - (anchorX - originX) * ratio,
    y: anchorY - (anchorY - originY) * ratio,
  };
}

/**
 * The lot's drawn bounding box RELATIVE TO THE ORIGIN, in buffer
 * pixels at `scale` - what `clampOrigin` bounds the pan against.
 *
 * The vertical terms are `cameraOrigin`'s own: the boundary row at
 * world -1, the tallest sprite above it, the last tile row plus its
 * anchor below. Horizontally the extreme columns are the boundary
 * tiles at `(-1, lotHeight - 1)` (west) and `(lotWidth - 1, -1)`
 * (east), each half a tile wider for the diamond's own width.
 */
export function lotExtent(
  lotWidth: number,
  lotHeight: number,
  tallestSprite: number,
  scale: number,
): { left: number; right: number; top: number; bottom: number } {
  return {
    left: -(lotHeight + 1) * TILE_HALF_WIDTH * scale,
    right: (lotWidth + 1) * TILE_HALF_WIDTH * scale,
    top: (-TILE_HALF_HEIGHT - tallestSprite) * scale,
    bottom:
      ((lotWidth + lotHeight - 2) * TILE_HALF_HEIGHT + TILE_HALF_HEIGHT) *
      scale,
  };
}

/**
 * How much of the lot must stay on screen, in buffer pixels: a pan can
 * park the house mostly off screen, but never ALL the way off, because
 * a player who flings the lot away has no landmark to drag back
 * toward - the blank-canvas version of [L17]'s "looks broken, is not".
 */
export const PAN_KEEP_VISIBLE_PX = 96;

/**
 * The origin clamped so at least `PAN_KEEP_VISIBLE_PX` of the lot's
 * drawn box remains inside the canvas on each axis.
 *
 * When a canvas is too small for even that much (a sliver of a
 * window), the interval inverts and the midpoint is used: a degenerate
 * viewport gets a centred lot rather than a clamp fight.
 */
export function clampOrigin(
  originX: number,
  originY: number,
  extent: { left: number; right: number; top: number; bottom: number },
  canvasWidth: number,
  canvasHeight: number,
): { x: number; y: number } {
  const clampAxis = (value: number, lo: number, hi: number): number =>
    lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, value));
  return {
    // Lot's right edge at least the margin in from the left, and its
    // left edge at least the margin in from the right.
    x: clampAxis(
      originX,
      PAN_KEEP_VISIBLE_PX - extent.right,
      canvasWidth - PAN_KEEP_VISIBLE_PX - extent.left,
    ),
    y: clampAxis(
      originY,
      PAN_KEEP_VISIBLE_PX - extent.bottom,
      canvasHeight - PAN_KEEP_VISIBLE_PX - extent.top,
    ),
  };
}
