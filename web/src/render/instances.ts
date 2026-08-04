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

/**
 * Two `vec4<f32>`s per instance:
 *
 *   0..3  screenX, screenY, depth, sprite  - `@location(0)`
 *   4..7  tintR, tintG, tintB, emissive    - `@location(1)`
 *
 * The second one is [ML-tint]. The first four slots were all spent, so
 * carrying a per-instance colour meant a second attribute rather than a
 * spare component; that doubles the per-frame upload from 16 to 32 bytes
 * an entity, which against [V11]'s measured headroom is not a question.
 */
export const FLOATS_PER_INSTANCE = 8;

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
export const OFFSET_TINT_R = 4;
export const OFFSET_TINT_G = 5;
export const OFFSET_TINT_B = 6;
export const OFFSET_EMISSIVE = 7;

/** Byte offset of the tint attribute within one instance. */
export const TINT_ATTRIBUTE_OFFSET =
  OFFSET_TINT_R * Float32Array.BYTES_PER_ELEMENT;

/**
 * The tint an instance carries when nothing wants to recolour it: white,
 * and fully subject to the ambient. Multiplying by white is the identity,
 * so a caller that passes nothing draws exactly what it drew before this
 * attribute existed.
 */
export const TINT_NONE = 1;

/**
 * The fourth tint component is **not alpha**, and calling it alpha is the
 * mistake this constant exists to prevent. It is how far the sprite
 * IGNORES the time of day: 0 is fully lit by `u.ambient`, 1 resists it
 * completely.
 *
 * A lamp shade, a television and a window need this. The ambient multiply
 * darkens every fragment as night falls, which for a light source is
 * exactly backwards - the room goes dark and so does the thing lighting
 * it. An emissive of 1 on those sprites is the whole fix, and it costs a
 * `mix` in the fragment shader rather than a second pass.
 *
 * It cannot ride in the alpha slot for a mechanical reason as well as a
 * naming one: the fragment shader alpha-TESTS at 0.5 and writes depth, so
 * anything that scaled alpha would move the discard threshold and erode
 * every sprite edge as the light changed.
 */
export const EMISSIVE_NONE = 0;

/**
 * The `kinds` array the render buffer exports: 0 for a sim, 1 for a smart
 * object. It is **not** what the GPU draws - the sprite index is - and it
 * exists on this side only to pick the depth layer a row belongs on. See
 * `layeredDepth` in `iso.ts`.
 */
export const KIND_AGENT = 0;

/*
 * `MAX_SPRITES` was here, and is deliberately gone - [ML-sprites].
 *
 * It capped the atlas at 128 because `sprites.wgsl` held its sprite table
 * in a fixed-size UNIFORM array, and a fixed-size array in WGSL means the
 * length lives in two files at once with nothing in either language
 * connecting them. The cap was also a silent failure rather than a loud
 * one: WGSL clamps an out-of-range index instead of trapping, so the
 * first sprite past the end would have drawn as the last one in the
 * table, forever, with no error from anywhere.
 *
 * The table is now a runtime-sized array in a storage buffer, so it is
 * sized by what is actually in it. There is no second copy of a length to
 * keep in sync and no end to run past. `instances.test.ts` asserts the
 * cap has not crept back.
 */

/**
 * Writes one entity into slot `index` of a packed instance array.
 *
 * `out` may be longer than the live entity count; callers reuse a scratch
 * buffer across frames and pass the count separately, so this must touch
 * exactly the eight floats belonging to `index` and nothing else.
 *
 * The tint is four loose numbers with defaults rather than a colour
 * object, and that is [D11] rather than taste: this is the per-entity
 * per-frame path, and a `{r, g, b}` parameter is one JS object per entity
 * per frame. [V11] measured what a single unexamined allocation on this
 * path costs - 57.76 MB over 2,394 frames, from a two-element array.
 */
export function writeInstance(
  out: Float32Array,
  index: number,
  screenX: number,
  screenY: number,
  depth: number,
  sprite: number,
  tintR: number = TINT_NONE,
  tintG: number = TINT_NONE,
  tintB: number = TINT_NONE,
  emissive: number = EMISSIVE_NONE,
): void {
  const base = index * FLOATS_PER_INSTANCE;
  out[base + OFFSET_SCREEN_X] = screenX;
  out[base + OFFSET_SCREEN_Y] = screenY;
  out[base + OFFSET_DEPTH] = depth;
  out[base + OFFSET_SPRITE] = sprite;
  out[base + OFFSET_TINT_R] = tintR;
  out[base + OFFSET_TINT_G] = tintG;
  out[base + OFFSET_TINT_B] = tintB;
  out[base + OFFSET_EMISSIVE] = emissive;
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
