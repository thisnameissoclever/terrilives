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

let memory: WebAssembly.Memory;
beforeAll(async () => {
  memory = (await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') })).memory;
});

const media = [
  { id: 17, name: 'Cathode Companion', prefix: 'offlineTelevision', start: 1262,
    x: 10, y: 3, price: 350, action: 'Watch TV' },
  { id: 16, name: 'Frequency of Record', prefix: 'offlineRadio', start: 1266,
    x: 8, y: 3, price: 60, action: 'Listen to the radio' },
] as const;

for (const item of media) {
  it.each(['', 'NW', 'SW', 'NE'])(`${item.prefix} registers its facing %s without pickable padding`, suffix => {
    const index = atlas.spriteIndex(`${item.prefix}${suffix}`);
    expect(index).toBe(item.start + ['', 'NW', 'SW', 'NE'].indexOf(suffix));
    expect([...packSpriteTable().slice(index * 8 + 4, index * 8 + 6)]).toEqual([96, 120]);
    expect(atlas.SPRITES[index].pixel_density).toBe(2);
    expect(atlas.SPRITE_ANCHORS[index][0]).toBeCloseTo(48, 4);
    expect(atlas.SPRITE_ANCHORS[index][1]).toBeCloseTo(116.000437, 4);
    const source: PickSource = {
      count: 1, positions: () => new Float32Array([0, 0]),
      kinds: () => new Uint32Array([1]), ids: () => new Uint32Array([item.id]),
      sprites: () => new Uint32Array([index]), activities: () => new Uint32Array([0]),
    };
    expect(pickSprite(source, 0, item.id === 16 ? -12 : -24, 0, 0))
      .toEqual({ entity: item.id, isAgent: false });
    expect(pickSprite(source, 0, -105, 0, 0)).toBeNull();
    expect(pickSprite(source, 47, -32, 0, 0)).toBeNull();
    expect(atlas.SPRITE_PAIRS[index]).toBeUndefined();
    expect(atlas.INTERACTION_SPRITES[index]).toBeUndefined();
  });

  it(`${item.prefix} preserves identity and every placed/saved facing`, () => {
    const handle = SimHandle.from_lot();
    try {
      const sim = new SimBridge(handle, memory);
      expect(sim.objectName(item.id)).toBe(item.name);
      expect(sim.interactionLabels(item.id)).toEqual([item.action]);
      expect(sim.catalogue().find(row => row.name === item.name)).toMatchObject({
        price: item.price, facings: 15, baseFacing: 0,
      });
      expect(sim.objectFacing(item.id)).toBe(0);
      for (const [facing, suffix] of ['', 'SW', 'NW', 'NE'].entries()) {
        const index = atlas.spriteIndex(item.prefix + suffix);
        expect(sim.placementPreview(item.id, item.x, item.y, facing)).toMatchObject({
          valid: true, width: 1, depth: 1, sprite: index,
        });
        expect(sim.placeObject(item.id, item.x, item.y, facing)).toBe(true);
        sim.flushCommands();
        expect(sim.lastPlacementResult()).toEqual({ object: item.id, reason: null });
        const save = sim.saveBytes();
        expect(sim.loadBytes(save)).toBe(true);
        expect(sim.saveBytes()).toEqual(save);
        const row = Array.from(sim.ids()).indexOf(item.id);
        expect([...sim.positions().slice(row * 2, row * 2 + 2)]).toEqual([item.x, item.y]);
        expect([sim.footprintWidths()[row], sim.footprintDepths()[row]]).toEqual([1, 1]);
        expect(sim.sprites()[row]).toBe(index);
        expect(sim.objectFacing(item.id)).toBe(facing);
        expect(sim.foregroundSprites()[row]).toBe(0xffffffff);
      }
    } finally { handle.free(); }
  });

  it(`${item.prefix} colours the actual placed and preview frame instances`, () => {
    const handle = SimHandle.from_lot();
    try {
      const sim = new SimBridge(handle, memory);
      const row = Array.from(sim.ids()).indexOf(item.id);
      for (let colourway = 0; colourway < sim.colourwayNames().length; colourway++) {
        expect(sim.setColourway(item.id, colourway)).toBe(true);
        sim.flushCommands();
        const out = buildInstances(sim, 1, 0, 0, 16);
        const shifts = [...out.slice(row * FLOATS_PER_INSTANCE + 12, row * FLOATS_PER_INSTANCE + 15)];
        const expected = [...sim.colourwayShifts().slice(colourway * 3, colourway * 3 + 3)];
        expected[1] -= 1;
        shifts.forEach((value, index) => expect(value).toBeCloseTo(expected[index], 5));
        const preview = new Float32Array(2 * FLOATS_PER_INSTANCE);
        expect(writePlacementPreview(preview, 0, sim.placementPreview(item.id, item.x, item.y, 0),
          0, 0, 16, 1, null, sim.colourwayShifts(), colourway)).toBe(2);
        expect(preview[FLOATS_PER_INSTANCE + 3]).toBe(atlas.spriteIndex(item.prefix));
        expect([...preview.slice(FLOATS_PER_INSTANCE + 12, FLOATS_PER_INSTANCE + 15)]).toEqual(shifts);
      }
    } finally { handle.free(); }
  });

  it(`${item.prefix} keeps the existing standing generic-use action and static art`, () => {
    const handle = SimHandle.from_lot();
    try {
      const sim = new SimBridge(handle, memory);
      expect(sim.useObjectFirst(34, item.id, 0)).toBe(true);
      let observed = false;
      for (let tick = 0; tick < 1200 && !observed; tick++) {
        sim.tick();
        if (sim.activityOf(34) !== 7 || !sim.actionQueueOf(34)[0]?.startsWith(item.action)) continue;
        const row = Array.from(sim.ids()).indexOf(34);
        expect(sim.actionQueueOf(34)[0]).toMatch(new RegExp(`^${item.action}`));
        expect(sim.visualActions()[row]).toBe(0);
        expect(sim.interactionTargets()[row]).toBe(0xffffffff);
        const instances = buildInstances(sim, 1, 0, 0, 16);
        expect(atlas.SPRITES[instances[row * FLOATS_PER_INSTANCE + 3]].name).toMatch(/^rigSimBlueIdle/);
        const objectRow = Array.from(sim.ids()).indexOf(item.id);
        expect(instances[objectRow * FLOATS_PER_INSTANCE + 3]).toBe(atlas.spriteIndex(item.prefix));
        observed = true;
      }
      expect(observed).toBe(true);
    } finally { handle.free(); }
  });
}
