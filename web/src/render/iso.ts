/**
 * The fixed isometric projection: world tile coordinates to screen pixels,
 * plus the depth value that decides what covers what.
 *
 * The camera angle never changes, and TECH_STACK.md [G2] spends the whole
 * art budget on that: props need no LODs, no back faces, and no normals,
 * and bought or generated models only have to look good from one angle.
 * This file is where that assumption stops being a plan and becomes two
 * numbers, so the axis directions and the depth mapping are load-bearing
 * rather than cosmetic.
 *
 * Pure arithmetic, no I/O, no GPU. That is deliberate: it is the second
 * piece of the renderer (after `instances.ts`) that can be tested rather
 * than merely looked at.
 *
 * **Screen space grows downward.** `sprites.wgsl` flips Y on the way to
 * clip space, so a larger screen y is lower on screen. Both world axes
 * increase downward here, which means x + y increases toward the viewer.
 */

/** Half a tile's width in pixels; a full diamond is 64 px across. */
export const TILE_HALF_WIDTH = 32;

/**
 * Half a tile's height in pixels; a full diamond is 32 px tall.
 *
 * The 2:1 ratio against TILE_HALF_WIDTH is the camera angle. Changing
 * either constant alone re-pitches the camera and invalidates every asset
 * authored against it, which is the one thing [G2] promises will not
 * happen.
 */
export const TILE_HALF_HEIGHT = 16;

/**
 * Converts world tile coordinates to screen pixels.
 *
 * Fractional inputs are expected and supported: Task 12 interpolates
 * between the previous and current tick before calling this, so `wx` and
 * `wy` are usually between tiles rather than on one.
 *
 * Returns a tuple rather than writing into an out-parameter, which is the
 * interface the plan specifies and which reads far better at the call
 * site. The array is a per-entity, per-frame allocation that V8's escape
 * analysis is expected to eliminate once this inlines into the frame loop
 * (it never escapes; Task 12 destructures it immediately). That is an
 * expectation, not a measurement - Task 13's perf harness is where it gets
 * one. If the allocation ever shows up in a profile, the fix is to add
 * scalar `screenX`/`screenY` helpers alongside this, not to reach for a
 * mutable shared tuple, which would be a per-entity JS object by another
 * name and is exactly what [D11] forbids.
 */
export function worldToScreen(
  wx: number,
  wy: number,
  originX: number,
  originY: number,
): [number, number] {
  return [
    (wx - wy) * TILE_HALF_WIDTH + originX,
    (wx + wy) * TILE_HALF_HEIGHT + originY,
  ];
}

/**
 * Depth for the depth buffer, in [0, 1].
 *
 * Depth is derived from world position and written to the depth buffer
 * rather than sorted on the CPU, per [D10]: at 100k objects, not sorting
 * beats sorting well. That only works if the value has the right sense.
 *
 * `sprites.ts` configures `depthCompare: 'less'` against a clear value of
 * 1.0, so the **smaller** depth wins the pixel (measured causally in Task
 * 10 [V3]: two quads at one pixel, draw order held constant, only the
 * depths swapped, and the winner flipped). Tiles with a larger x + y sit
 * lower on the screen and are nearer the camera, so they take the smaller
 * value; the far corner at (0, 0) takes 1 and draws behind everything.
 *
 * The clamp is not decoration. A depth outside [0, 1] fails the clip test,
 * so the entity does not sort wrong, it vanishes - and `Math.max(1, ...)`
 * keeps a degenerate `gridSize` from producing 0/0, because a NaN depth
 * drops the quad just as silently.
 */
export function worldDepth(wx: number, wy: number, gridSize: number): number {
  // The largest x + y the grid can hold. Math.max floors it at 1 so a
  // gridSize of 0 or 1 divides by 1 rather than by 0.
  const maxSum = Math.max(1, (gridSize - 1) * 2);
  const nearness = (wx + wy) / maxSum;
  return Math.min(1, Math.max(0, 1 - nearness));
}
