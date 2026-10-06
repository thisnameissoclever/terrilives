import { beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.js';
import * as atlas from '../src/render/atlas.js';
import { packSpriteTable, FLOATS_PER_SPRITE } from '../src/render/sprites.js';
import { pickSprite, type PickSource } from '../src/input.js';
import { buildInstances, instanceCount } from '../src/frame.js';
import { FLOATS_PER_INSTANCE as STRIDE } from '../src/render/instances.js';
import { emissiveForSprite } from '../src/render/lighting.js';

let memory: WebAssembly.Memory;
beforeAll(async () => {
  memory = (await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') })).memory;
});

it.each(['', 'NW', 'SW', 'NE'])('registers and picks the wall-aligned bookcase facing %s', suffix => {
  const index = atlas.spriteIndex(`offlineBookcase${suffix}`);
  expect(index).toBe(1366 + ['', 'NW', 'SW', 'NE'].indexOf(suffix));
  expect([...packSpriteTable().slice(index * FLOATS_PER_SPRITE + 4, index * FLOATS_PER_SPRITE + 6)]).toEqual([96, 120]);
  expect(atlas.SPRITES[index].pixel_density).toBe(2);
  expect(atlas.SPRITE_ANCHORS[index][0]).toBeCloseTo(48, 4);
  expect(atlas.SPRITE_ANCHORS[index][1]).toBeCloseTo(116.000437, 4);
  const source: PickSource = {
    count: 1, positions: () => new Float32Array([0, 0]),
    kinds: () => new Uint32Array([1]), ids: () => new Uint32Array([10]),
    sprites: () => new Uint32Array([index]), activities: () => new Uint32Array([0]),
  };
  const centreX = ['', 'NE'].includes(suffix) ? -11.5 : 11.5;
  expect(pickSprite(source, centreX, -45, 0, 0)).toEqual({ entity: 10, isAgent: false });
  expect(pickSprite(source, centreX, -90, 0, 0)).toBeNull();
  expect(pickSprite(source, 47, -45, 0, 0)).toBeNull();
  // Empty floor must not pick the tall cabinet.
  expect(pickSprite(source, 0, 24, 0, 0)).toBeNull();
  expect(atlas.SPRITE_PAIRS[index]).toBeUndefined();
  expect(atlas.INTERACTION_SPRITES[index]).toBeUndefined();
  expect(emissiveForSprite(index)).toBe(0);
});

it('preserves bookcase reading, placement, colours and saves through all four rotations', () => {
  const handle = SimHandle.from_lot();
  try {
    const sim = new SimBridge(handle, memory);
    expect(sim.objectName(10)).toBe('Bookcase');
    expect(sim.interactionLabels(10)).toEqual(['Read a book']);
    expect(sim.catalogue().find(row => row.model?.id === 'bookshelf')).toMatchObject({
      price: 100, facings: 15, baseFacing: 0,
    });
    for (const [facing, suffix] of ['', 'SW', 'NW', 'NE'].entries()) {
      const index = atlas.spriteIndex('offlineBookcase' + suffix);
      expect(sim.placementPreview(10, 8, 0, facing)).toMatchObject({ valid: true, width: 1, depth: 1, sprite: index });
      expect(sim.placeObject(10, 8, 0, facing)).toBe(true); sim.flushCommands();
      expect(sim.lastPlacementResult()).toEqual({ object: 10, reason: null });
      for (let colourway = 0; colourway < sim.colourwayNames().length; colourway++) {
        expect(sim.setColourway(10, colourway)).toBe(true); sim.flushCommands();
        const save = sim.saveBytes(), hash = sim.worldHash(), tick = sim.clockTick();
        expect(sim.loadBytes(save)).toBe(true);
        expect(sim.saveBytes()).toEqual(save);
        expect(sim.worldHash()).toBe(hash);
        expect(sim.clockTick()).toBe(tick);
        const row = Array.from(sim.ids()).indexOf(10);
        expect([...sim.positions().slice(row * 2, row * 2 + 2)]).toEqual([8, 0]);
        expect([sim.footprintWidths()[row], sim.footprintDepths()[row]]).toEqual([1, 1]);
        expect(sim.sprites()[row]).toBe(index);
        expect(sim.objectFacing(10)).toBe(facing);
        expect(sim.objectColourway(10)).toBe(colourway);
        expect(sim.colourways()[row]).toBe(colourway);
        expect(sim.foregroundSprites()[row]).toBe(0xffffffff);
        const normal = buildInstances(sim, 1, 0, 0, 16).slice();
        const preview = sim.placementPreview(10, 8, 0, facing);
        const shown = buildInstances(sim, 1, 0, 0, 16, 10, 1, false, 0,
          null, undefined, preview, null, colourway);
        const body = instanceCount(sim, 10, undefined, preview) - 1;
        expect([...shown.slice(row * STRIDE, row * STRIDE + 2)]).toEqual([-1e6, -1e6]);
        expect(shown[body * STRIDE + 3]).toBe(index);
        expect([...shown.slice(body * STRIDE + 12, body * STRIDE + 15)])
          .toEqual([...normal.slice(row * STRIDE + 12, row * STRIDE + 15)]);
        expect(sim.interactionLabels(10)).toEqual(['Read a book']);
      }
    }
  } finally { handle.free(); }
});


it('projects owned standing reading and restores its authoritative journey', () => {
  const handle = new SimHandle(64, 64);
  try {
    const sim = new SimBridge(handle, memory);
    const fixture = Uint8Array.from(readFileSync('tests/fixtures/owned-reading-standing.sav'));
    expect(sim.loadBytes(fixture)).toBe(true);
    const row = Array.from(sim.ids()).indexOf(1);
    expect(sim.activityOf(1)).toBe(8);
    expect(sim.visualActions()[row]).toBe(4);
    expect(sim.readingStatusOf(1)).toContain('Reading:');
    expect(sim.bookCopies()[0].location.kind).toBe('carried');
    expect([...sim.positions().slice(row*2, row*2+2)]).not.toEqual([11.5, 13.25]);
    expect(sim.loadBytes(sim.saveBytes())).toBe(true);
    expect(sim.visualActions()[Array.from(sim.ids()).indexOf(1)]).toBe(4);
  } finally { handle.free(); }
});
