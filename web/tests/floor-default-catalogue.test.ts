import { afterEach, expect, it, vi } from 'vitest';
import { ARCHITECTURE } from '../src/render/architecture-data.js';
import { architectureMode } from '../src/render/instances.js';
import { BAKED_FLOORS } from '../src/render/architecture-baked-floors.js';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

afterEach(() => { vi.doUnmock('../src/render/architecture-data.js'); vi.resetModules(); });

it('pins baked identities to the accepted source manifest and color bytes', () => {
  const bytes = readFileSync(new URL('../../assets/models/architecture/export/depth-reviewed-01/manifest.json', import.meta.url));
  const manifest = JSON.parse(bytes.toString());
  expect(BAKED_FLOORS.manifestSha256).toBe(createHash('sha256').update(bytes).digest('hex'));
  expect(BAKED_FLOORS.colorSha256).toBe(manifest.hashes.color);
  const sourcePatterns = [...new Set(manifest.sprites.filter((sprite: { kind: string }) => sprite.kind === 'floor-patch')
    .map((sprite: { patternKey: string }) => sprite.patternKey))].sort();
  expect(Object.keys(BAKED_FLOORS.finishes).sort()).toEqual(sourcePatterns);
  for (const [key, baked] of Object.entries(BAKED_FLOORS.finishes)) {
    expect(baked.finish).toEqual(manifest.catalogue.finishes[key]);
    expect(baked.pattern).toEqual(manifest.catalogue.patterns[baked.finish.patternKey]);
    expect(baked.palette).toEqual(manifest.catalogue.palettes[baked.finish.paletteKey]);
    expect(baked.patternSha256).toBe(manifest.patternResources[baked.pattern.resource].sha256);
  }
});

it.each(['palette', 'pattern'])('routes a default production catalogue %s addition through a prepared carrier finish', async kind => {
  const original = ARCHITECTURE.catalogue;
  const catalogue = { ...original,
    patterns: { ...original.patterns, fixture: { role: 'floor', period: [2, 3], resource: 'tiles' } },
    palettes: { ...original.palettes, blue: { multiply: [.2, .5, 1] } },
    finishes: { ...original.finishes, fixture: { patternKey: kind === 'palette' ? 'floor.tiles' : 'fixture',
      paletteKey: 'blue', authoredContentLook: [0, 1, 0] } },
    coverings: { ...original.coverings, 4: 'fixture' } };
  vi.resetModules();
  vi.doMock('../src/render/architecture-data.js', () => ({ ARCHITECTURE: { ...ARCHITECTURE, catalogue } }));
  const { floorMaterial, activeFloorFinishKeys } = await import('../src/render/floor-materials.js');
  const { prepareArchitectureFinishes } = await import('../src/render/architecture-finishes.js');
  const { buildStaticInstances } = await import('../src/render/tiles.js');
  const material = floorMaterial(4, 'house', 0, 0);
  expect(material.accepted).toBe(false);
  expect(material.sprite.name).toContain('neutral');
  const keys = activeFloorFinishKeys([0, 0, 4], null);
  expect(keys).toEqual(['fixture']);
  expect(floorMaterial(1, 'house', 0, 0).accepted).toBe(true);
  const finishes = prepareArchitectureFinishes(keys, { maxSampledTexturesPerShaderStage: 16,
    maxTextureDimension2D: 8192, maxTextureArrayLayers: 256, maxStorageBufferBindingSize: 1e8 });
  const rows = buildStaticInstances({ width: 1, height: 1, walls: new Uint32Array(), edges: new Uint32Array(),
    architecture: { windows: [], catalogue: [], finishes }, floors: new Uint32Array([0, 0, 4]),
    coveringLooks: Float32Array.from([18, 1.15, -.12, -25, .55, .1, -20, 1.6, -.18, 0, 1, 0]) }, 0, 0, 2);
  expect(rows.instances[8]).toBe(architectureMode(true, 1));
  expect(Array.from(finishes.table.slice(4, 7))).toEqual([Math.fround(.2), .5, 1]);
});

it('does not treat changed pattern bytes behind the same resource key as baked art', async () => {
  vi.resetModules();
  vi.doMock('../src/render/architecture-data.js', () => ({ ARCHITECTURE: { ...ARCHITECTURE,
    patterns: { ...ARCHITECTURE.patterns, carpet: { ...ARCHITECTURE.patterns.carpet, sha256: '0'.repeat(64) } } } }));
  const { floorMaterial, activeFloorFinishKeys } = await import('../src/render/floor-materials.js');
  expect(floorMaterial(3, 'house', 0, 0).accepted).toBe(false);
  expect(activeFloorFinishKeys([0, 0, 3], null)).toEqual(['floor.carpet']);
});
