import { beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.js';
import { buildInstances, instanceCount, simShirtVariant } from '../src/frame.js';
import { FLOATS_PER_INSTANCE } from '../src/render/instances.js';
import { pickSprite } from '../src/input.js';
import { screenX, screenY, TILE_HALF_HEIGHT } from '../src/render/iso.js';
import { INTERACTION_SPRITES, SPRITES, SPRITE_ANCHORS, SPRITE_PAIRS,
  SPRITE_CONTENT_BOUNDS, spriteIndex } from '../src/render/atlas.js';

let memory: WebAssembly.Memory;
beforeAll(async () => {
  memory = (await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') })).memory;
});

it('contains all registered production facings, palettes and samples after the stable prefix', () => {
  expect(Object.keys(INTERACTION_SPRITES)).toHaveLength(16);
  expect(Object.keys(SPRITE_PAIRS)).toHaveLength(240);
  for (const [object, action, count] of [['Bike', 6, 8], ['Chair', 3, 4], ['Bunk', 9, 4], ['Armchair', 8, 4]] as const) {
    for (const facing of ['', 'NW', 'SW', 'NE']) {
      const empty = spriteIndex(`offline${object}${facing}`);
      expect(empty).toBeGreaterThanOrEqual(847);
      const profile = INTERACTION_SPRITES[empty];
      expect(profile.action).toBe(action);
      if (object === 'Bunk') expect(profile.halfCycleTicks).toBe(32);
      if (object === 'Armchair') expect(profile.halfCycleTicks).toBe(24);
      for (const variant of ['blue', 'red', 'green'] as const) {
        expect(profile.frames[variant]).toHaveLength(count);
        for (const body of profile.frames[variant]) {
          const pair = SPRITE_PAIRS[body];
          expect(pair).toBeDefined();
          expect(SPRITE_CONTENT_BOUNDS[body][1]).toBeGreaterThan(0);
          for (const index of [body, pair.furniture, pair.outline]) {
            expect(index).toBeGreaterThanOrEqual(855);
            expect([SPRITES[index].w, SPRITES[index].h, SPRITES[index].pixel_density]).toEqual(
              object === 'Bunk' ? [200, 272, 2] : [192, 240, 2]);
            expect(SPRITE_ANCHORS[index]).toEqual(SPRITE_ANCHORS[empty]);
          }
        }
      }
    }
  }
});

it.each([['moving_box', 'offlineBike', 6], ['reading_chair', 'offlineChair', 3], ['bed', 'offlineBunk', 9], ['armchair', 'offlineArmchair', 8]] as const)(
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
        // Sitting is text-only; the other three activities have a bubble.
        expect(instanceCount(source, null)).toBe(action === 8 ? 2 : 3);
        if (action === 9 || action === 8) {
          const [left,top,right,bottom] = SPRITE_CONTENT_BOUNDS[body];
          const [anchorX,anchorY] = SPRITE_ANCHORS[body];
          const [wx,wy] = source.positions();
          expect(pickSprite(source,
            screenX(wx,wy,0)+(left+right)/2-anchorX,
            screenY(wx,wy,0)+TILE_HALF_HEIGHT+(top+bottom)/2-anchorY,0,0,
          )).toEqual({entity:agentId,isAgent:true});
          const before = Array.from(data.slice(0, instanceCount(source,null)*FLOATS_PER_INSTANCE));
          // No simulation tick while paused must leave the exact drawn sample unchanged.
          expect(Array.from(buildInstances(source,1,0,0,16,null,1,false,source.clockTick())
            .slice(0,before.length))).toEqual(before);
          const still = buildInstances(source,1,0,0,16,null,1,true,source.clockTick());
          expect(still[FLOATS_PER_INSTANCE+3]).toBe(profile.frames[simShirtVariant(source.simIds()[1])][0]);
          const saved = source.saveBytes();
          for (let step=0; step<20; step++) source.tick();
          expect(source.loadBytes(saved)).toBe(true);
          expect(source.visualActions()[1]).toBe(action);
          expect(source.interactionTargets()[1]).toBe(objectId);
          expect(source.foregroundSprites()[0]).toBe(0xffffffff);
          expect(Array.from(buildInstances(source,1,0,0,16,null,1,false,source.clockTick())
            .slice(0,before.length))).toEqual(before);
        }
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

it.each(['', 'SW', 'NW', 'NE'])('uses every armchair sample and shirt in facing %s', suffix => {
  const variants = new Set<string>();
  for (let agentCount = 1; agentCount <= 3; agentCount++) {
    const handle = SimHandle.from_lot();
    const source = new SimBridge(handle, memory);
    try {
      const chair = 12;
      const chairRow = Array.from(source.ids()).indexOf(chair);
      const facing = ['', 'SW', 'NW', 'NE'].indexOf(suffix);
      expect(source.placeObject(chair, 13, 4, facing)).toBe(true);
      source.flushCommands();
      expect(source.lastPlacementResult()).toEqual({ object: chair, reason: null });
      const agent = 33 + agentCount;
      const row = Array.from(source.ids()).indexOf(agent);
      expect(source.useObjectFirst(agent, chair, 0)).toBe(true);
      for (let tick = 0; tick < 1200 && source.visualActions()[row] !== 8; tick++) source.tick();
      expect(source.visualActions()[row]).toBe(8);
      expect(source.interactionTargets()[row]).toBe(chair);
      const variant = simShirtVariant(source.simIds()[row]);
      variants.add(variant);
      const empty = spriteIndex(`offlineArmchair${suffix}`);
      expect(source.sprites()[chairRow]).toBe(empty);
      const profile = INTERACTION_SPRITES[empty];
      for (let sample = 0; sample < 4; sample++) {
        const drawTick = 48 + 12 * sample - agent % 24;
        const data = buildInstances(source, 1, 0, 0, 16, null, 1, false, drawTick);
        expect(data[chairRow * FLOATS_PER_INSTANCE]).toBe(-1e6);
        expect(data[row * FLOATS_PER_INSTANCE + 3]).toBe(profile.frames[variant][sample]);
        expect(SPRITE_PAIRS[data[row * FLOATS_PER_INSTANCE + 3]]).toBeDefined();
      }
      const reduced = buildInstances(source, 1, 0, 0, 16, null, 1, true, 100);
      expect(reduced[row * FLOATS_PER_INSTANCE + 3]).toBe(profile.frames[variant][0]);
      const saved = source.saveBytes();
      expect(source.loadBytes(saved)).toBe(true);
      expect(source.objectFacing(chair)).toBe(facing);
      expect(source.interactionTargets()[row]).toBe(chair);
    } finally { handle.free(); }
  }
  expect([...variants].sort()).toEqual(['blue', 'green', 'red']);
});

it('an empty reading chair is not picked through the transparent space above its art', () => {
  const handle = new SimHandle(16, 16);
  const source = new SimBridge(handle, memory);
  try {
    expect(source.spawnObject(4, 4, 'reading_chair')).toBe(true);
    const chair = spriteIndex('offlineChair');
    expect(source.sprites()[0]).toBe(chair);
    // The canvas top would pick without a recorded box; the art starts lower.
    const [left, top, right] = SPRITE_CONTENT_BOUNDS[chair];
    expect(top).toBeGreaterThan(8);
    const [anchorX, anchorY] = SPRITE_ANCHORS[chair];
    const [wx, wy] = source.positions();
    const px = screenX(wx, wy, 0) + (left + right) / 2 - anchorX;
    const artTop = screenY(wx, wy, 0) + TILE_HALF_HEIGHT + top - anchorY;
    expect(pickSprite(source, px, artTop - 4, 0, 0)).toBeNull();
    expect(pickSprite(source, px, artTop + 4, 0, 0)).toEqual({ entity: source.ids()[0], isAgent: false });
  } finally {
    handle.free();
  }
});
