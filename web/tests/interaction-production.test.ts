import { beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.js';
import { buildInstances, instanceCount, simShirtVariant } from '../src/frame.js';
import { FLOATS_PER_INSTANCE } from '../src/render/instances.js';
import { INTERACTION_SPRITES, SPRITES, SPRITE_ANCHORS, SPRITE_PAIRS,
  SPRITE_CONTENT_BOUNDS, spriteIndex } from '../src/render/atlas.js';

let memory: WebAssembly.Memory;
beforeAll(async () => {
  memory = (await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') })).memory;
});

it('contains all registered production facings, palettes and samples after the stable prefix', () => {
  expect(Object.keys(INTERACTION_SPRITES)).toHaveLength(8);
  expect(Object.keys(SPRITE_PAIRS)).toHaveLength(144);
  for (const [object, action, count] of [['Bike', 6, 8], ['Chair', 3, 4]] as const) {
    for (const facing of ['', 'NW', 'SW', 'NE']) {
      const empty = spriteIndex(`offline${object}${facing}`);
      expect(empty).toBeGreaterThanOrEqual(847);
      const profile = INTERACTION_SPRITES[empty];
      expect(profile.action).toBe(action);
      for (const variant of ['blue', 'red', 'green'] as const) {
        expect(profile.frames[variant]).toHaveLength(count);
        for (const body of profile.frames[variant]) {
          const pair = SPRITE_PAIRS[body];
          expect(pair).toBeDefined();
          expect(SPRITE_CONTENT_BOUNDS[body][1]).toBeGreaterThan(0);
          for (const index of [body, pair.furniture, pair.outline]) {
            expect(index).toBeGreaterThanOrEqual(855);
            expect([SPRITES[index].w, SPRITES[index].h, SPRITES[index].pixel_density]).toEqual([192, 240, 2]);
            expect(SPRITE_ANCHORS[index]).toEqual(SPRITE_ANCHORS[empty]);
          }
        }
      }
    }
  }
});

it.each([['moving_box', 'offlineBike', 6], ['reading_chair', 'offlineChair', 3]] as const)(
  'compiled %s selects its exact occupied pair and restores the empty body', (object, sprite, action) => {
    const handle = new SimHandle(16, 16);
    const source = new SimBridge(handle, memory);
    try {
      expect(source.spawnObject(4, 4, object)).toBe(true);
      source.spawnAgent(3, 4, 50);
      const objectId = source.ids()[0];
      const agentId = source.ids()[1];
      expect(source.sprites()[0]).toBe(spriteIndex(sprite));
      expect(source.foregroundSprites()[0]).toBe(0xffffffff);
      expect(source.useObject(agentId, objectId, 0)).toBe(true);
      let active = false;
      for (let tick = 0; tick < 100; tick++) {
        source.tick();
        if (source.visualActions()[1] !== action) continue;
        active = true;
        expect(source.interactionTargets()[1]).toBe(objectId);
        const data = buildInstances(source, 1, 0, 0, 16, null, 1, false, source.clockTick());
        expect(data[0]).toBe(-1e6);
        const body = data[FLOATS_PER_INSTANCE + 3];
        const profile = INTERACTION_SPRITES[spriteIndex(sprite)];
        expect(profile.frames[simShirtVariant(source.simIds()[1])]).toContain(body);
        expect(instanceCount(source, null)).toBe(3); // Two rows and the activity bubble.
        break;
      }
      expect(active).toBe(true);
      expect(source.cancelIntents(agentId)).toBe(true);
      source.tick();
      const data = buildInstances(source, 1, 0, 0, 16, null, 1, true, source.clockTick());
      expect(data[3]).toBe(spriteIndex(sprite));
      expect(data[0]).not.toBe(-1e6);
    } finally {
      handle.free();
    }
  },
);
