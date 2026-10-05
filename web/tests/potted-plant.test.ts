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

it.each(['', 'NW', 'SW', 'NE'])('registers the plant facing %s without extra layers or emission', suffix => {
  const index = atlas.spriteIndex(`offlinePottedPlant${suffix}`);
  expect(index).toBe(1354 + ['', 'NW', 'SW', 'NE'].indexOf(suffix));
  expect([...packSpriteTable().slice(index * FLOATS_PER_SPRITE + 4, index * FLOATS_PER_SPRITE + 6)]).toEqual([96, 120]);
  expect(atlas.SPRITES[index].pixel_density).toBe(2);
  expect(atlas.SPRITE_ANCHORS[index][0]).toBeCloseTo(48, 4);
  expect(atlas.SPRITE_ANCHORS[index][1]).toBeCloseTo(116.000437, 4);
  const source: PickSource = {
    count: 1, positions: () => new Float32Array([0, 0]),
    kinds: () => new Uint32Array([1]), ids: () => new Uint32Array([13]),
    sprites: () => new Uint32Array([index]), activities: () => new Uint32Array([0]),
  };
  expect(pickSprite(source, 0, -20, 0, 0)).toEqual({ entity: 13, isAgent: false });
  expect(pickSprite(source, 0, -105, 0, 0)).toBeNull();
  expect(pickSprite(source, 47, -20, 0, 0)).toBeNull();
  expect(atlas.SPRITE_PAIRS[index]).toBeUndefined();
  expect(atlas.INTERACTION_SPRITES[index]).toBeUndefined();
  expect(emissiveForSprite(index)).toBe(0);
});

it.each([[13, 15, 0], [28, 10, 11]])('preserves plant %i placement, identity and saved facings', (id, x, y) => {
  const handle = SimHandle.from_lot();
  try {
    const sim = new SimBridge(handle, memory);
    expect(sim.objectName(id)).toBe('Ficus, Under Review');
    expect(sim.interactionLabels(id)).toEqual([]);
    expect(sim.catalogue().find(row => row.name === 'Ficus, Under Review')).toMatchObject({
      price: 30, facings: 15, baseFacing: 0,
    });
    for (const [facing, suffix] of ['', 'SW', 'NW', 'NE'].entries()) {
      const index = atlas.spriteIndex('offlinePottedPlant' + suffix);
      expect(sim.placementPreview(id, x, y, facing)).toMatchObject({ valid: true, width: 1, depth: 1, sprite: index });
      expect(sim.placeObject(id, x, y, facing)).toBe(true);
      sim.flushCommands();
      expect(sim.lastPlacementResult()).toEqual({ object: id, reason: null });
      const save = sim.saveBytes();
      expect(sim.loadBytes(save)).toBe(true);
      expect(sim.saveBytes()).toEqual(save);
      const row = Array.from(sim.ids()).indexOf(id);
      expect([...sim.positions().slice(row * 2, row * 2 + 2)]).toEqual([x, y]);
      expect([sim.footprintWidths()[row], sim.footprintDepths()[row]]).toEqual([1, 1]);
      expect(sim.sprites()[row]).toBe(index);
      expect(sim.objectFacing(id)).toBe(facing);
      expect(sim.foregroundSprites()[row]).toBe(0xffffffff);
    }
  } finally { handle.free(); }
});

it('keeps the two plants independent during rotation, recolouring and Build preview', () => {
  const handle = SimHandle.from_lot();
  try {
    const sim = new SimBridge(handle, memory);
    const first = Array.from(sim.ids()).indexOf(13), other = Array.from(sim.ids()).indexOf(28);
    for (let facing = 0; facing < 4; facing++) {
      sim.placeObject(13, 15, 0, facing); sim.flushCommands();
      expect(sim.objectFacing(28)).toBe(0);
      for (let colourway = 0; colourway < sim.colourwayNames().length; colourway++) {
        expect(sim.setColourway(13, colourway)).toBe(true); sim.flushCommands();
        expect(sim.objectColourway(28)).toBe(0);
        const normal = buildInstances(sim, 1, 0, 0, 16).slice();
        const preview = sim.placementPreview(13, 15, 0, facing);
        const shown = buildInstances(sim, 1, 0, 0, 16, 13, 1, false, 0,
          null, undefined, preview, null, colourway);
        const body = instanceCount(sim, 13, undefined, preview) - 1;
        expect([...shown.slice(first * STRIDE, first * STRIDE + 2)]).toEqual([-1e6, -1e6]);
        expect([...shown.slice(other * STRIDE, (other + 1) * STRIDE)])
          .toEqual([...normal.slice(other * STRIDE, (other + 1) * STRIDE)]);
        expect(shown[body * STRIDE + 3]).toBe(sim.sprites()[first]);
        expect(shown[body * STRIDE + 7]).toBe(0);
        expect([...shown.slice(body * STRIDE + 12, body * STRIDE + 15)])
          .toEqual([...normal.slice(first * STRIDE + 12, first * STRIDE + 15)]);
      }
    }
  } finally { handle.free(); }
});
