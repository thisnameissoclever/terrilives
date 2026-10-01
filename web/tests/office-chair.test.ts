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

it.each(['', 'NW', 'SW', 'NE'])('registers the desk chair without pickable blank margins: %s', suffix => {
  const index = atlas.spriteIndex(`offlineDeskChair${suffix}`);
  expect(index).toBe(1246 + ['', 'NW', 'SW', 'NE'].indexOf(suffix));
  expect([...packSpriteTable().slice(index * 8 + 4, index * 8 + 6)]).toEqual([96, 120]);
  expect(atlas.SPRITES[index].pixel_density).toBe(2);
  expect(atlas.SPRITE_ANCHORS[index][0]).toBeCloseTo(48, 4);
  expect(atlas.SPRITE_ANCHORS[index][1]).toBeCloseTo(116.000437, 4);
  const source: PickSource = {
    count: 1,
    positions: () => new Float32Array([0, 0]),
    kinds: () => new Uint32Array([1]),
    ids: () => new Uint32Array([24]),
    sprites: () => new Uint32Array([index]),
    activities: () => new Uint32Array([0]),
  };
  expect(pickSprite(source, 0, -24, 0, 0)).toEqual({ entity: 24, isAgent: false });
  expect(pickSprite(source, 0, -100, 0, 0)).toBeNull();
  expect(pickSprite(source, 46, -24, 0, 0)).toBeNull();
  expect(atlas.SPRITE_PAIRS[index]).toBeUndefined();
  expect(atlas.INTERACTION_SPRITES[index]).toBeUndefined();
});

it('uses the new art in the real lot and previews all rotations without changing the save', () => {
  const handle = SimHandle.from_lot();
  try {
    const bridge = new SimBridge(handle, memory);
    const row = Array.from(bridge.ids()).findIndex(id => bridge.objectName(id) === 'Ergonomic, Allegedly');
    expect(row).toBeGreaterThanOrEqual(0);
    const id = bridge.ids()[row];
    expect([...bridge.positions().slice(row * 2, row * 2 + 2)]).toEqual([6, 7]);
    expect([bridge.footprintWidths()[row], bridge.footprintDepths()[row]]).toEqual([1, 1]);
    expect(bridge.objectFacing(id)).toBe(2);
    expect(bridge.objectFacingMask(id)).toBe(15);
    expect(bridge.sprites()[row]).toBe(atlas.spriteIndex('offlineDeskChairNW'));
    expect(bridge.catalogue().find(item => item.name === 'Ergonomic, Allegedly')).toMatchObject({
      price: 60, facings: 15, baseFacing: 0,
    });
    const before = bridge.saveBytes();
    for (const [facing, suffix] of ['', 'SW', 'NW', 'NE'].entries()) {
      expect(bridge.placementPreview(id, 6, 7, facing)).toMatchObject({
        valid: true, width: 1, depth: 1, sprite: atlas.spriteIndex(`offlineDeskChair${suffix}`),
      });
    }
    expect(bridge.saveBytes()).toEqual(before);
    expect(bridge.loadBytes(before)).toBe(true);
    expect(bridge.objectFacing(id)).toBe(2);
    expect(bridge.sprites()[row]).toBe(atlas.spriteIndex('offlineDeskChairNW'));
    expect([...bridge.positions().slice(row * 2, row * 2 + 2)]).toEqual([6, 7]);
  } finally {
    handle.free();
  }
});
