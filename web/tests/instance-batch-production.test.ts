import { readFileSync } from 'node:fs';
import { transpile, ScriptTarget } from 'typescript';
import { expect, it, vi } from 'vitest';
import * as frame from '../src/frame.js';
import { FLOATS_PER_INSTANCE, OFFSET_SPRITE } from '../src/render/instances.js';
import { spriteIndex } from '../src/render/atlas.js';

it('uploads the floor-tool highlight through the actual main packing and draw statements without recounting', () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const start = main.indexOf('    const selected = builder.active');
  const end = main.indexOf('    // Inside the sample below', start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  // Execute the shipped boundary, not a second implementation of its wiring.
  const code = transpile(main.slice(start, end), { target: ScriptTarget.ES2022 });
  const ints = new Uint32Array(0), floats = new Float32Array(0);
  const sim = { count: 0, positions: () => floats, prevPositions: () => floats,
    ids: () => ints, kinds: () => ints, sprites: () => ints, activities: () => ints,
    visualActions: () => ints, facings: () => ints, carrying: () => ints,
    itemKinds: () => [], selectedIndex: () => null, clockTick: () => 37 };
  const highlight = { tiles: [[2, 3], [3, 3]], valid: true };
  const draw = vi.fn<(instances: Float32Array, count: number, scale: number) => void>();
  const recount = vi.fn(frame.instanceCount);
  const pack = vi.fn(frame.buildInstanceBatch);
  const bindings = { ...frame, buildInstanceBatch: pack, instanceCount: recount, sim, alpha: 1,
    camera: { originX: 100, originY: 50, scale: 2 }, depthScale: 16,
    reducedMotion: { matches: true }, lightingMode: { isFlat: () => true },
    lighting: null, builder: { active: false, preview: null },
    buyTool: { ghost: () => null }, wallTool: { highlight: () => null },
    roomTool: { highlight: () => null }, floorTool: { highlight: () => highlight },
    sky: { width: 0, height: 0, values: floats }, AMBIENT_NEUTRAL: 1,
    wallFade: { update: vi.fn() }, deltaMs: 16, renderer: { draw },
    interiorDaylightShade: 0 };
  new Function(...Object.keys(bindings), code)(...Object.values(bindings));
  expect(pack).toHaveBeenCalledExactlyOnceWith(sim, 1, 100, 50, 16, null, 2,
    true, 37, null, undefined, null, highlight, 0, bindings.sky);
  expect(draw).toHaveBeenCalledTimes(1);
  const [instances, count, scale] = draw.mock.calls[0];
  expect(count).toBe(2);
  expect(scale).toBe(2);
  expect(Array.from(instances.subarray(0, count * FLOATS_PER_INSTANCE)).filter(
    (_: number, i: number) => i % FLOATS_PER_INSTANCE === OFFSET_SPRITE,
  )).toEqual([spriteIndex('selectionRing'), spriteIndex('selectionRing')]);
  expect([instances[0], instances[1], instances[FLOATS_PER_INSTANCE], instances[FLOATS_PER_INSTANCE + 1]])
    .toEqual([36, 260, 100, 302]);
  expect(recount).not.toHaveBeenCalled();
  expect(main).not.toMatch(/\binstanceCount\b/);
});
