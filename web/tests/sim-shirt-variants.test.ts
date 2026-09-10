import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.js';
import { buildInstances, simBodySprite, simShirtVariant, simSprite, type RenderSource } from '../src/frame.js';
import { RIGGED_SIM_VARIANTS, SPRITES } from '../src/render/atlas.js';
import { FLOATS_PER_INSTANCE, KIND_AGENT, OFFSET_SPRITE } from '../src/render/instances.js';

let memory: WebAssembly.Memory;
beforeAll(async () => {
  const wasm = await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') });
  memory = wasm.memory;
});

describe('persistent household shirt colors', () => {
  it('assigns Tim blue, Bill green and Casey red, with green for unnamed Sims', () => {
    expect([0, 1, 2, 0xffffffff, 99].map(simShirtVariant))
      .toEqual(['blue', 'green', 'red', 'green', 'green']);
  });

  it('does not change identity when entity IDs, facing or animation sample change', () => {
    const actions = ['idle', 'talk', 'eat', 'read', 'stand_read', 'walk', 'exercise', 'watch_fish', 'sit', 'sleep'];
    for (const [simId, variant] of [[0, 'blue'], [1, 'green'], [2, 'red']] as const) {
      for (const entity of [0, 1, 2, 100, 203]) {
        expect(simSprite(entity, simId)).toBe(RIGGED_SIM_VARIANTS[variant].idle.frames[0][0]);
        for (const [action, name] of actions.entries()) {
          for (const facing of [1, 2, 3, 4]) for (const tick of [0, 8, 24, 48, 95]) {
            const index = simBodySprite(entity, action, facing, tick, false, tick / 80, tick / 80, simId);
            expect(RIGGED_SIM_VARIANTS[variant][name].frames[facing - 1]).toContain(index);
            expect(SPRITES[index].name).toMatch(/^rigSim/);
          }
        }
      }
    }
  });

  it('retains the three persistent identities after simulation and save/load', () => {
    const handle = SimHandle.from_lot();
    const bridge = new SimBridge(handle, memory);
    try {
      const palette = () => Array.from(bridge.simIds()).filter(id => id !== 0xffffffff)
        .sort((a, b) => a - b).map(id => [id, simShirtVariant(id)]);
      const expected = [[0, 'blue'], [1, 'green'], [2, 'red']];
      expect(palette()).toEqual(expected);
      expect(Array.from(bridge.ids()).map((entity, row) =>
        [bridge.simName(entity), simShirtVariant(bridge.simIds()[row])])
        .filter(([name]) => name !== ''))
        .toEqual([['Tim', 'blue'], ['Bill', 'green'], ['Casey', 'red']]);
      for (let i = 0; i < 100; i++) bridge.tick();
      const saved = bridge.saveBytes();
      for (let i = 0; i < 30; i++) bridge.tick();
      expect(bridge.loadBytes(saved)).toBe(true);
      expect(palette()).toEqual(expected);
      expect(Array.from(bridge.ids()).map((entity, row) =>
        [bridge.simName(entity), simShirtVariant(bridge.simIds()[row])])
        .filter(([name]) => name !== ''))
        .toEqual([['Tim', 'blue'], ['Bill', 'green'], ['Casey', 'red']]);
    } finally {
      handle.free();
    }
  });

  it('passes persistent identity through the actual instance builder after row reordering', () => {
    for (const identities of [[0, 1, 2], [2, 0, 1]]) {
      const positions = Float32Array.of(1, 1, 3, 1, 5, 1);
      const source: RenderSource = {
        count: 3,
        positions: () => positions,
        prevPositions: () => positions,
        ids: () => Uint32Array.of(99, 100, 101),
        simIds: () => Uint32Array.from(identities),
        kinds: () => Uint32Array.of(KIND_AGENT, KIND_AGENT, KIND_AGENT),
        sprites: () => Uint32Array.of(1, 1, 1),
        activities: () => Uint32Array.of(0, 0, 0),
        visualActions: () => Uint32Array.of(0, 0, 0),
        facings: () => Uint32Array.of(1, 1, 1),
        carrying: () => Uint32Array.of(0xffffffff, 0xffffffff, 0xffffffff),
        itemKinds: () => [],
      };
      const instances = buildInstances(source, 1, 200, 150, 16, null, 1, false, 0);
      for (const [row, id] of identities.entries()) {
        expect(instances[row * FLOATS_PER_INSTANCE + OFFSET_SPRITE])
          .toBe(RIGGED_SIM_VARIANTS[simShirtVariant(id)].idle.frames[0][0]);
      }
    }
  });
});
