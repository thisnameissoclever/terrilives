import { beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.js';
import { buildInstances, simBodySprite, VISUAL_ACTION_WASH_HANDS } from '../src/frame.js';
import { FLOATS_PER_INSTANCE } from '../src/render/instances.js';
import { RIGGED_SIM_VARIANTS } from '../src/render/atlas.js';

let memory: WebAssembly.Memory;
beforeAll(async () => {
  memory = (await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') })).memory;
});

it('hand washing samples the prop-free prepare clip for every shirt and facing', () => {
  expect(VISUAL_ACTION_WASH_HANDS).toBe(21);
  for (const [simId, variant] of [[0, 'blue'], [1, 'green'], [2, 'red']] as const) {
    for (let facing = 1; facing <= 4; facing++) {
      const frames = RIGGED_SIM_VARIANTS[variant].prepare.frames[facing - 1];
      const seen = new Set<number>();
      for (let tick = 0; tick < 40; tick++) {
        const body = simBodySprite(7, VISUAL_ACTION_WASH_HANDS, facing, tick, false, 0, 0, simId);
        expect(frames).toContain(body);
        seen.add(body);
      }
      expect(seen.size).toBe(frames.length);
      expect(simBodySprite(7, VISUAL_ACTION_WASH_HANDS, facing, 13, true, 0, 0, simId)).toBe(frames[0]);
    }
  }
});

it.each(['sink', 'kitchen_sink'])('compiled hand washing at the %s faces the basin, survives Load and clears on cancellation', name => {
  const handle = new SimHandle(16, 16);
  const source = new SimBridge(handle, memory);
  try {
    expect(source.spawnObject(4, 4, name)).toBe(true);
    source.spawnAgent(3, 4, 50);
    const sink = source.ids()[0], agent = source.ids()[1];
    expect(source.useObject(agent, sink, 0)).toBe(true);
    for (let tick = 0; tick < 100 && source.visualActions()[1] !== VISUAL_ACTION_WASH_HANDS; tick++) source.tick();
    expect(source.visualActions()[1]).toBe(VISUAL_ACTION_WASH_HANDS);
    // The body is anchored to the Sim's own tile, like standing reading, so
    // no fixture-composited interaction target is published.
    expect(source.interactionTargets()[1]).toBe(0xffffffff);
    expect(source.facings()[1]).toBeGreaterThan(0);
    const snapshot = () => Array.from(buildInstances(source, 1, 0, 0, 16, null, 1, false, source.clockTick())
      .slice(0, 2 * FLOATS_PER_INSTANCE));
    const before = snapshot(), saved = source.saveBytes();
    const row = 1;
    expect(before[row * FLOATS_PER_INSTANCE + 3]).toBe(simBodySprite(
      agent, VISUAL_ACTION_WASH_HANDS, source.facings()[row], source.clockTick(), false, 0, 0, source.simIds()[row]));
    source.tick();
    expect(source.loadBytes(saved)).toBe(true);
    expect(Array.from(source.saveBytes())).toEqual(Array.from(saved));
    expect(snapshot()).toEqual(before);
    expect(source.visualActions()[1]).toBe(VISUAL_ACTION_WASH_HANDS);
    source.cancelIntents(agent); source.flushCommands();
    expect(source.visualActions()[1]).toBe(0);
    expect(source.interactionTargets()[1]).toBe(0xffffffff);
  } finally {
    handle.free();
  }
});
