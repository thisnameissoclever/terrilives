import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  EMISSIVE_NONE,
  FLOATS_PER_INSTANCE,
  BYTES_PER_INSTANCE,
  TINT_ATTRIBUTE_OFFSET,
  TINT_NONE,
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
  it('packs an instance as screenX, screenY, depth, sprite, then the tint', () => {
    const out = new Float32Array(FLOATS_PER_INSTANCE);
    writeInstance(out, 0, 12, 34, 0.25, 1, 0.5, 0.625, 0.75, 0.875);

    // Eight distinguishable values in eight distinguishable slots: any
    // permutation of the fields moves at least two of these assertions.
    expect(out[0]).toBe(12);
    expect(out[1]).toBe(34);
    expect(out[2]).toBe(0.25);
    expect(out[3]).toBe(1);
    expect(out[4]).toBe(0.5);
    expect(out[5]).toBe(0.625);
    expect(out[6]).toBe(0.75);
    expect(out[7]).toBe(0.875);
  });

  it('defaults an untinted instance to white and non-emissive', () => {
    // The identity of the fragment shader's multiply. Every caller that
    // does not care about colour omits these, and this is what says that
    // omitting them draws exactly what was drawn before the attribute
    // existed - a default of 0 would black out the entire game.
    const out = new Float32Array(FLOATS_PER_INSTANCE).fill(-1);
    writeInstance(out, 0, 12, 34, 0.25, 1);

    expect(Array.from(out.subarray(4, 8))).toEqual([
      TINT_NONE,
      TINT_NONE,
      TINT_NONE,
      EMISSIVE_NONE,
    ]);
    expect(TINT_NONE).toBe(1);
    expect(EMISSIVE_NONE).toBe(0);
  });

  it('addresses instance slots by index without disturbing its neighbours', () => {
    // Sentinel-filled so "untouched" is observable. A packer that dropped
    // the stride and wrote at `index` instead of `index * 4` would land in
    // slot 0's territory and leave slot 2 at the sentinel.
    const out = new Float32Array(4 * FLOATS_PER_INSTANCE).fill(-1);
    writeInstance(out, 2, 7, 8, 0.5, 0, 0.25, 0.5, 0.75, 1);

    expect(Array.from(out.subarray(16, 24))).toEqual([
      7, 8, 0.5, 0, 0.25, 0.5, 0.75, 1,
    ]);
    // Precondition and the actual claim in one: everything else is still
    // the sentinel, so the write was confined to slot 2.
    expect(Array.from(out.subarray(0, 16))).toEqual(Array(16).fill(-1));
    expect(Array.from(out.subarray(24, 32))).toEqual(Array(8).fill(-1));
  });

  it('sizes one instance at eight contiguous f32s, tint included', () => {
    // The vertex buffer arrayStride. A stride that disagrees with the
    // packer reads each entity's fields from a sliding offset into its
    // neighbour, which is a smear rather than a crash.
    expect(BYTES_PER_INSTANCE).toBe(32);
    expect(BYTES_PER_INSTANCE).toBe(FLOATS_PER_INSTANCE * 4);
    // The second attribute starts where the first one ends. This is the
    // number `createRenderPipeline` is given for `shaderLocation: 1`, and
    // it is the one place the two halves of the instance are related by
    // arithmetic rather than by adjacency in a struct.
    expect(TINT_ATTRIBUTE_OFFSET).toBe(16);
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

  it('declares two instance attributes totalling FLOATS_PER_INSTANCE', () => {
    const position = shader.match(/@location\(0\)\s+instance:\s*vec(\d)<f32>/);
    const tint = shader.match(/@location\(1\)\s+tint:\s*vec(\d)<f32>/g);
    // Rule 5: without these the regexes could stop matching after a
    // harmless rename and the test would pass while comparing nothing.
    expect(position).not.toBeNull();
    expect(tint).not.toBeNull();
    // Two vec4s, and the packer's stride has to be their sum. A shader
    // that declared vec3 for either would read each instance's fields
    // from a sliding offset into its neighbour.
    expect(Number(position![1])).toBe(4);
    const tintWidth = shader.match(/@location\(1\)\s+tint:\s*vec(\d)<f32>/);
    expect(Number(tintWidth![1])).toBe(4);
    expect(4 + 4).toBe(FLOATS_PER_INSTANCE);
  });

  it('multiplies by the instance tint and lets emissive resist the hour', () => {
    // [ML-tint]. There is no GPU in CI, so reading the shader as text is
    // the only thing standing between "the attribute is declared" and
    // "the attribute does something". Both halves are asserted because
    // they fail differently: a missing multiply loses every recolour
    // silently, while a missing mix turns every lamp off at dusk.
    expect(
      shader.includes('colour.rgb * in.tint.rgb'),
      'the fragment must multiply by the per-instance tint',
    ).toBe(true);
    expect(
      /mix\(u\.ambient\.rgb,\s*vec3f\(1\.0\),\s*in\.tint\.w\)/.test(shader),
      'emissive must lift this instance out of the ambient, toward white',
    ).toBe(true);
    // The tint has to be applied AFTER the discard, or the alpha test
    // threshold moves with it and sprite edges erode as night falls.
    const discard = shader.indexOf('discard;');
    expect(discard).toBeGreaterThan(-1);
    expect(shader.indexOf('in.tint.rgb')).toBeGreaterThan(discard);
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

  it('sizes its sprite table at runtime rather than capping it', () => {
    // [ML-sprites]. This used to assert the opposite: a fixed 128-entry
    // uniform array whose length lived in two files at once, kept equal
    // by reading the shader as text from here.
    //
    // That cap was a silent failure waiting to happen. WGSL CLAMPS an
    // out-of-range index rather than trapping, so the first sprite past
    // the end would have drawn as the last one in the table - forever,
    // with no error, and only for the sprites added most recently. Four
    // facings per object is enough to reach it.
    //
    // A runtime-sized array in a storage buffer has no length to keep in
    // sync and no end to run past, so what is asserted now is that the
    // cap has not crept back.
    expect(
      shader.includes('array<Sprite>'),
      'the atlas table must stay runtime-sized',
    ).toBe(true);
    expect(
      shader.includes('var<storage, read> atlas'),
      'a runtime-sized array is only legal in a storage binding',
    ).toBe(true);
    expect(
      shader.match(/const MAX_SPRITES/),
      'the fixed cap must not come back without this test being rewritten',
    ).toBeNull();
  });

  it('samples the atlas and discards below the alpha threshold', () => {
    // The discard is what makes the transparent part of a sprite
    // genuinely see-through. The pipeline writes depth, so without it
    // every quad's transparent bounding box would claim its pixels and a
    // bed would occlude a rectangle of floor and anything standing in
    // it. There is no GPU in CI, so this is the only thing standing
    // between that and a play session.
    expect(shader).toMatch(/textureSample\(/);
    expect(shader).toMatch(/discard;/);
  });
});
