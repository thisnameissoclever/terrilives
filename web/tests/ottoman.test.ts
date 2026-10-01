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

it.each(['', 'NW', 'SW', 'NE'])('registers ottoman facing %s without extra layers', suffix => {
  const index = atlas.spriteIndex(`offlineOttoman${suffix}`);
  expect(index).toBe(1358 + ['', 'NW', 'SW', 'NE'].indexOf(suffix));
  expect([...packSpriteTable().slice(index * 8 + 4, index * 8 + 6)]).toEqual([96, 120]);
  expect(atlas.SPRITES[index].pixel_density).toBe(2);
  expect(atlas.SPRITE_ANCHORS[index][0]).toBeCloseTo(48, 4);
  expect(atlas.SPRITE_ANCHORS[index][1]).toBeCloseTo(116.000437, 4);
  const source: PickSource = {
    count: 1, positions: () => new Float32Array([0, 0]),
    kinds: () => new Uint32Array([1]), ids: () => new Uint32Array([18]),
    sprites: () => new Uint32Array([index]), activities: () => new Uint32Array([0]),
  };
  expect(pickSprite(source, 0, -15, 0, 0)).toEqual({ entity: 18, isAgent: false });
  expect(pickSprite(source, 0, -105, 0, 0)).toBeNull();
  expect(pickSprite(source, 47, -15, 0, 0)).toBeNull();
  expect(atlas.SPRITE_PAIRS[index]).toBeUndefined();
  expect(atlas.INTERACTION_SPRITES[index]).toBeUndefined();
  expect(emissiveForSprite(index)).toBe(0);
});

it('preserves ottoman identity, footprint, facings, colours and saves', () => {
  const handle = SimHandle.from_lot();
  try {
    const sim = new SimBridge(handle, memory);
    expect(sim.objectName(18)).toBe('Chesterfield Regret');
    expect(sim.interactionLabels(18)).toEqual(['Sit down']);
    expect(sim.catalogue().find(row => row.name === 'Chesterfield Regret')).toMatchObject({
      price: 200, facings: 15, baseFacing: 0,
    });
    for (const [facing, suffix] of ['', 'SW', 'NW', 'NE'].entries()) {
      const index = atlas.spriteIndex('offlineOttoman' + suffix);
      expect(sim.placementPreview(18, 12, 3, facing)).toMatchObject({ valid: true, width: 1, depth: 1, sprite: index });
      expect(sim.placeObject(18, 12, 3, facing)).toBe(true); sim.flushCommands();
      expect(sim.lastPlacementResult()).toEqual({ object: 18, reason: null });
      for (let colourway = 0; colourway < sim.colourwayNames().length; colourway++) {
        expect(sim.setColourway(18, colourway)).toBe(true); sim.flushCommands();
        const save = sim.saveBytes();
        expect(sim.loadBytes(save)).toBe(true);
        expect(sim.saveBytes()).toEqual(save);
        const row = Array.from(sim.ids()).indexOf(18);
        expect([...sim.positions().slice(row * 2, row * 2 + 2)]).toEqual([12, 3]);
        expect([sim.footprintWidths()[row], sim.footprintDepths()[row]]).toEqual([1, 1]);
        expect(sim.sprites()[row]).toBe(index);
        expect(sim.objectFacing(18)).toBe(facing);
        expect(sim.objectColourway(18)).toBe(colourway);
        expect(sim.colourways()[row], `render colourway after restoring facing ${facing}`).toBe(colourway);
        expect(sim.foregroundSprites()[row]).toBe(0xffffffff);
        const normal = buildInstances(sim, 1, 0, 0, 16).slice();
        const preview = sim.placementPreview(18, 12, 3, facing);
        const shown = buildInstances(sim, 1, 0, 0, 16, 18, 1, false, 0,
          null, undefined, preview, null, colourway);
        const body = instanceCount(sim, 18, undefined, preview) - 1;
        expect([...shown.slice(row * STRIDE, row * STRIDE + 2)]).toEqual([-1e6, -1e6]);
        expect(shown[body * STRIDE + 3]).toBe(index);
        expect([...shown.slice(body * STRIDE + 12, body * STRIDE + 15)])
          .toEqual([...normal.slice(row * STRIDE + 12, row * STRIDE + 15)]);
      }
    }
  } finally { handle.free(); }
});

it('restores rendered colours immediately without draining a saved edit', () => {
  const handle = SimHandle.from_lot();
  try {
    const sim = new SimBridge(handle, memory);
    sim.setColourway(18, 2); sim.flushCommands();
    sim.setColourway(18, 3);
    const save = sim.saveBytes(), hash = sim.worldHash(), tick = sim.clockTick();
    expect(sim.loadBytes(save)).toBe(true);
    const row = Array.from(sim.ids()).indexOf(18);
    expect(sim.objectColourway(18)).toBe(2);
    expect(sim.colourways()[row]).toBe(2);
    expect(sim.saveBytes()).toEqual(save);
    expect(sim.worldHash()).toBe(hash);
    expect(sim.clockTick()).toBe(tick);
    sim.flushCommands();
    expect(sim.objectColourway(18)).toBe(3);
    expect(sim.colourways()[row]).toBe(3);
  } finally { handle.free(); }
});

it('identifies target-bound sitting without claiming a seated body pose', () => {
  const handle = SimHandle.from_lot();
  try {
    const sim = new SimBridge(handle, memory);
    sim.useObjectFirst(34, 18, 0);
    let found = false;
    for (let tick = 0; tick < 1200; tick++) {
      sim.tick();
      const first = sim.actionQueueOf(34)[0];
      if (sim.activityOf(34) === 11 && first === 'Sit down: Chesterfield Regret') {
        const row = Array.from(sim.ids()).indexOf(34);
        expect(sim.visualActions()[row]).toBe(0);
        expect(sim.interactionTargets()[row]).toBe(0xffffffff);
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  } finally { handle.free(); }
});
