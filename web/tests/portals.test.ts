import { describe, expect, it } from 'vitest';
import { writePortals, type PortalSource } from '../src/render/portals.js';
import { FLOATS_PER_INSTANCE } from '../src/render/instances.js';
import { LAYER_PROP, LAYER_FOREGROUND, LAYER_SIM, layeredDepth } from '../src/render/iso.js';
import { spriteIndex } from '../src/render/atlas.js';
import { buildInstances, instanceCount, type RenderSource } from '../src/frame.js';

describe('portal rendering', () => {
  const frame = spriteIndex('wallNS');
  const closed = spriteIndex('wallEW');
  const open = spriteIndex('floor');
  const portal: PortalSource = {
    portalCount: 1,
    portalPositions: () => new Float32Array([3, 2]),
    portalFrames: () => new Uint32Array([frame]),
    portalDepthOffsets: () => new Float32Array([0.5]),
    portalLeaves: reduced => new Uint32Array([reduced ? open : closed]),
  };

  it('places the body between frame and leaf and uses the reduced-motion column', () => {
    const out = new Float32Array(4 * FLOATS_PER_INSTANCE).fill(-999);
    expect(writePortals(out, 1, portal, 101, 53, 20, 2, false, null)).toBe(3);
    expect(Array.from(out.slice(8, 12))).toEqual([
      165, 263, Math.fround(layeredDepth(3.5, 2, 20, LAYER_PROP)), frame,
    ]);
    expect(out[18]).toBe(Math.fround(layeredDepth(3.5, 2, 20, LAYER_FOREGROUND)));
    expect(out[19]).toBe(closed);
    expect(out[10]).toBeGreaterThan(layeredDepth(3.5, 2, 20, LAYER_SIM));
    expect(out[18]).toBeLessThan(layeredDepth(3.5, 2, 20, LAYER_SIM));
    expect(out[0]).toBe(-999);
    expect(out[24]).toBe(-999);
    writePortals(out, 1, portal, 101, 53, 20, 2, true, null);
    expect(out[19]).toBe(open);
  });

  it('includes portal rows in the actual frame allocation and draw count', () => {
    const floats = new Float32Array(0);
    const ints = new Uint32Array(0);
    const source: RenderSource = {
      count: 0, positions: () => floats, prevPositions: () => floats,
      ids: () => ints, kinds: () => ints, sprites: () => ints,
      activities: () => ints, visualActions: () => ints, facings: () => ints,
      carrying: () => ints, itemKinds: () => [], portals: () => portal,
    };
    const instances = buildInstances(source, 0, 101, 53, 20);
    expect(instanceCount(source, null)).toBe(2);
    expect(instances.length).toBeGreaterThanOrEqual(2 * FLOATS_PER_INSTANCE);
    expect(instances[3]).toBe(frame);
    expect(instances[11]).toBe(closed);
    expect(source.count).toBe(0);
  });

  it('samples the door tile for both layers without leaving stale lighting', () => {
    const values = new Float32Array(36);
    values[(2 + 1) * 6 + (3 + 1)] = 0.375;
    const lighting = { width: 4, height: 4, stride: 6, values };
    const out = new Float32Array(16);
    writePortals(out, 0, portal, 0, 0, 20, 1, false, lighting);
    expect(out[7]).toBe(0.375);
    expect(out[15]).toBe(0.375);
    writePortals(out, 0, portal, 0, 0, 20, 1, false, null);
    expect(out[7]).toBe(0);
    expect(out[15]).toBe(0);
  });
});
