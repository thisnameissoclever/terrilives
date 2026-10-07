import { beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.js';
import * as atlas from '../src/render/atlas.js';
import { packSpriteTable, FLOATS_PER_SPRITE } from '../src/render/sprites.js';
import { pickSprite, type PickSource } from '../src/input.js';
import { buildInstances } from '../src/frame.js';
import { FLOATS_PER_INSTANCE } from '../src/render/instances.js';
import { writePlacementPreview } from '../src/render/placement-preview.js';

let memory: WebAssembly.Memory;
beforeAll(async () => {
  memory = (await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') })).memory;
});

it.each(['', 'NW', 'SW', 'NE'])('registers the long sofa with unpickable padding: %s', suffix => {
  const index = atlas.spriteIndex(`offlineLongSofa${suffix}`);
  expect(index).toBe(1258 + ['', 'NW', 'SW', 'NE'].indexOf(suffix));
  expect([...packSpriteTable().slice(index * FLOATS_PER_SPRITE + 4, index * FLOATS_PER_SPRITE + 6)]).toEqual([160, 176]);
  expect(atlas.SPRITES[index].pixel_density).toBe(2);
  expect(atlas.SPRITE_ANCHORS[index][0]).toBeCloseTo(80, 4);
  expect(atlas.SPRITE_ANCHORS[index][1]).toBeCloseTo(144.000437, 4);
  const source: PickSource = {
    count: 1, positions: () => new Float32Array([0, 0]),
    kinds: () => new Uint32Array([1]), ids: () => new Uint32Array([11]),
    sprites: () => new Uint32Array([index]), activities: () => new Uint32Array([0]),
  };
  expect(pickSprite(source, 0, -24, 0, 0)).toEqual({ entity: 11, isAgent: false });
  expect(pickSprite(source, 0, -110, 0, 0)).toBeNull();
  expect(pickSprite(source, 79, -24, 0, 0)).toBeNull();
  expect(atlas.SPRITE_PAIRS[index]).toBeUndefined();
  expect(atlas.INTERACTION_SPRITES[index]).toBeUndefined();
});

it('preserves sofa identity, placement, price and interaction metadata', () => {
  const handle = SimHandle.from_lot();
  try {
    const sim = new SimBridge(handle, memory);
    const before = sim.saveBytes();
    const row = Array.from(sim.ids()).indexOf(11);
    expect(sim.objectName(11)).toBe('Sofa');
    expect([...sim.positions().slice(row * 2, row * 2 + 2)]).toEqual([10.5, 0]);
    expect([sim.footprintWidths()[row], sim.footprintDepths()[row]]).toEqual([2, 1]);
    expect(sim.objectFacing(11)).toBe(0);
    expect(sim.objectFacingMask(11)).toBe(15);
    expect(sim.sprites()[row]).toBe(atlas.spriteIndex('offlineLongSofa'));
    expect(sim.foregroundSprites()[row]).toBe(0xffffffff);
    expect(sim.interactionLabels(11)).toEqual(['Lie down', 'Sit', 'Read a book']);
    expect(sim.catalogue().find(item => item.model?.id === 'long_sofa')).toMatchObject({
      price: 300, facings: 15, baseFacing: 0,
    });
    expect(sim.saveBytes()).toEqual(before);
  } finally {
    handle.free();
  }
});

it('identifies Lie down and draws the accepted static whole-sofa recline pose', () => {
  const handle = SimHandle.from_lot();
  try {
    const sim = new SimBridge(handle, memory);
    expect(sim.useObjectFirst(34, 11, 0)).toBe(true);
    let observed = false;
    for (let tick = 0; tick < 1200 && !observed; tick++) {
      sim.tick();
      if (sim.activityOf(34) !== 15) continue;
      const row = Array.from(sim.ids()).indexOf(34);
      expect(sim.actionQueueOf(34).join(' ')).toContain('Lie down');
      expect(sim.visualActions()[row]).toBe(0);
      expect(sim.interactionTargets()[row]).toBe(0xffffffff);
      expect(sim.seatedFurniture()[row]).toBe(11);
      expect(sim.seatedWhole()[row]).toBe(1);
      const instances = buildInstances(sim, 1, 0, 0, 16);
      const sprite = instances[row * FLOATS_PER_INSTANCE + 3];
      expect(atlas.SPRITES[sprite].name).toMatch(/^ownedReading_recline_SE_0_1$/);
      const furnitureRow = Array.from(sim.ids()).indexOf(11);
      expect(instances[furnitureRow * FLOATS_PER_INSTANCE]).toBe(-1e6);
      observed = true;
    }
    expect(observed).toBe(true);
  } finally {
    handle.free();
  }
});

it('places and reloads every sofa facing without changing footprint or colourway', () => {
  const handle = SimHandle.from_lot();
  try {
    const sim = new SimBridge(handle, memory);
    expect(sim.setColourway(11, 2)).toBe(true);
    sim.flushCommands();
    for (const [facing, suffix, width, depth, x, y] of [
      [0, '', 2, 1, 10.5, 0], [1, 'SW', 1, 2, 10, .5],
      [2, 'NW', 2, 1, 10.5, 0], [3, 'NE', 1, 2, 10, .5],
    ] as const) {
      expect(sim.placementPreview(11, 10, 0, facing)).toMatchObject({
        valid: true, width, depth, sprite: atlas.spriteIndex(`offlineLongSofa${suffix}`),
      });
      expect(sim.placeObject(11, 10, 0, facing)).toBe(true);
      sim.flushCommands();
      expect(sim.lastPlacementResult()).toEqual({ object: 11, reason: null });
      expect(sim.loadBytes(sim.saveBytes())).toBe(true);
      const row = Array.from(sim.ids()).indexOf(11);
      expect([...sim.positions().slice(row * 2, row * 2 + 2)]).toEqual([x, y]);
      expect([sim.footprintWidths()[row], sim.footprintDepths()[row]]).toEqual([width, depth]);
      expect(sim.objectFacing(11)).toBe(facing);
      expect(sim.objectColourway(11)).toBe(2);
      expect(sim.sprites()[row]).toBe(atlas.spriteIndex(`offlineLongSofa${suffix}`));
    }
  } finally {
    handle.free();
  }
});

it('colours both the placed sofa and its Build preview through the real frame writers', () => {
  const handle = SimHandle.from_lot();
  try {
    const sim = new SimBridge(handle, memory);
    const row = Array.from(sim.ids()).indexOf(11);
    for (let colourway = 0; colourway < sim.colourwayNames().length; colourway++) {
      expect(sim.setColourway(11, colourway)).toBe(true);
      sim.flushCommands();
      const out = buildInstances(sim, 1, 0, 0, 16);
      const shifts = [...out.slice(row * FLOATS_PER_INSTANCE + 12, row * FLOATS_PER_INSTANCE + 15)];
      expect(out[row * FLOATS_PER_INSTANCE + 3]).toBe(atlas.spriteIndex('offlineLongSofa'));
      const expected = [...sim.colourwayShifts().slice(colourway * 3, colourway * 3 + 3)];
      expected[1] -= 1;
      shifts.forEach((value, index) => expect(value).toBeCloseTo(expected[index], 5));
      const preview = new Float32Array(3 * FLOATS_PER_INSTANCE);
      expect(writePlacementPreview(preview, 0, sim.placementPreview(11, 10, 0, 0),
        0, 0, 16, 1, null, sim.colourwayShifts(), colourway)).toBe(3);
      expect(preview[2 * FLOATS_PER_INSTANCE + 3]).toBe(atlas.spriteIndex('offlineLongSofa'));
      expect([...preview.slice(2 * FLOATS_PER_INSTANCE + 12, 2 * FLOATS_PER_INSTANCE + 15)]).toEqual(shifts);
    }
  } finally {
    handle.free();
  }
});
