import { beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.js';
import * as atlas from '../src/render/atlas.js';
import { packSpriteTable } from '../src/render/sprites.js';
import { pickSprite, type PickSource } from '../src/input.js';
import { buildInstances } from '../src/frame.js';
import { FLOATS_PER_INSTANCE } from '../src/render/instances.js';
import { writePlacementPreview } from '../src/render/placement-preview.js';
import { buildLightField, emissiveForSprite, sampleLight } from '../src/render/lighting.js';

let memory: WebAssembly.Memory;
beforeAll(async () => {
  memory = (await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') })).memory;
});

it.each(['', 'NW', 'SW', 'NE'])('registers the lamp facing %s without pickable padding', suffix => {
  const index = atlas.spriteIndex(`offlineFloorLamp${suffix}`);
  expect(index).toBe(1346 + ['', 'NW', 'SW', 'NE'].indexOf(suffix));
  expect([...packSpriteTable().slice(index * 8 + 4, index * 8 + 6)]).toEqual([96, 120]);
  expect(atlas.SPRITES[index].pixel_density).toBe(2);
  expect(atlas.SPRITE_ANCHORS[index][0]).toBeCloseTo(48, 4);
  expect(atlas.SPRITE_ANCHORS[index][1]).toBeCloseTo(116.000437, 4);
  const source: PickSource = {
    count: 1, positions: () => new Float32Array([0, 0]),
    kinds: () => new Uint32Array([1]), ids: () => new Uint32Array([15]),
    sprites: () => new Uint32Array([index]), activities: () => new Uint32Array([0]),
  };
  expect(pickSprite(source, 0, -36, 0, 0)).toEqual({ entity: 15, isAgent: false });
  expect(pickSprite(source, 0, -105, 0, 0)).toBeNull();
  expect(pickSprite(source, 47, -32, 0, 0)).toBeNull();
  expect(atlas.SPRITE_PAIRS[index]).toBeUndefined();
  expect(atlas.INTERACTION_SPRITES[index]).toBeUndefined();
  expect(emissiveForSprite(index)).toBeCloseTo(.85);
});

it('preserves lamp identity, save round trips and illumination in every direction', () => {
  const handle = SimHandle.from_lot();
  try {
    const sim = new SimBridge(handle, memory);
    expect(sim.objectName(15)).toBe('Illumination, Ambient');
    expect(sim.interactionLabels(15)).toEqual([]);
    expect(sim.catalogue().find(row => row.name === 'Illumination, Ambient')).toMatchObject({
      price: 45, facings: 15, baseFacing: 0,
    });
    for (const [facing, suffix] of ['', 'SW', 'NW', 'NE'].entries()) {
      const index = atlas.spriteIndex('offlineFloorLamp' + suffix);
      expect(sim.placementPreview(15, 14, 2, facing)).toMatchObject({ valid: true, width: 1, depth: 1, sprite: index });
      expect(sim.placeObject(15, 14, 2, facing)).toBe(true);
      sim.flushCommands();
      expect(sim.lastPlacementResult()).toEqual({ object: 15, reason: null });
      const save = sim.saveBytes();
      expect(sim.loadBytes(save)).toBe(true);
      expect(sim.saveBytes()).toEqual(save);
      const row = Array.from(sim.ids()).indexOf(15);
      expect([...sim.positions().slice(row * 2, row * 2 + 2)]).toEqual([14, 2]);
      expect([sim.footprintWidths()[row], sim.footprintDepths()[row]]).toEqual([1, 1]);
      expect(sim.sprites()[row]).toBe(index);
      expect(sim.objectFacing(15)).toBe(facing);
      expect(sim.foregroundSprites()[row]).toBe(0xffffffff);
      const light = buildLightField(sim, 16, 12, sim.wallTiles(), true, sim.wallEdges());
      expect(sampleLight(light, 14, 2)).toBeCloseTo(.35, 6);
    }
  } finally { handle.free(); }
});

it('preserves lamp recolouring and emissive brightness in placement previews', () => {
  const handle = SimHandle.from_lot();
  try {
    const sim = new SimBridge(handle, memory);
    const row = Array.from(sim.ids()).indexOf(15);
    for (let colourway = 0; colourway < sim.colourwayNames().length; colourway++) {
      expect(sim.setColourway(15, colourway)).toBe(true);
      sim.flushCommands();
      const out = buildInstances(sim, 1, 0, 0, 16);
      expect(out[row * FLOATS_PER_INSTANCE + 7]).toBeCloseTo(.85);
      const shifts = [...out.slice(row * FLOATS_PER_INSTANCE + 12, row * FLOATS_PER_INSTANCE + 15)];
      const expected = [...sim.colourwayShifts().slice(colourway * 3, colourway * 3 + 3)];
      expected[1] -= 1;
      shifts.forEach((value, index) => expect(value).toBeCloseTo(expected[index], 5));
      const preview = new Float32Array(2 * FLOATS_PER_INSTANCE);
      expect(writePlacementPreview(preview, 0, sim.placementPreview(15, 14, 2, 0),
        0, 0, 16, 1, null, sim.colourwayShifts(), colourway)).toBe(2);
      expect(preview[FLOATS_PER_INSTANCE + 3]).toBe(atlas.spriteIndex('offlineFloorLamp'));
      expect(preview[FLOATS_PER_INSTANCE + 7]).toBeCloseTo(.85);
      expect([...preview.slice(FLOATS_PER_INSTANCE + 12, FLOATS_PER_INSTANCE + 15)]).toEqual(shifts);
    }
  } finally { handle.free(); }
});
