import { beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.js';
import { buildInstances, instanceCount } from '../src/frame.js';
import { FLOATS_PER_INSTANCE } from '../src/render/instances.js';
import { SEATING_LAYERS, spriteIndex } from '../src/render/atlas.js';

let memory: WebAssembly.Memory;
beforeAll(async () => {
  memory = (await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') })).memory;
});

it('desk work sits on the shipped desk chair and restores its exact drawn scene', () => {
  const handle = SimHandle.from_lot();
  const source = new SimBridge(handle, memory);
  try {
    const deskRow = Array.from(source.sprites()).indexOf(spriteIndex('offlineDeskSW'));
    expect(deskRow).toBeGreaterThanOrEqual(0);
    const desk = source.ids()[deskRow];
    const chairRow = Array.from(source.sprites()).findIndex(sprite =>
      sprite === spriteIndex('offlineDeskChairNW'));
    expect(chairRow).toBeGreaterThanOrEqual(0);
    const chair = source.ids()[chairRow];
    const agentRow = Array.from(source.kinds()).indexOf(0);
    const agent = source.ids()[agentRow];
    expect(source.useObjectFirst(agent, desk, 0)).toBe(true);
    for (let tick = 0; tick < 800 && (source.visualActions()[agentRow] !== 8 || source.activities()[agentRow] !== 19); tick++) source.tick();
    expect(source.visualActions()[agentRow]).toBe(8);
    expect(source.activities()[agentRow]).toBe(19);
    expect(source.interactionTargets()[agentRow]).toBe(chair);
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
    expect(source.visualActions()[agentRow]).toBe(0);
  } finally { handle.free(); }
});
