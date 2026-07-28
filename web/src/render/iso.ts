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
 * Screen x for a world tile coordinate. The sign on `wy` is the whole
 * difference between the two world axes; without it the diamond
 * collapses onto one diagonal.
 *
 * Fractional inputs are expected and supported: `frame.ts` interpolates
 * between the previous and current tick before calling this, so `wx` and
 * `wy` are usually between tiles rather than on one.
 */
export function screenX(wx: number, wy: number, originX: number): number {
  return (wx - wy) * TILE_HALF_WIDTH + originX;
}

/**
 * Screen y for a world tile coordinate. Both world axes increase
 * downward, which is what makes x + y the nearness ordering `worldDepth`
 * inverts.
 */
export function screenY(wx: number, wy: number, originY: number): number {
  return (wx + wy) * TILE_HALF_HEIGHT + originY;
}

/**
 * Both screen coordinates as a tuple. Reads better at a call site than
 * two calls do, so it is what tests and any non-per-frame caller should
 * use - but **not** the render loop.
 *
 * It delegates rather than repeating the arithmetic, so there is still
 * exactly one definition of each axis and the tuple form cannot drift
 * away from the scalar one.
 *
 * **Why the render loop calls the scalars instead.** This returns a
 * per-entity, per-frame array. Through Task 13 that was excused on the
 * grounds that the tuple never escapes and V8's escape analysis would
 * eliminate it once this inlined into `buildInstances` - an expectation
 * the comment here admitted was never measured. The M0 close-out
 * measured it, and the expectation was wrong: V8's sampling heap
 * profiler attributes **57.8 MB of allocation to `buildInstances` over
 * 2,394 frames** at 1,002 entities, about 25 bytes per entity per frame,
 * which is the tuple and nothing else. See [V11] in
 * `docs/gpu-verification.md`, and [L20] for why the first run of that
 * profile read zero.
 *
 * That is a straight violation of [D11]'s "no per-entity JS objects,
 * ever", so `buildInstances` now calls `screenX`/`screenY` and allocates
 * nothing per entity. Do not reach for a shared mutable tuple as the fix
 * if this ever comes up again: that is a per-entity JS object by another
 * name, plus aliasing.
 */
export function worldToScreen(
  wx: number,
  wy: number,
  originX: number,
  originY: number,
): [number, number] {
  return [screenX(wx, wy, originX), screenY(wx, wy, originY)];
}

/**
 * Screen pixels back to world tile coordinates: the exact inverse of
 * `worldToScreen`, in closed form.
 *
 * The derivation, with x and y taken relative to the origin. Forward,
 * `x = (wx - wy) * TILE_HALF_WIDTH` and `y = (wx + wy) * TILE_HALF_HEIGHT`,
 * so `x / TILE_HALF_WIDTH` is `wx - wy` and `y / TILE_HALF_HEIGHT` is
 * `wx + wy`. Their sum is `2 * wx` and their difference is `2 * wy`, which
 * is the whole of the code below. The two halves therefore differ only in
 * one sign, and that sign is the entire correctness of picking: get it
 * wrong and clicks land one tile off in some directions and dead on in
 * others, which reads as a flaky game rather than as a bug in this file.
 *
 * **The result is fractional and stays fractional.** The caller decides
 * what the fraction means, because the answers differ: hit-testing a tile
 * wants the floor, while a future drag or camera gesture wants the
 * sub-tile remainder. Rounding here would destroy that before anyone
 * could choose.
 *
 * **Why this returns a tuple when `worldToScreen` is banned from doing so
 * in the render loop.** [D11] forbids per-entity JS objects per frame, and
 * [V11] measured 57.8 MB of exactly that allocation before `buildInstances`
 * was moved onto `screenX`/`screenY`. This function is called from pointer
 * event handlers, so it runs at most a handful of times a second and never
 * once per entity. One short-lived array per click is not on any hot path,
 * and a tuple reads better at the call site than two scalar calls do.
 *
 * **Picking inverts the projection; it does not hit-test the rendered
 * quads.** Per [D-4]: invert to a world tile, then ask the simulation what
 * is standing on that tile. Quad-space picking would couple input to the
 * renderer's current sprite size, so changing the art would silently
 * change where clicks land. Keeping input in world space lets the two move
 * independently.
 */
export function screenToWorld(
  sx: number,
  sy: number,
  originX: number,
  originY: number,
): [number, number] {
  const x = sx - originX;
  const y = sy - originY;
  return [
    (x / TILE_HALF_WIDTH + y / TILE_HALF_HEIGHT) / 2,
    (y / TILE_HALF_HEIGHT - x / TILE_HALF_WIDTH) / 2,
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
 * 1.0, so the **smaller** depth wins the pixel (measured causally in
 * `docs/gpu-verification.md` [V3]: two quads at one pixel, draw order
 * held constant, only the depths swapped, and the winner flipped). Tiles
 * with a larger x + y sit lower on the screen and are nearer the camera,
 * so they take the smaller value; the far corner at (0, 0) takes 1 and
 * draws behind everything.
 *
 * That cross-file contract is pinned mechanically as well as in prose:
 * `iso.test.ts` reads `sprites.ts` as text and fails if the compare op,
 * the clear value or `depthWriteEnabled` drifts from what this
 * derivation assumes.
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
