import { describe, expect, it } from 'vitest';
import { writePortals, type PortalSource } from '../src/render/portals.js';
import {
  FLOATS_PER_INSTANCE, OFFSET_DEPTH, OFFSET_SPRITE, OFFSET_EMISSIVE,
  OFFSET_WALL_MASK, OFFSET_WALL_DEPTH_STEP,
  OFFSET_FOOTPRINT_SPAN,
} from '../src/render/instances.js';
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
    portalFarSides: () => new Float32Array([4, 2]),
  };

  it('places the body between frame and leaf and uses the reduced-motion column', () => {
    const out = new Float32Array(4 * FLOATS_PER_INSTANCE).fill(-999);
    expect(writePortals(out, 1, portal, 101, 53, 20, 2, false, null)).toBe(3);
    const frameBase = FLOATS_PER_INSTANCE;
    const leafBase = 2 * FLOATS_PER_INSTANCE;
    expect(Array.from(out.slice(frameBase, frameBase + OFFSET_SPRITE + 1))).toEqual([
      165, 263, Math.fround(layeredDepth(3.5, 2, 20, LAYER_PROP)), frame,
    ]);
    expect(out[leafBase + OFFSET_DEPTH]).toBe(Math.fround(layeredDepth(3.5, 2, 20, LAYER_FOREGROUND)));
    expect(out[leafBase + OFFSET_SPRITE]).toBe(closed);
    expect(out[frameBase + OFFSET_DEPTH]).toBeGreaterThan(layeredDepth(3.5, 2, 20, LAYER_SIM));
    expect(out[leafBase + OFFSET_DEPTH]).toBeLessThan(layeredDepth(3.5, 2, 20, LAYER_SIM));
    for (const base of [frameBase, leafBase]) {
      expect(out[base + OFFSET_WALL_MASK]).toBe(0);
      expect(out[base + OFFSET_WALL_DEPTH_STEP]).toBe(0);
      expect(Array.from(out.subarray(base + OFFSET_FOOTPRINT_SPAN, base + OFFSET_FOOTPRINT_SPAN + 2))).toEqual([0, 0]);
    }
    expect(out[0]).toBe(-999);
    expect(out[3 * FLOATS_PER_INSTANCE]).toBe(-999);
    writePortals(out, 1, portal, 101, 53, 20, 2, true, null);
    expect(out[leafBase + OFFSET_SPRITE]).toBe(open);
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
    expect(instances[OFFSET_SPRITE]).toBe(frame);
    expect(instances[FLOATS_PER_INSTANCE + OFFSET_SPRITE]).toBe(closed);
    for (const base of [0, FLOATS_PER_INSTANCE]) {
      expect(instances[base + OFFSET_WALL_MASK]).toBe(0);
      expect(instances[base + OFFSET_WALL_DEPTH_STEP]).toBe(0);
      expect(Array.from(instances.subarray(base + OFFSET_FOOTPRINT_SPAN, base + OFFSET_FOOTPRINT_SPAN + 2))).toEqual([0, 0]);
    }
    expect(source.count).toBe(0);
  });

  it('samples the door tile for both layers without leaving stale lighting', () => {
    const values = new Float32Array(36);
    values[(2 + 1) * 6 + (3 + 1)] = 0.375;
    const lighting = { width: 4, height: 4, stride: 6, values };
    const out = new Float32Array(2 * FLOATS_PER_INSTANCE).fill(-999);
    writePortals(out, 0, portal, 0, 0, 20, 1, false, lighting);
    expect(out[OFFSET_EMISSIVE]).toBe(0.375);
    expect(out[FLOATS_PER_INSTANCE + OFFSET_EMISSIVE]).toBe(0.375);
    writePortals(out, 0, portal, 0, 0, 20, 1, false, null);
    expect(out[OFFSET_EMISSIVE]).toBe(0);
    expect(out[FLOATS_PER_INSTANCE + OFFSET_EMISSIVE]).toBe(0);
  });

  // Review finding [F5] on the doors branch: a door read only the room on
  // its own tile, so between a lit room and a dark one it was darker than
  // the wall around it, which takes the brighter side.
  it('lights a portal from the brighter side of its line', () => {
    const lit = (own: number, far: number) => {
      const values = new Float32Array(36);
      values[(2 + 1) * 6 + (3 + 1)] = own;
      values[(2 + 1) * 6 + (4 + 1)] = far;
      const out = new Float32Array(2 * FLOATS_PER_INSTANCE);
      writePortals(out, 0, portal, 0, 0, 20, 1, false, { width: 4, height: 4, stride: 6, values });
      return [out[OFFSET_EMISSIVE], out[FLOATS_PER_INSTANCE + OFFSET_EMISSIVE]];
    };
    expect(lit(0.25, 0.5)).toEqual([0.5, 0.5]);
    expect(lit(0.5, 0.25)).toEqual([0.5, 0.5]);
  });
});
