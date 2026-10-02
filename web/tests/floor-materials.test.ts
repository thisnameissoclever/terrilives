import { describe, expect, it } from 'vitest';
import { ARCHITECTURE } from '../src/render/architecture-data.js';
import { activeFloorFinishKeys, floorMaterial, floorSpriteName, relativeFloorLook } from '../src/render/floor-materials.js';
import { buildStaticInstances } from '../src/render/tiles.js';
import { prepareArchitectureFinishes } from '../src/render/architecture-finishes.js';
import { FLOOR_DEPTH } from '../src/render/iso.js';
import { architectureMode, FLOATS_PER_INSTANCE, OFFSET_WALL_MASK, OFFSET_COLOURWAY_HUE } from '../src/render/instances.js';

const looks = Float32Array.from([18, 1.15, -.12, -25, .55, .1, -20, 1.6, -.18]);
const lot = { width: 3, height: 2, walls: new Uint32Array(), edges: new Uint32Array(),
  house: [2, 2] as const, street: 2, yardLook: [65, 2, -.22] as const, streetLook: [0, .15, -.22] as const,
  architecture: { windows: [], catalogue: [] }, coveringLooks: looks };

describe('floor materials', () => {
  it('keeps saved covering identities and chooses world phases', () => {
    expect(floorSpriteName(1, 'house', 0, 0)).toContain('boards');
    expect(floorSpriteName(2, 'house', 0, 0)).toContain('tiles');
    expect(floorSpriteName(3, 'house', 0, 0)).toContain('carpet');
    expect(floorSpriteName(0, 'house', 0, 0)).toContain('neutral');
    expect(floorSpriteName(0, 'yard', 0, 0)).toContain('grass');
    expect(floorSpriteName(0, 'street', 0, 0)).toContain('street');
    expect(floorSpriteName(1, 'house', 4, 4)).toBe(floorSpriteName(1, 'house', 0, 0));
    expect(floorSpriteName(1, 'house', 1, 0)).not.toBe(floorSpriteName(1, 'house', 0, 0));
  });
  it.each([1, 2, 3])('preserves authored covering %s and composes content changes once', covering => {
    const material = floorMaterial(covering, 'house', 0, 0);
    const baseline = material.authoredContentLook;
    expect(relativeFloorLook(Float32Array.from(baseline), baseline)).toEqual([0, 1, 0]);
    const changed = [baseline[0] + 15, baseline[1] * .5, baseline[2] + .1];
    const actual = relativeFloorLook(changed, baseline);
    expect(actual[0]).toBeCloseTo(15);
    expect(actual[1]).toBeCloseTo(.5);
    expect(actual[2]).toBeCloseTo(.1);
  });
  it('resolves appended patterns and palettes without new geometry or saved ID changes', () => {
    const original = ARCHITECTURE.catalogue;
    const catalogue = { ...original,
      patterns: { ...original.patterns, 'floor.fixture': { role: 'floor' as const, period: [8, 2], resource: 'tiles' } },
      palettes: { ...original.palettes, blue: { multiply: [.3, .6, 1] } },
      finishes: { ...original.finishes, fixture: { patternKey: 'floor.fixture', paletteKey: 'blue', authoredContentLook: [0, 1, 0] } },
      coverings: { ...original.coverings, 4: 'fixture' } };
    const material = floorMaterial(4, 'house', 2, 3, catalogue);
    expect(material.finishKey).toBe('fixture');
    expect(material.accepted).toBe(false);
    expect(material.sprite.name).toContain('neutral');
    expect(material.pattern.resource).toBe('tiles');
    expect(material.palette.multiply).toEqual([.3, .6, 1]);
    expect(floorMaterial(1, 'house', 2, 3, catalogue).accepted).toBe(true);
    expect(activeFloorFinishKeys([0, 0, 1], null, catalogue)).toEqual([]);
    expect(activeFloorFinishKeys([0, 0, 1], 4, catalogue)).toEqual(['fixture']);
    const finishes = prepareArchitectureFinishes(['fixture'], { maxSampledTexturesPerShaderStage: 16,
      maxTextureDimension2D: 8192, maxTextureArrayLayers: 256, maxStorageBufferBindingSize: 1e8 }, catalogue);
    const built = buildStaticInstances({ ...lot, coveringLooks: Float32Array.from([...looks, 0, 1, 0]),
      floors: new Uint32Array([0, 0, 4, 1, 0, 1]), architecture: { ...lot.architecture, floorCatalogue: catalogue, finishes } }, 200.25, 100.5, 4, .73);
    expect(built.instances[OFFSET_WALL_MASK]).toBe(architectureMode(true, 1));
    expect(built.instances[FLOATS_PER_INSTANCE + OFFSET_WALL_MASK]).toBe(architectureMode(true));
    expect(built.instances[3]).toBe(floorMaterial(4, 'house', 0, 0, catalogue).sprite.id);
    expect(Array.from(finishes.table.slice(2, 7))).toEqual([8, 2, Math.fround(.3), Math.fround(.6), 1]);
    expect(() => buildStaticInstances({ ...lot, coveringLooks: Float32Array.from([...looks, 0, 1, 0]),
      floors: new Uint32Array([0, 0, 4]), architecture: { ...lot.architecture, floorCatalogue: catalogue } }, 0, 0, 4)).toThrow('not prepared');
  });
  it('writes one shared-depth canonical row per tile with identity accepted color', () => {
    const result = buildStaticInstances({ ...lot, floors: new Uint32Array([0, 0, 1, 1, 0, 2, 0, 1, 3]) }, 123.25, 67.75, 4, .731);
    expect(result.floorCount).toBe(6);
    for (let row = 0; row < result.floorCount; row++) {
      const base = row * FLOATS_PER_INSTANCE;
      expect(result.instances[base + 2]).toBe(FLOOR_DEPTH);
      expect(result.instances[base + OFFSET_WALL_MASK]).toBe(architectureMode(true));
      expect(Array.from(result.instances.slice(base + OFFSET_COLOURWAY_HUE, base + OFFSET_COLOURWAY_HUE + 3))).toEqual([0, 0, 0]);
    }
  });
  it('uses exactly the committed material for paint and Remove previews', () => {
    for (const covering of [0, 1, 2, 3]) {
      const preview = buildStaticInstances({ ...lot, floors: new Uint32Array([0, 0, 3]), floorPreview: [0, 0, covering] }, 100, 50, 4).instances.slice(0, 16);
      const committed = buildStaticInstances({ ...lot, floors: new Uint32Array(covering ? [0, 0, covering] : []) }, 100, 50, 4).instances.slice(0, 16);
      expect(preview).toEqual(committed);
    }
  });
  it('retains the historical sprite and content-transform path without opt-in', () => {
    const result = buildStaticInstances({ ...lot, architecture: undefined, floors: new Uint32Array([0, 0, 1]) }, 0, 0, 4);
    expect(result.instances[3]).toBeLessThan(ARCHITECTURE.baseSpriteId);
    expect(result.instances[OFFSET_WALL_MASK]).toBe(0);
    expect(result.instances[OFFSET_COLOURWAY_HUE]).toBe(18);
  });
});
