import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  FLOATS_PER_INSTANCE,
  BYTES_PER_INSTANCE,
  VERTICES_PER_QUAD,
  growCapacity,
  writeInstance,
} from '../src/render/instances.js';

// Node has no WebGPU, so nothing here touches a device. Mocking GPUDevice
// and asserting that createRenderPipeline was called would verify that the
// mock was called, not that anything renders; per docs/testing-protocol.md
// that is worse than no test, because it also removes the suspicion that
// would prompt someone to open a browser. These tests cover the parts of
// the renderer that are arithmetic. The GPU path is verified by running it.
const shader = readFileSync('src/render/sprites.wgsl', 'utf8');

describe('instance layout', () => {
  it('packs an instance as screenX, screenY, depth, kind in that order', () => {
    const out = new Float32Array(FLOATS_PER_INSTANCE);
    writeInstance(out, 0, 12, 34, 0.25, 1);

    // Four distinguishable values in four distinguishable slots: any
    // permutation of the fields moves at least two of these assertions.
    expect(out[0]).toBe(12);
    expect(out[1]).toBe(34);
    expect(out[2]).toBe(0.25);
    expect(out[3]).toBe(1);
  });

  it('addresses instance slots by index without disturbing its neighbours', () => {
    // Sentinel-filled so "untouched" is observable. A packer that dropped
    // the stride and wrote at `index` instead of `index * 4` would land in
    // slot 0's territory and leave slot 2 at the sentinel.
    const out = new Float32Array(4 * FLOATS_PER_INSTANCE).fill(-1);
    writeInstance(out, 2, 7, 8, 0.5, 0);

    expect(Array.from(out.subarray(8, 12))).toEqual([7, 8, 0.5, 0]);
    // Precondition and the actual claim in one: everything else is still
    // the sentinel, so the write was confined to slot 2.
    expect(Array.from(out.subarray(0, 8))).toEqual([-1, -1, -1, -1, -1, -1, -1, -1]);
    expect(Array.from(out.subarray(12, 16))).toEqual([-1, -1, -1, -1]);
  });

  it('sizes one instance at four contiguous f32s', () => {
    // The vertex buffer arrayStride. A stride that disagrees with the
    // packer reads each entity's fields from a sliding offset into its
    // neighbour, which is a smear rather than a crash.
    expect(BYTES_PER_INSTANCE).toBe(16);
    expect(BYTES_PER_INSTANCE).toBe(FLOATS_PER_INSTANCE * 4);
  });
});

describe('growCapacity', () => {
  it('keeps the current capacity when the count already fits', () => {
    expect(growCapacity(4096, 4096)).toBe(4096);
    expect(growCapacity(4096, 1)).toBe(4096);
    expect(growCapacity(4096, 0)).toBe(4096);
  });

  it('doubles past the requested count rather than fitting it exactly', () => {
    // The degenerate alternative this excludes: `capacity = needed`, which
    // satisfies "big enough" and reallocates a GPU buffer on every frame
    // that spawns one entity. One over the boundary is where the two
    // strategies first disagree.
    expect(growCapacity(4096, 4097)).toBe(8192);
    // And it keeps doubling rather than jumping straight to the count.
    expect(growCapacity(4096, 20_000)).toBe(32_768);
    expect(growCapacity(4096, 8192)).toBe(8192);
  });

  it('terminates and reaches a usable size from a zero capacity', () => {
    // Doubling zero is zero forever. Without the Math.max floor this call
    // hangs rather than failing, which is why it is asserted rather than
    // assumed.
    expect(growCapacity(0, 3)).toBe(4);
    expect(growCapacity(0, 0)).toBe(0);
  });
});

describe('sprites.wgsl contract', () => {
  // These read the shader as text. They cannot check that it means what it
  // says - only a GPU can do that - but they are the only mechanism tying
  // the TypeScript constants to the WGSL declarations, and CI has no GPU.

  it('declares an instance attribute exactly FLOATS_PER_INSTANCE wide', () => {
    const declared = shader.match(/@location\(0\)\s+instance:\s*vec(\d)<f32>/);
    // Rule 5: without this the regex could stop matching after a harmless
    // rename and the test would pass while comparing nothing.
    expect(declared).not.toBeNull();
    expect(Number(declared![1])).toBe(FLOATS_PER_INSTANCE);
  });

  it('builds its quad from exactly VERTICES_PER_QUAD corners', () => {
    // draw(VERTICES_PER_QUAD, count) indexes CORNERS by vertex_index. WGSL
    // clamps an out-of-range index instead of trapping, so a shorter array
    // silently collapses triangles rather than raising anything.
    const corners = shader.match(
      /const CORNERS = array<vec2<f32>,\s*(\d+)>\(([\s\S]*?)\);/,
    );
    expect(corners).not.toBeNull();
    expect(Number(corners![1])).toBe(VERTICES_PER_QUAD);
    expect(corners![2].match(/vec2f\(/g)?.length).toBe(VERTICES_PER_QUAD);
  });
});
