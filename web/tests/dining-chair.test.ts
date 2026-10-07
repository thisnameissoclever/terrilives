import { beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.js';
import * as atlas from '../src/render/atlas.js';
import { packSpriteTable, FLOATS_PER_SPRITE } from '../src/render/sprites.js';
import { pickSprite, type PickSource } from '../src/input.js';

let memory: WebAssembly.Memory;
beforeAll(async () => {
  memory = (await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') })).memory;
});

it.each(['', 'NW', 'SW', 'NE'])('registers the dining chair without pickable blank margins: %s', suffix => {
  const index = atlas.spriteIndex(`offlineDiningChair${suffix}`);
  expect(index).toBe(1250 + ['', 'NW', 'SW', 'NE'].indexOf(suffix));
  expect([...packSpriteTable().slice(index * FLOATS_PER_SPRITE + 4, index * FLOATS_PER_SPRITE + 6)]).toEqual([96, 120]);
  expect(atlas.SPRITES[index].pixel_density).toBe(2);
  expect(atlas.SPRITE_ANCHORS[index][0]).toBeCloseTo(48, 4);
  expect(atlas.SPRITE_ANCHORS[index][1]).toBeCloseTo(116.000437, 4);
  const source: PickSource = {
    count: 1,
    positions: () => new Float32Array([0, 0]),
    kinds: () => new Uint32Array([1]),
    ids: () => new Uint32Array([8]),
    sprites: () => new Uint32Array([index]),
    activities: () => new Uint32Array([0]),
  };
  expect(pickSprite(source, 0, -24, 0, 0)).toEqual({ entity: 8, isAgent: false });
  expect(pickSprite(source, 0, -100, 0, 0)).toBeNull();
  expect(pickSprite(source, 46, -24, 0, 0)).toBeNull();
  expect(atlas.SPRITE_PAIRS[index]).toBeUndefined();
  expect(atlas.INTERACTION_SPRITES[index].action).toBe(13);
  expect(atlas.INTERACTION_SPRITES[index].frames.green).toHaveLength(8);
});

it('keeps both chairs facing the table and preserves their saved placement through every preview', () => {
  const handle = SimHandle.from_lot();
  try {
    const bridge = new SimBridge(handle, memory);
    const before = bridge.saveBytes();
    const chairs = Array.from(bridge.ids()).filter(id => bridge.objectModel(id)?.id === 'chair');
    expect(chairs).toEqual([8, 9]);
    for (const [id, x, facing, suffix] of [[8, 1, 3, 'NE'], [9, 4, 1, 'SW']] as const) {
      const row = Array.from(bridge.ids()).indexOf(id);
      expect([...bridge.positions().slice(row * 2, row * 2 + 2)]).toEqual([x, 3]);
      expect([bridge.footprintWidths()[row], bridge.footprintDepths()[row]]).toEqual([1, 1]);
      expect(bridge.objectFacing(id)).toBe(facing);
      expect(bridge.objectFacingMask(id)).toBe(15);
      expect(bridge.sprites()[row]).toBe(atlas.spriteIndex(`offlineDiningChair${suffix}`));
      for (const [rotation, end] of ['', 'SW', 'NW', 'NE'].entries()) {
        expect(bridge.placementPreview(id, x, 3, rotation)).toMatchObject({
          valid: true, width: 1, depth: 1, sprite: atlas.spriteIndex(`offlineDiningChair${end}`),
        });
      }
    }
    expect(bridge.catalogue().find(item => item.model?.id === 'chair')).toMatchObject({
      price: 40, facings: 15, baseFacing: 0,
    });
    expect(bridge.saveBytes()).toEqual(before);
    expect(bridge.loadBytes(before)).toBe(true);
    for (const [id, suffix] of [[8, 'NE'], [9, 'SW']] as const) {
      const row = Array.from(bridge.ids()).indexOf(id);
      expect(bridge.sprites()[row]).toBe(atlas.spriteIndex(`offlineDiningChair${suffix}`));
    }
  } finally {
    handle.free();
  }
});
