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
 * Half a tile's height in pixels; a full diamond is 42 px tall.
 *
 * The ratio against TILE_HALF_WIDTH is the camera angle, and this one is
 * **measured off the art rather than chosen**. It was 16 - a round 2:1, the
 * SimCity and Sims pitch - and that was wrong for the assets the game
 * actually ships, which is what made wall runs look jagged.
 *
 * A vertical wall's top edge is parallel to the ground edge it stands on, so
 * it is a direct probe of the art's ground plane. `Isometric/wall_SE.png` in
 * the Kenney kit climbs 69 px over 104 px of run, a slope of 0.663, so one of
 * our 32 px tile edges has to drop `32 * 0.663 = 21` px. At 16 the grid
 * climbed at 0.5 while every sprite was drawn for 0.663, and along a run of
 * wall tiles the two diverged by about 5 px per tile and accumulated into a
 * sawtooth.
 *
 * **Do not measure this off the floor sprite**, which gives 0.72: it is a slab
 * with visible side faces, so its widest scanline sits below the top face's
 * midline. That measurement is where the old "Kenney is about 1.42:1" note in
 * `assets/sprites/gen/` came from.
 *
 * Changing either constant alone re-pitches the camera and invalidates every
 * asset authored against it - which is exactly what happened here, in reverse:
 * the assets were authored against a pitch the code did not have, and this is
 * the code being corrected to match them. `$TILE_H` in the atlas build script
 * is `2 *` this, and the generated floor diamond is drawn from it, so the two
 * cannot drift without the atlas visibly changing shape.
 */
export const TILE_HALF_HEIGHT = 21;

/**
 * Screen x for a world tile coordinate. The sign on `wy` is the whole
 * difference between the two world axes; without it the diamond
 * collapses onto one diagonal.
 *
 * Fractional inputs are expected and supported: `frame.ts` interpolates
 * between the previous and current tick before calling this, so `wx` and
 * `wy` are usually between tiles rather than on one.
 *
 * `scale` is the camera zoom, defaulting to 1 so every pre-camera call
 * site keeps meaning what it meant. It multiplies the WORLD term and
 * never the origin: the origin is already in screen pixels - it is where
 * the lot's anchor lands on the canvas - so scaling it too would zoom
 * the lot's position as well as its size and slide everything toward a
 * corner. `cameraOrigin` recentres for the scaled extent instead.
 */
export function screenX(
  wx: number,
  wy: number,
  originX: number,
  scale = 1,
): number {
  return (wx - wy) * TILE_HALF_WIDTH * scale + originX;
}

/**
 * Screen y for a world tile coordinate. Both world axes increase
 * downward, which is what makes x + y the nearness ordering `worldDepth`
 * inverts. `scale` as on `screenX`: world term only, origin untouched.
 */
export function screenY(
  wx: number,
  wy: number,
  originY: number,
  scale = 1,
): number {
  return (wx + wy) * TILE_HALF_HEIGHT * scale + originY;
}

/**
 * Initial camera placement that centres the lot's conservative drawn extent.
 *
 * `main.ts` uses this once to seed the live camera. Pan and zoom own the origin
 * afterward. When the conservative extent fits, this places the whole modeled
 * bound on screen; when it is taller than the viewport, it shares the
 * unavoidable overflow equally between the two edges.
 *
 * # What it accounts for that the obvious version does not
 *
 * The obvious version centres the TILE span - `(w + h - 2)` half-tile
 * heights - and it shipped, and it was wrong in two ways that only showed
 * up when the lot grew:
 *
 * - **Sprites are drawn ABOVE their anchor.** A tile's screen position is
 *   the bottom of the diamond it stands on; a 99 px wall panel reaches 78
 *   px above that. Centring the tile span puts the top row's anchor near
 *   the top of the canvas and everything the sprite adds off it.
 * - **`tiles.ts` draws a boundary at x = -1 and y = -1**, two half-tile
 *   rows further up again, which the tile span does not include at all.
 *
 * Measured on the five-room lot before this existed: `originY` came out at
 * 87, and the boundary panels at (-1, -1), (0, -1) and (-1, 0) had their
 * tops at y = -33, -12 and -11. The north-west corner of the house was cut
 * off, and the rule that was supposed to prevent exactly that is the rule
 * that missed it.
 *
 * So the extent centred here is the DRAWN one: from the top of the tallest
 * sprite standing on the boundary row down to the bottom of the last tile
 * row.
 *
 * `tallestSprite` is passed in rather than imported so this file stays
 * arithmetic with no dependency on the atlas; `main.ts` reads it off
 * `SPRITES`. Using the tallest sprite in the whole atlas rather than the
 * tallest WALL is deliberately conservative: it includes a hypothetical tall
 * object on the lot's first row. The full conservative extent is centered. It
 * fits without clipping when the viewport is at least that tall; if it is
 * taller than the viewport, the unavoidable overflow is shared equally rather
 * than hidden on one edge.
 *
 * The horizontal axis is not treated the same way and does not need to be.
 * `screenX` spans `(w + h - 2)` half-tile widths, which is 832 px on the
 * shipped lot, and the widest sprite adds 117 - comfortably inside 1280.
 * If a lot ever gets wide enough for that to matter, this is where it goes.
 */
export function cameraOrigin(
  canvasWidth: number,
  canvasHeight: number,
  lotWidth: number,
  lotHeight: number,
  tallestSprite: number,
  scale = 1,
): { x: number; y: number } {
  // Relative to `originY`: the topmost pixel any sprite reaches, and the
  // bottommost. The boundary row is at world -1, so its screen y is
  // -2 * TILE_HALF_HEIGHT, and a sprite's top is `screenY + anchor - h`
  // with the anchor half a tile down.
  //
  // Everything here is a DRAWN distance, so everything scales with the
  // camera: tile spans because `screenX`/`screenY` multiply their world
  // terms by `scale`, and sprite heights because the renderer draws
  // every quad at `size * scale`. Scaling one and not the other would
  // recentre a zoomed lot against an unzoomed house and clip its roof.
  // At `scale` 1 every term is exactly what it was before the camera
  // existed, which is what keeps the pre-zoom golden assertions green.
  const top =
    (-2 * TILE_HALF_HEIGHT + TILE_HALF_HEIGHT) * scale - tallestSprite * scale;
  const bottom =
    ((lotWidth + lotHeight - 2) * TILE_HALF_HEIGHT + TILE_HALF_HEIGHT) * scale;
  return {
    x: canvasWidth / 2 - ((lotWidth - lotHeight) * TILE_HALF_WIDTH * scale) / 2,
    y: (canvasHeight - (bottom - top)) / 2 - top,
  };
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
  scale = 1,
): [number, number] {
  return [screenX(wx, wy, originX, scale), screenY(wx, wy, originY, scale)];
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
  scale = 1,
): [number, number] {
  // The exact inverse of the forward pair, so the scale divides where
  // the forward multiplied - AFTER the origin is subtracted, because
  // the forward added the origin after scaling.
  const x = (sx - originX) / scale;
  const y = (sy - originY) / scale;
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

/**
 * How many things may stand on one tile and still be ordered.
 *
 * Three: the floor, whatever furniture or wall is on it, and the sim
 * standing on that furniture. Raising this costs depth precision at the
 * near end of the lot and nothing else.
 */
export const DEPTH_LAYERS = 3;

/**
 * Floor tiles. **Kept for the layer arithmetic's sake and no longer used to
 * draw the floor**; see `FLOOR_DEPTH`.
 */
export const LAYER_FLOOR = 0;
/** Walls and smart objects. */
export const LAYER_PROP = 1;
/** Sims. Nearest, so a sim standing on an object is never swallowed. */
export const LAYER_SIM = 2;

/**
 * The depth one layer is worth.
 *
 * It has to be small enough that a layer bias never reorders two
 * different tiles, and large enough to survive being stored as an f32 in
 * the instance array and interpolated to a `depth24plus` buffer. One tile
 * of separation is `2 / ((gridSize - 1) * 2)`, which on the shipped 24 x
 * 18 lot (`gridSize` 24) is 1/23 = 0.0435, so this is 178 times smaller
 * than the gap it must not cross, and 24-bit depth resolves 1/16,777,216.
 */
export const DEPTH_LAYER_STEP = 1 / 4096;

/**
 * How far outside the lot `layeredDepth` still returns a usable depth,
 * in tiles.
 *
 * `worldDepth` maps tile (0, 0) to exactly 1 and clamps anything beyond
 * it, so every tile with a negative coordinate sum collapses onto the far
 * plane together. `tiles.ts` draws the lot's own boundary a tile outside
 * the north and west edges - the boundary is impassable in the
 * simulation whether or not `lot.toml` lists it, because `is_walkable`
 * refuses everything off the grid - and without this margin those panels
 * would all share one depth with each other and with the corner tile,
 * leaving the order to fall back on draw order.
 *
 * Applied as a translation of both axes, which shifts every depth by the
 * same amount and therefore changes no ordering at all.
 */
export const DEPTH_MARGIN = 1;

/**
 * The one depth every floor tile is drawn at.
 *
 * # Why the floor is not depth-sorted at all
 *
 * Per-tile floor depth is wrong, and it was visibly wrong: **a floor tile one
 * step nearer the camera drew over the bottom of a sim's sprite.** Measured on a
 * shipped frame with the sim at (8, 3.75), the tiles at (9, 3.75) and (8, 4.75)
 * each overlapped its sprite by 19 x 21 px and each had a smaller depth - 0.4736
 * against the sim's 0.5088 - so both won those pixels. On screen that is a sim
 * standing shin-deep in the floor.
 *
 * The layer scheme cannot fix this and it is worth being exact about why.
 * `DEPTH_LAYER_STEP` is 1/4096, about 0.00024, while one tile of depth on the
 * shipped lot is 1/28, about 0.036 - a hundred and fifty times larger. So
 * `LAYER_SIM` only ever outranks something on the **same** tile. Against a
 * nearer tile it loses, and a floor diamond is 42 px tall while a tile step is
 * only 21 px, so a nearer floor tile always covers the lower half of the
 * previous tile's screen area, which is exactly where a sim's feet are.
 *
 * # So the floor stops competing
 *
 * The floor is the ground. Nothing is ever behind it and it should never occlude
 * anything, so it does not need a per-tile depth - it needs one depth, further
 * than everything else. Floor diamonds tile edge to edge and their opaque pixels
 * do not overlap each other, so they need no ordering among themselves either;
 * the 672-sample seam check in `docs/alpha-feel-notes.md` [A-7] is the evidence.
 *
 * # Why this exact value
 *
 * It has to sit **behind every `layeredDepth` result** and **in front of the
 * clear value**, and both bounds are tight:
 *
 * - `layeredDepth`'s maximum is `1 - DEPTH_LAYER_STEP`, reached by a prop at the
 *   far corner. Half a step beyond that clears it.
 * - `sprites.ts` clears depth to 1.0 and compares with `less`. A fragment at
 *   exactly 1.0 is **not** less than 1.0, so a floor at 1.0 would fail the depth
 *   test and the entire floor would silently vanish.
 *
 * Derived from `DEPTH_LAYER_STEP` rather than written as a literal like 0.9999,
 * so the relationship survives that constant changing.
 */
export const FLOOR_DEPTH = 1 - DEPTH_LAYER_STEP / 2;

/**
 * `worldDepth` with a within-tile layer applied, so that two entities on
 * the same tile still have a defined order.
 *
 * **Why this exists.** [V12] recorded a sim standing on the fridge
 * vanishing: both quads took the same world position, so both took the
 * same depth, and `depthCompare: 'less'` rejected whichever was drawn
 * second. The orange pixels were simply absent from the frame. During a
 * play session that reads as the sim having disappeared, which is an AI
 * bug to anybody watching, and it is not one.
 *
 * **Why the base depth is squeezed rather than the layers clamped.**
 * Subtracting a bias from `worldDepth`'s raw output would leave the range
 * at the near corner, where `worldDepth` already returns 0; the clamp
 * would then collapse all three layers onto 0 and the tie would be back
 * on exactly the tiles nearest the camera. Reserving `DEPTH_LAYERS` steps
 * at the top instead means the result is in
 * `[DEPTH_LAYER_STEP, 1]` for every input, and the three layers are
 * strictly ordered on every tile including both corners.
 *
 * Smaller wins the pixel, so a **larger** layer draws in front. See
 * `worldDepth` above for why that is the sense.
 */
export function layeredDepth(
  wx: number,
  wy: number,
  gridSize: number,
  layer: number,
): number {
  const headroom = DEPTH_LAYERS * DEPTH_LAYER_STEP;
  const nearness = worldDepth(
    wx + DEPTH_MARGIN,
    wy + DEPTH_MARGIN,
    gridSize + DEPTH_MARGIN,
  );
  return headroom + nearness * (1 - headroom) - layer * DEPTH_LAYER_STEP;
}
