import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.js';

let memory: WebAssembly.Memory;
beforeAll(async () => {
  memory = (await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') })).memory;
});

function pair(bridge: SimBridge, person: number): number[] {
  const row = bridge.ids().indexOf(person);
  expect(row).toBeGreaterThanOrEqual(0);
  expect(bridge.sleepingBeds().length).toBe(bridge.count);
  expect(bridge.sleepingPlaces().length).toBe(bridge.count);
  return [bridge.sleepingBeds()[row], bridge.sleepingPlaces()[row]];
}

it('projects real double-bed sleeping through load, memory growth and independent cancellation', () => {
  const handle = SimHandle.from_lot_with_seed(2301, 0);
  const restored = new SimHandle(96, 96);
  try {
    const source = new SimBridge(handle, memory);
    const loaded = new SimBridge(restored, memory);
    const people = Array.from(source.ids()).filter((_, row) => source.kinds()[row] === 0).slice(0, 2);
    const bed = source.bedPlacesOf(people[0])!.find(place => place.ordinal === 1)!.bed;
    for (const [ordinal, person] of people.entries()) {
      expect(source.setBedAssignment(person, { bed, ordinal })).toBe(true);
    }
    source.flushCommands();
    for (const person of people) expect(pair(source, person)).toEqual([0xffffffff, 0xffffffff]);
    for (const person of people) expect(source.useObjectFirst(person, bed, 0)).toBe(true);
    source.tick();
    for (const person of people) {
      expect(source.activities()[source.ids().indexOf(person)]).toBe(1);
      expect(pair(source, person)).toEqual([0xffffffff, 0xffffffff]);
    }
    for (let tick = 0; tick < 600 && people.some(person => pair(source, person)[0] === 0xffffffff); tick++) source.tick();
    for (const [ordinal, person] of people.entries()) {
      expect(pair(source, person)).toEqual([bed, ordinal]);
      const row = source.ids().indexOf(person);
      expect(source.activities()[row]).toBe(5);
      expect(source.visualActions()[row]).toBe(0);
      expect(source.interactionTargets()[row]).toBe(0xffffffff);
      expect(source.facings()[row]).toBe(0);
      expect(source.positions()[row * 2 + 1]).toBe(ordinal === 0 ? 7 : 10);
    }
    const saved = handle.save_bytes();
    expect(restored.load_bytes(saved)).toBe(true);
    expect(restored.save_bytes()).toEqual(saved);
    for (const [ordinal, person] of people.entries()) expect(pair(loaded, person)).toEqual([bed, ordinal]);

    const heldBeds = loaded.sleepingBeds();
    const heldPlaces = loaded.sleepingPlaces();
    const beforeCount = loaded.count;
    for (let index = 0; index < 64; index++) loaded.spawnAgent(0, 7, 50);
    expect(loaded.count).toBe(beforeCount + 64);
    const beforeGrowth = memory.buffer;
    memory.grow(1);
    expect(memory.buffer).not.toBe(beforeGrowth);
    expect(heldBeds.length).toBe(0);
    expect(heldPlaces.length).toBe(0);
    expect(loaded.sleepingBeds().buffer).toBe(memory.buffer);
    expect(loaded.sleepingPlaces().buffer).toBe(memory.buffer);
    for (const [ordinal, person] of people.entries()) expect(pair(loaded, person)).toEqual([bed, ordinal]);
    Array.from(loaded.ids()).forEach(id => {
      if (!people.includes(id)) expect(pair(loaded, id)).toEqual([0xffffffff, 0xffffffff]);
    });
    expect(loaded.cancelIntents(people[0])).toBe(true);
    loaded.flushCommands();
    expect(pair(loaded, people[0])).toEqual([0xffffffff, 0xffffffff]);
    expect(pair(loaded, people[1])).toEqual([bed, 1]);
    expect(restored.load_bytes(saved)).toBe(true);
    for (const [ordinal, person] of people.entries()) expect(pair(loaded, person)).toEqual([bed, ordinal]);
    expect(restored.save_bytes()).toEqual(saved);
  } finally {
    restored.free();
    handle.free();
  }
});
