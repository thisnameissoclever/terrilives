import { beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.js';
import * as atlas from '../src/render/atlas.js';
import { packSpriteTable } from '../src/render/sprites.js';
import { pickSprite, type PickSource } from '../src/input.js';

let memory: WebAssembly.Memory;
beforeAll(async () => {
  memory = (await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') })).memory;
});

it.each(['', 'NW', 'SW', 'NE'])('registers the wide table with unpickable padding: %s', suffix => {
  const index = atlas.spriteIndex(`offlineDiningTable${suffix}`);
  expect(index).toBe(1254 + ['', 'NW', 'SW', 'NE'].indexOf(suffix));
  expect([...packSpriteTable().slice(index * 8 + 4, index * 8 + 6)]).toEqual([160, 176]);
  expect(atlas.SPRITES[index].pixel_density).toBe(2);
  expect(atlas.SPRITE_ANCHORS[index][0]).toBeCloseTo(80, 4);
  expect(atlas.SPRITE_ANCHORS[index][1]).toBeCloseTo(144.000437, 4);
  const source: PickSource = {
    count: 1, positions: () => new Float32Array([0, 0]),
    kinds: () => new Uint32Array([1]), ids: () => new Uint32Array([7]),
    sprites: () => new Uint32Array([index]), activities: () => new Uint32Array([0]),
  };
  expect(pickSprite(source, 0, -24, 0, 0)).toEqual({ entity: 7, isAgent: false });
  expect(pickSprite(source, 0, -110, 0, 0)).toBeNull();
  expect(pickSprite(source, 79, -24, 0, 0)).toBeNull();
  expect(atlas.SPRITE_PAIRS[index]).toBeUndefined();
  expect(atlas.INTERACTION_SPRITES[index]).toBeUndefined();
});

it('retains the table identity, price, saved center and all four rectangular rotations', () => {
  const handle = SimHandle.from_lot();
  try {
    const bridge = new SimBridge(handle, memory);
    const before = bridge.saveBytes();
    const row = Array.from(bridge.ids()).indexOf(7);
    expect(bridge.objectName(7)).toBe('Dining table');
    expect([...bridge.positions().slice(row * 2, row * 2 + 2)]).toEqual([2.5, 3]);
    expect([bridge.footprintWidths()[row], bridge.footprintDepths()[row]]).toEqual([2, 1]);
    expect(bridge.objectFacing(7)).toBe(0);
    expect(bridge.objectFacingMask(7)).toBe(15);
    expect(bridge.sprites()[row]).toBe(atlas.spriteIndex('offlineDiningTable'));
    for (const [rotation, suffix, width, depth] of [
      [0, '', 2, 1], [1, 'SW', 1, 2], [2, 'NW', 2, 1], [3, 'NE', 1, 2],
    ] as const) {
      expect(bridge.placementPreview(7, 2, 3, rotation)).toMatchObject({
        valid: true, width, depth, sprite: atlas.spriteIndex(`offlineDiningTable${suffix}`),
      });
    }
    expect(bridge.catalogue().find(item => item.name === 'Dining table')).toMatchObject({
      price: 120, facings: 15, baseFacing: 0,
    });
    expect(bridge.saveBytes()).toEqual(before);
    expect(bridge.loadBytes(before)).toBe(true);
    expect(bridge.sprites()[Array.from(bridge.ids()).indexOf(7)]).toBe(atlas.spriteIndex('offlineDiningTable'));
  } finally {
    handle.free();
  }
});

it('places and reloads every table rotation with the correct center and footprint', () => {
  const handle = SimHandle.from_lot();
  try {
    const bridge = new SimBridge(handle, memory);
    for (const [facing, suffix, width, depth, x, y] of [
      [0, '', 2, 1, 2.5, 3], [1, 'SW', 1, 2, 2, 3.5],
      [2, 'NW', 2, 1, 2.5, 3], [3, 'NE', 1, 2, 2, 3.5],
    ] as const) {
      expect(bridge.placeObject(7, 2, 3, facing)).toBe(true);
      bridge.flushCommands();
      expect(bridge.lastPlacementResult()).toEqual({ object: 7, reason: null });
      const saved = bridge.saveBytes();
      expect(bridge.loadBytes(saved)).toBe(true);
      const row = Array.from(bridge.ids()).indexOf(7);
      expect([...bridge.positions().slice(row * 2, row * 2 + 2)]).toEqual([x, y]);
      expect([bridge.footprintWidths()[row], bridge.footprintDepths()[row]]).toEqual([width, depth]);
      expect(bridge.objectFacing(7)).toBe(facing);
      expect(bridge.sprites()[row]).toBe(atlas.spriteIndex(`offlineDiningTable${suffix}`));
    }
  } finally {
    handle.free();
  }
});
