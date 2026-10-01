import { beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.js';
import * as atlas from '../src/render/atlas.js';
import { objectBodySprite, buildInstances, instanceCount } from '../src/frame.js';
import { FLOATS_PER_INSTANCE as STRIDE } from '../src/render/instances.js';
import { emissiveForSprite } from '../src/render/lighting.js';
import { pickSprite, type PickSource } from '../src/input.js';

let memory: WebAssembly.Memory;
beforeAll(async () => {
  memory = (await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') })).memory;
});

it.each(['', 'NW', 'SW', 'NE'])('keeps fish timing and the picking envelope for facing %s', suffix => {
  const zero = atlas.spriteIndex('offlineAquarium' + suffix);
  const one = atlas.spriteIndex('offlineAquariumFrame1' + suffix);
  for (const [tick, wanted] of [[0, zero], [23, zero], [24, one], [47, one], [48, zero]]) {
    expect(objectBodySprite(zero, tick, false)).toBe(wanted);
    expect(objectBodySprite(zero, tick, false)).toBe(wanted);
    expect(objectBodySprite(zero, tick, true)).toBe(zero);
  }
  expect(atlas.SPRITE_ANCHORS[zero]).toEqual(atlas.SPRITE_ANCHORS[one]);
  expect(atlas.SPRITE_CONTENT_BOUNDS[zero]).toEqual(atlas.SPRITE_CONTENT_BOUNDS[one]);
  for (const index of [zero, one]) {
    expect(atlas.SPRITES[index]).toMatchObject({ w: 192, h: 240, pixel_density: 2 });
    expect(emissiveForSprite(index)).toBe(0);
  }
  const source: PickSource = { count: 1, positions: () => new Float32Array([0, 0]),
    kinds: () => new Uint32Array([1]), ids: () => new Uint32Array([27]),
    sprites: () => new Uint32Array([zero]), activities: () => new Uint32Array([0]) };
  expect(pickSprite(source, 0, -25, 0, 0)).toEqual({ entity: 27, isAgent: false });
  expect(pickSprite(source, 47, -25, 0, 0)).toBeNull();
  expect(pickSprite(source, 0, 24, 0, 0)).toBeNull();
});

it('preserves aquarium placement, colours and save bytes through four rotations', () => {
  const handle = SimHandle.from_lot();
  try {
    const sim = new SimBridge(handle, memory);
    expect(sim.catalogue().find(row => row.name === 'Aquarium of Managed Expectations'))
      .toMatchObject({ price: 220, facings: 15, baseFacing: 0 });
    expect(sim.interactionLabels(27)).toEqual(['Watch the fish']);
    for (const [facing, suffix] of ['', 'SW', 'NW', 'NE'].entries()) {
      const index = atlas.spriteIndex('offlineAquarium' + suffix);
      expect(sim.placementPreview(27, 6, 10, facing)).toMatchObject({ valid: true, width: 1, depth: 1, sprite: index });
      expect(sim.placeObject(27, 6, 10, facing)).toBe(true); sim.flushCommands();
      expect(sim.lastPlacementResult()).toEqual({ object: 27, reason: null });
      for (let colour = 0; colour < sim.colourwayNames().length; colour++) {
        expect(sim.setColourway(27, colour)).toBe(true); sim.flushCommands();
        const save = sim.saveBytes(), hash = sim.worldHash(), tick = sim.clockTick();
        expect(sim.loadBytes(save)).toBe(true);
        expect(sim.saveBytes()).toEqual(save);
        expect(sim.worldHash()).toBe(hash);
        expect(sim.clockTick()).toBe(tick);
        const row = Array.from(sim.ids()).indexOf(27);
        expect([...sim.positions().slice(row*2, row*2+2)]).toEqual([6, 10]);
        expect([sim.footprintWidths()[row], sim.footprintDepths()[row]]).toEqual([1, 1]);
        expect(sim.sprites()[row]).toBe(index);
        expect(sim.objectFacing(27)).toBe(facing);
        expect(sim.objectColourway(27)).toBe(colour);
        const normal = buildInstances(sim, 1, 0, 0, 16).slice();
        const preview = sim.placementPreview(27, 6, 10, facing);
        const shown = buildInstances(sim, 1, 0, 0, 16, 27, 1, false, 0,
          null, undefined, preview, null, colour);
        const body = instanceCount(sim, 27, undefined, preview)-1;
        expect([...shown.slice(row*STRIDE, row*STRIDE+2)]).toEqual([-1e6, -1e6]);
        expect(shown[body*STRIDE+3]).toBe(index);
        expect([...shown.slice(body*STRIDE+12, body*STRIDE+15)])
          .toEqual([...normal.slice(row*STRIDE+12, row*STRIDE+15)]);
      }
    }
  } finally { handle.free(); }
});

it('keeps watching beside the tank and restores the same active action', () => {
  const handle = SimHandle.from_lot();
  try {
    const sim = new SimBridge(handle, memory);
    expect(sim.useObjectFirst(34, 27, 0)).toBe(true);
    let found = false;
    for (let tick = 0; tick < 1200; tick++) {
      sim.tick();
      if (sim.activityOf(34) !== 10 || sim.actionQueueOf(34)[0] !==
          'Watch the fish: Aquarium of Managed Expectations') continue;
      const save = sim.saveBytes(), hash = sim.worldHash();
      expect(sim.loadBytes(save)).toBe(true);
      expect(sim.saveBytes()).toEqual(save); expect(sim.worldHash()).toBe(hash);
      const row = Array.from(sim.ids()).indexOf(34);
      expect(sim.visualActions()[row]).toBe(7);
      expect(sim.activityOf(34)).toBe(10);
      expect(sim.interactionTargets()[row]).toBe(0xffffffff);
      expect([...sim.positions().slice(row*2, row*2+2)]).not.toEqual([6, 10]);
      found = true; break;
    }
    expect(found).toBe(true);
  } finally { handle.free(); }
});
