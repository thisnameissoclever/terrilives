import { beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.js';
import * as atlas from '../src/render/atlas.js';
import { packSpriteTable } from '../src/render/sprites.js';
import { pickSprite, type PickSource } from '../src/input.js';
import { buildInstances, instanceCount } from '../src/frame.js';
import { FLOATS_PER_INSTANCE as STRIDE } from '../src/render/instances.js';
import { emissiveForSprite } from '../src/render/lighting.js';

let memory: WebAssembly.Memory;
beforeAll(async () => {
  memory = (await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') })).memory;
});

it.each(['', 'NW', 'SW', 'NE'])('registers and picks the closed bin facing %s', suffix => {
  const index = atlas.spriteIndex(`offlineTrashcan${suffix}`);
  expect(index).toBe(1362 + ['', 'NW', 'SW', 'NE'].indexOf(suffix));
  expect([...packSpriteTable().slice(index * 8 + 4, index * 8 + 6)]).toEqual([96, 120]);
  expect(atlas.SPRITES[index].pixel_density).toBe(2);
  expect(atlas.SPRITE_ANCHORS[index][0]).toBeCloseTo(48, 4);
  expect(atlas.SPRITE_ANCHORS[index][1]).toBeCloseTo(116.000437, 4);
  const source: PickSource = {
    count: 1, positions: () => new Float32Array([0, 0]),
    kinds: () => new Uint32Array([1]), ids: () => new Uint32Array([6]),
    sprites: () => new Uint32Array([index]), activities: () => new Uint32Array([0]),
  };
  expect(pickSprite(source, 0, -15, 0, 0)).toEqual({ entity: 6, isAgent: false });
  expect(pickSprite(source, 0, -70, 0, 0)).toBeNull();
  expect(pickSprite(source, 30, -15, 0, 0)).toBeNull();
  // Imported art excludes empty floor below it, unlike the old procedural canvas.
  expect(pickSprite(source, 0, 20, 0, 0)).toBeNull();
  expect(atlas.SPRITE_PAIRS[index]).toBeUndefined();
  expect(atlas.INTERACTION_SPRITES[index]).toBeUndefined();
  expect(emissiveForSprite(index)).toBe(0);
});

it('preserves bin scenery, placement, colours and saves through all four rotations', () => {
  const handle = SimHandle.from_lot();
  try {
    const sim = new SimBridge(handle, memory);
    expect(sim.objectName(6)).toBe('Receptacle for Later');
    expect(sim.interactionLabels(6)).toEqual([]);
    expect(sim.catalogue().find(row => row.name === 'Receptacle for Later')).toMatchObject({
      price: 20, facings: 15, baseFacing: 0,
    });
    for (const [facing, suffix] of ['', 'SW', 'NW', 'NE'].entries()) {
      const index = atlas.spriteIndex('offlineTrashcan' + suffix);
      expect(sim.placementPreview(6, 6, 0, facing)).toMatchObject({ valid: true, width: 1, depth: 1, sprite: index });
      expect(sim.placeObject(6, 6, 0, facing)).toBe(true); sim.flushCommands();
      expect(sim.lastPlacementResult()).toEqual({ object: 6, reason: null });
      for (let colourway = 0; colourway < sim.colourwayNames().length; colourway++) {
        expect(sim.setColourway(6, colourway)).toBe(true); sim.flushCommands();
        const save = sim.saveBytes(), hash = sim.worldHash(), tick = sim.clockTick();
        expect(sim.loadBytes(save)).toBe(true);
        expect(sim.saveBytes()).toEqual(save);
        expect(sim.worldHash()).toBe(hash);
        expect(sim.clockTick()).toBe(tick);
        const row = Array.from(sim.ids()).indexOf(6);
        expect([...sim.positions().slice(row * 2, row * 2 + 2)]).toEqual([6, 0]);
        expect([sim.footprintWidths()[row], sim.footprintDepths()[row]]).toEqual([1, 1]);
        expect(sim.sprites()[row]).toBe(index);
        expect(sim.objectFacing(6)).toBe(facing);
        expect(sim.objectColourway(6)).toBe(colourway);
        expect(sim.colourways()[row]).toBe(colourway);
        expect(sim.foregroundSprites()[row]).toBe(0xffffffff);
        const normal = buildInstances(sim, 1, 0, 0, 16).slice();
        const preview = sim.placementPreview(6, 6, 0, facing);
        const shown = buildInstances(sim, 1, 0, 0, 16, 6, 1, false, 0,
          null, undefined, preview, null, colourway);
        const body = instanceCount(sim, 6, undefined, preview) - 1;
        expect([...shown.slice(row * STRIDE, row * STRIDE + 2)]).toEqual([-1e6, -1e6]);
        expect(shown[body * STRIDE + 3]).toBe(index);
        expect([...shown.slice(body * STRIDE + 12, body * STRIDE + 15)])
          .toEqual([...normal.slice(row * STRIDE + 12, row * STRIDE + 15)]);
        expect(sim.interactionLabels(6)).toEqual([]);
      }
    }
  } finally { handle.free(); }
});
