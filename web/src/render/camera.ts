/**
 * The camera: one scale and a derived origin.
 *
 * The design ([A-11] PR 3, docs/specs) keeps this deliberately small.
 * The origin is never free state - `cameraOrigin` in `iso.ts` derives it
 * from the canvas, the lot and the scale on every change - so the only
 * thing the player's gestures actually own is `scale`. That is what
 * makes v1 zoom LOT-CENTRED: cursor-centred zoom is mathematically a
 * pan (the origin becomes free state needing clamping), and it ships
 * when pan does.
 *
 * Two input routes, one state: the mouse wheel and a two-finger pinch
 * both end in the same clamped scale, so nothing downstream knows which
 * device asked. Pure arithmetic, no DOM - the wiring lives in
 * `input.ts` and the tests live here.
 */

/** The live camera. `main.ts` owns the one instance and derives the
 * origins via `cameraOrigin` whenever `scale` or the canvas changes. */
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
