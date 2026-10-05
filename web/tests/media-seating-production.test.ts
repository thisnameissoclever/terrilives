import { beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.js';
import { buildInstances, instanceCount, simShirtVariant, type RenderSource } from '../src/frame.js';
import { FLOATS_PER_INSTANCE } from '../src/render/instances.js';
import { pickSprite } from '../src/input.js';
import { screenX, screenY, TILE_HALF_HEIGHT } from '../src/render/iso.js';
import { SPRITES, SPRITE_ANCHORS, SEATING_SPRITES, SEATING_LAYERS,
  SEATING_COVERAGE, SEATING_MASKS, spriteIndex } from '../src/render/atlas.js';
import { sampleBedCoverage } from '../src/render/bed-sprites.js';

let memory: WebAssembly.Memory;
beforeAll(async () => {
  memory = (await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') })).memory;
});

it.each(['DiningChair', 'DeskChair', 'LongSofa', 'Ottoman', 'Chair'])(
  '%s draws production scenes with separate visible Sim and furniture click owners', kind => {
    for (const suffix of ['', 'NW', 'SW', 'NE']) for (let simId = 0; simId < 3; simId++) {
      const none = 0xffffffff, chair = 41, agent = 99;
      const empty = spriteIndex('offline' + kind + suffix);
      const source: RenderSource & { clockTick(): number } = {
        count: 3, positions: () => new Float32Array([2, 3, 5, 3, 4, 3]),
        prevPositions: () => new Float32Array([2, 3, 5, 3, 4, 3]),
        ids: () => new Uint32Array([30, chair, agent]), kinds: () => new Uint32Array([1, 1, 0]),
        sprites: () => new Uint32Array([spriteIndex('offlineTelevision'), empty, 0]),
        activities: () => new Uint32Array([0, 0, 14]), visualActions: () => new Uint32Array([0, 0, 8]),
        facings: () => new Uint32Array([0, 0, 2]), simIds: () => new Uint32Array([none, none, simId]),
        carrying: () => new Uint32Array([none, none, none]), foregroundSprites: () => new Uint32Array([none, none, none]),
        interactionTargets: () => new Uint32Array([none, none, chair]), itemKinds: () => [], clockTick: () => 0,
      };
      const profile = SEATING_SPRITES[source.sprites()[1]][8];
      const frames = (profile.facingFrames?.[2] ?? profile.frames)[simShirtVariant(simId)];
      const data = buildInstances(source, 1, 0, 0, 16, null, 1, false, source.clockTick());
      const scene = data[2 * FLOATS_PER_INSTANCE + 3];
      expect(frames).toContain(scene);
      expect(data[FLOATS_PER_INSTANCE]).toBe(-1e6);
      expect(SEATING_LAYERS[scene]).toBeDefined();
      expect(SPRITES[scene].page).toBe(SPRITES[SEATING_LAYERS[scene][0]].page);
      const [anchorX, anchorY] = SPRITE_ANCHORS[scene];
      const positions = source.positions();
      const coverage = SEATING_COVERAGE[scene];
      for (const [role, owner] of [[0, agent], [1, chair]] as const) {
        const mask = SEATING_MASKS[coverage[role]];
        let witness: [number, number] | undefined;
        for (let y = mask.box[1]; y < mask.box[3] && !witness; y++) {
          for (let x = mask.box[0]; x < mask.box[2]; x++) {
            if (sampleBedCoverage(mask, x, y) > .99) { witness = [x, y]; break; }
          }
        }
        expect(witness).toBeDefined();
        const pick = pickSprite(source,
          screenX(positions[2], positions[3], 0) + witness![0] / 2 - anchorX,
          screenY(positions[2], positions[3], 0) + TILE_HALF_HEIGHT + witness![1] / 2 - anchorY, 0, 0);
        expect(pick).toEqual({ entity: owner, isAgent: owner === agent });
      }
      const still = buildInstances(source, 1, 0, 0, 16, null, 1, true, source.clockTick());
      expect(still[2 * FLOATS_PER_INSTANCE + 3]).toBe(frames[0]);
    }
  });

it.each([['offlineTelevision', 14], ['offlineRadio', 18]] as const)(
  '%s uses a real shipped-house seat and restores its exact drawn scene', (sprite, activity) => {
    const handle = SimHandle.from_lot();
    const source = new SimBridge(handle, memory);
    try {
      const deviceRow = Array.from(source.sprites()).indexOf(spriteIndex(sprite));
      expect(deviceRow).toBeGreaterThanOrEqual(0);
      const device = source.ids()[deviceRow];
      const agentRow = Array.from(source.kinds()).indexOf(0);
      const agent = source.ids()[agentRow];
      expect(source.useObjectFirst(agent, device, 0)).toBe(true);
      for (let tick = 0; tick < 800 && (source.visualActions()[agentRow] !== 8 || source.activities()[agentRow] !== activity); tick++) source.tick();
      expect(source.visualActions()[agentRow]).toBe(8);
      expect(source.activities()[agentRow]).toBe(activity);
      const chair = source.interactionTargets()[agentRow];
      expect(chair).not.toBe(device);
      expect(chair).not.toBe(0xffffffff);
      const snapshot = () => Array.from(buildInstances(source, 1, 0, 0, 16, null, 1, false, source.clockTick())
        .slice(0, instanceCount(source, null) * FLOATS_PER_INSTANCE));
      const before = snapshot();
      expect(SEATING_LAYERS[before[agentRow * FLOATS_PER_INSTANCE + 3]]).toBeDefined();
      const saved = source.saveBytes();
      for (let tick = 0; tick < 10; tick++) source.tick();
      expect(source.loadBytes(saved)).toBe(true);
      expect(Array.from(source.saveBytes())).toEqual(Array.from(saved));
      expect(snapshot()).toEqual(before);
      source.cancelIntents(agent); source.flushCommands();
      expect(source.interactionTargets()[agentRow]).toBe(0xffffffff);
    } finally { handle.free(); }
  });

it('ordinary ottoman sitting selects the same neutral catalogue without a media device', () => {
  const handle = SimHandle.from_lot();
  const source = new SimBridge(handle, memory);
  try {
    const chairRow = Array.from(source.sprites()).indexOf(spriteIndex('offlineOttoman'));
    const chair = source.ids()[chairRow], agentRow = Array.from(source.kinds()).indexOf(0);
    const agent = source.ids()[agentRow];
    expect(source.useObjectFirst(agent, chair, 0)).toBe(true);
    for (let tick=0;tick<800 && !(source.visualActions()[agentRow]===8 && source.activities()[agentRow]===11);tick++) source.tick();
    expect(source.visualActions()[agentRow]).toBe(8);
    expect(source.interactionTargets()[agentRow]).toBe(chair);
    const data=buildInstances(source,1,0,0,16,null,1,true,source.clockTick());
    expect(SEATING_LAYERS[data[agentRow*FLOATS_PER_INSTANCE+3]]).toBeDefined();
    expect(data[chairRow*FLOATS_PER_INSTANCE]).toBe(-1e6);
    expect(source.loadBytes(source.saveBytes())).toBe(true);
  } finally {handle.free();}
});
