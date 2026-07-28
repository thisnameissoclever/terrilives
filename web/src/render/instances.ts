/**
 * The GPU instance layout and buffer sizing rules.
 *
 * This module exists because it is the part of the renderer that has no
 * GPU in it, and therefore the part that can be tested rather than merely
 * looked at. Everything else in `sprites.ts` needs a real device.
 *
 * The layout is a contract between three parties:
 *   1. `writeInstance` below, which packs it;
 *   2. `sprites.wgsl`, which reads it as `@location(0) instance: vec4<f32>`;
 *   3. `frame.ts` (Task 12), which fills it every frame.
 * Nothing in the type system connects the three. Reordering the fields in
 * one place and not the others draws every entity at the wrong depth in
 * the wrong colour, with no error from anywhere.
 *
 * Per [D11]: typed arrays only. No per-entity JavaScript object is ever
 * constructed on this path, which is why the packer takes loose numbers
 * and an index rather than a struct.
 */

/**
 * A packed instance array, backed by a plain (non-shared) ArrayBuffer.
 *
 * TypeScript 5.7 made typed arrays generic over their backing buffer, and
 * the DOM's `BufferSource` admits only views over a non-shared
 * `ArrayBuffer`. A bare `Float32Array` therefore means
 * `Float32Array<ArrayBufferLike>` and `GPUQueue.writeBuffer` rejects it.
 * Naming the constraint once here keeps the cast count on the render path
 * at zero, which matters because a cast would also silence a real
 * SharedArrayBuffer mistake if WASM threads ever land.
 */
export type InstanceArray = Float32Array<ArrayBuffer>;

/** screenX, screenY, depth, sprite. Matches `vec4<f32>` in sprites.wgsl. */
export const FLOATS_PER_INSTANCE = 4;

/** The vertex buffer `arrayStride`, in bytes. */
export const BYTES_PER_INSTANCE =
  FLOATS_PER_INSTANCE * Float32Array.BYTES_PER_ELEMENT;

/** Two triangles. Must equal the length of CORNERS in sprites.wgsl. */
export const VERTICES_PER_QUAD = 6;

/** Field offsets within one instance, in floats. */
export const OFFSET_SCREEN_X = 0;
export const OFFSET_SCREEN_Y = 1;
export const OFFSET_DEPTH = 2;
export const OFFSET_SPRITE = 3;

/**
 * The `kinds` array the render buffer exports: 0 for a sim, 1 for a smart
 * object. It is **not** what the GPU draws - the sprite index is - and it
 * exists on this side only to pick the depth layer a row belongs on. See
 * `layeredDepth` in `iso.ts`.
 */
export const KIND_AGENT = 0;

/**
 * The most sprites the atlas may hold, and the length of the `Atlas`
 * uniform array in `sprites.wgsl`.
 *
 * A uniform array in WGSL is fixed-size, so this number lives in two
 * files by necessity. `instances.test.ts` reads the shader as text and
 * fails if they disagree - an over-long atlas would otherwise index past
 * the array, and WGSL **clamps** an out-of-range index rather than
 * trapping, so every sprite past the end would silently draw as the last
 * one in the table.
 */
export const MAX_SPRITES = 32;

/**
 * Writes one entity into slot `index` of a packed instance array.
 *
 * `out` may be longer than the live entity count; callers reuse a scratch
 * buffer across frames and pass the count separately, so this must touch
 * exactly the four floats belonging to `index` and nothing else.
 */
export function writeInstance(
  out: Float32Array,
  index: number,
  screenX: number,
  screenY: number,
  depth: number,
  sprite: number,
): void {
  const base = index * FLOATS_PER_INSTANCE;
  out[base + OFFSET_SCREEN_X] = screenX;
  out[base + OFFSET_SCREEN_Y] = screenY;
  out[base + OFFSET_DEPTH] = depth;
  out[base + OFFSET_SPRITE] = sprite;
}

/**
 * Next instance-buffer capacity that holds `needed`, growing by doubling.
 *
 * Doubling rather than fitting exactly is the whole point: a GPU buffer
 * cannot be resized, so growth means destroy plus allocate. Fitting
 * exactly would reallocate on every frame in which one entity spawned.
 * Doubling makes that amortised, so the render loop stays allocation-free
 * in steady state, which is the [D11] property this milestone is testing.
 */
export function growCapacity(current: number, needed: number): number {
  if (needed <= current) return current;
  // Math.max guards the degenerate start: doubling zero never terminates.
  let next = Math.max(current, 1);
  while (next < needed) next *= 2;
  return next;
}
