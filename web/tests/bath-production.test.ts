import { beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.js';
import { buildInstances, simShirtVariant, type RenderSource } from '../src/frame.js';
import { FLOATS_PER_INSTANCE } from '../src/render/instances.js';
import { pickSprite } from '../src/input.js';
import { screenX, screenY, TILE_HALF_HEIGHT } from '../src/render/iso.js';
import { BATHROOM_SPRITES, BATHROOM_LAYERS, BATHROOM_COVERAGE, BATHROOM_MASKS,
  SPRITE_ANCHORS, spriteIndex } from '../src/render/atlas.js';
import { sampleBedCoverage } from '../src/render/bed-sprites.js';

let memory: WebAssembly.Memory;
beforeAll(async () => {
  memory = (await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') })).memory;
});

it('bathing scenes animate all facings and palettes with separate visible click owners', () => {
  for (const suffix of ['', 'NW', 'SW', 'NE']) for (let simId = 0; simId < 3; simId++) {
    const none = 0xffffffff, fixture = 41, agent = 99;
    const empty = spriteIndex('offlineBathtub' + suffix);
    const source: RenderSource = {
      count: 2, positions: () => new Float32Array([5, 3, 4, 3]),
      prevPositions: () => new Float32Array([5, 3, 4, 3]),
      ids: () => new Uint32Array([fixture, agent]), kinds: () => new Uint32Array([1, 0]),
      sprites: () => new Uint32Array([empty, 0]), activities: () => new Uint32Array([0, 20]),
      visualActions: () => new Uint32Array([0, 19]), facings: () => new Uint32Array([0, 0]),
      simIds: () => new Uint32Array([none, simId]), carrying: () => new Uint32Array([none, none]),
      foregroundSprites: () => new Uint32Array([none, none]),
      interactionTargets: () => new Uint32Array([none, fixture]), itemKinds: () => [],
    };
    const frames = BATHROOM_SPRITES[empty][19].frames[simShirtVariant(simId)];
    const samples = new Set<number>();
    for (let tick = 0; tick < 16; tick++) {
      const data = buildInstances(source, 1, 0, 0, 16, null, 1, false, tick);
      const scene = data[FLOATS_PER_INSTANCE + 3];
      samples.add(scene);
      expect(frames).toContain(scene);
      expect(data[0]).toBe(-1e6);
      expect(BATHROOM_LAYERS[scene]).toBeDefined();
    }
    expect(samples.size).toBe(4);
    const data = buildInstances(source, 1, 0, 0, 16, null, 1, true, 7);
    const scene = data[FLOATS_PER_INSTANCE + 3];
    expect(scene).toBe(frames[0]);
    const [anchorX, anchorY] = SPRITE_ANCHORS[scene];
    for (const [role, owner] of [[0, agent], [1, fixture]] as const) {
      const mask = BATHROOM_MASKS[BATHROOM_COVERAGE[scene][role]];
      let witness: [number, number] | undefined;
      for (let y = mask.box[1]; y < mask.box[3] && !witness; y++)
        for (let x = mask.box[0]; x < mask.box[2]; x++)
          if (sampleBedCoverage(mask, x, y) > .99) { witness = [x, y]; break; }
      expect(witness).toBeDefined();
      expect(pickSprite(source,
        screenX(5, 3, 0) + witness![0] / 2 - anchorX,
        screenY(5, 3, 0) + TILE_HALF_HEIGHT + witness![1] / 2 - anchorY,
        0, 0, 1, true)).toEqual({ entity: owner, isAgent: owner === agent });
    }
  }
});

it('compiled bathing restores its drawn pose after Load and clears it on cancellation', () => {
  const handle = new SimHandle(16, 16);
  const source = new SimBridge(handle, memory);
  try {
    expect(source.spawnObject(4, 4, 'bathtub')).toBe(true);
    source.spawnAgent(3, 4, 50);
    const bathtub = source.ids()[0], agent = source.ids()[1];
    expect(source.useObject(agent, bathtub, 0)).toBe(true);
    for (let tick = 0; tick < 100 && source.visualActions()[1] !== 19; tick++) source.tick();
    expect(source.visualActions()[1]).toBe(19);
    expect(source.interactionTargets()[1]).toBe(bathtub);
    const snapshot = () => Array.from(buildInstances(source, 1, 0, 0, 16, null, 1, false, source.clockTick())
      .slice(0, 2 * FLOATS_PER_INSTANCE));
    const before = snapshot(), saved = source.saveBytes();
    expect(BATHROOM_LAYERS[before[FLOATS_PER_INSTANCE + 3]]).toBeDefined();
    source.tick();
    expect(source.loadBytes(saved)).toBe(true);
    expect(Array.from(source.saveBytes())).toEqual(Array.from(saved));
    expect(snapshot()).toEqual(before);
    source.cancelIntents(agent); source.flushCommands();
    expect(source.visualActions()[1]).toBe(0);
    expect(source.interactionTargets()[1]).toBe(0xffffffff);
    expect(snapshot()[0]).not.toBe(-1e6);
  } finally { handle.free(); }
});
