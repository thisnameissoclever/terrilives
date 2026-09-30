import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.js';

let memory: WebAssembly.Memory;
beforeAll(async () => {
  memory = (await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') })).memory;
});

function actionTrace(bridge: SimBridge, ticks: number): string[] {
  const trace: string[] = [];
  for (let tick = 0; tick < ticks; tick++) {
    bridge.tick();
    trace.push(JSON.stringify([[...bridge.visualActions()], [...bridge.interactionTargets()], [...bridge.positions()]]));
  }
  return trace;
}

it('reproduces actual action and movement traces for equal seeds and varies them across seeds', () => {
  const handles = [SimHandle.from_lot_with_seed(19, 23), SimHandle.from_lot_with_seed(19, 23),
    SimHandle.from_lot_with_seed(20, 23)];
  try {
    const bridges = handles.map(handle => new SimBridge(handle, memory));
    const traces = bridges.map(bridge => actionTrace(bridge, 700));
    expect(traces[1]).toEqual(traces[0]);
    expect(traces[2]).not.toEqual(traces[0]);
    expect(new Set(traces[0]).size).toBeGreaterThan(30);
  } finally { handles.forEach(handle => handle.free()); }
});

it('preserves subsequent stochastic choices, paths and pauses across save/load', () => {
  const handles = [SimHandle.from_lot_with_seed(543, 123), SimHandle.from_lot_with_seed(1, 0)];
  try {
    const original = new SimBridge(handles[0], memory);
    const restored = new SimBridge(handles[1], memory);
    actionTrace(original, 317);
    expect(restored.loadBytes(original.saveBytes())).toBe(true);
    expect(restored.worldHash()).toBe(original.worldHash());
    const expected = actionTrace(original, 700);
    expect(actionTrace(restored, 700)).toEqual(expected);
    expect(restored.worldHash()).toBe(original.worldHash());
  } finally { handles.forEach(handle => handle.free()); }
});
