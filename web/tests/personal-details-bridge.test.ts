import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.js';

let memory: WebAssembly.Memory;
beforeAll(async () => { memory = (await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') })).memory; });

describe('personal details bridge', () => {
  it('reads each real person through release WASM without changing saves', () => {
    const handle = SimHandle.from_lot();
    try {
      const bridge = new SimBridge(handle, memory);
      const ids = Array.from(bridge.ids()).filter((_, index) => bridge.kinds()[index] === 0);
      expect(ids.length).toBeGreaterThan(1);
      for (const id of ids) {
        const before = handle.save_bytes();
        const details = bridge.simDetailsOf(id)!;
        expect(details).not.toBeNull();
        expect([...details.drain, ...details.refill]).toEqual(Array.from(bridge.personalityOf(id)));
        expect(details.repeated).toEqual([]);
        expect(Number.isInteger(details.sleepOffsetTicks)).toBe(true);
        expect(handle.save_bytes()).toEqual(before);
      }
      expect(bridge.simDetailsOf(0xffffffff)).toBeNull();
      const object = Array.from(bridge.ids()).find((_, index) => bridge.kinds()[index] !== 0)!;
      expect(object).toBeDefined();
      expect(bridge.simDetailsOf(object)).toBeNull();
    } finally { handle.free(); }
  });

  function fake(values: number[], labels = ['Armchair', 'Rest', 'Bed', 'Sleep']) {
    let reads = 0;
    const bridge = new SimBridge({ sim_details_of: () => { reads++; return new Float64Array(values); },
      sim_details_labels_of: () => labels } as unknown as SimHandle, memory);
    return { bridge, reads: () => reads };
  }
  const valid = [-16777217, 0.5, 0.6, 0.7, 0.8, 0.9, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9,
    2, 0, 0.34, 4000000001, 12, 0.62];

  it('preserves signed offsets and full u32 identities, and aligns both need and text columns', () => {
    expect(fake(valid).bridge.simDetailsOf(7)).toEqual({ sleepOffsetTicks: -16777217,
      drain: [0.5, 0.6, 0.7, 0.8, 0.9, 1.1, 1.2], refill: [1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9],
      repeated: [{ key: '2:0', object: 'Armchair', activity: 'Rest', repetition: 0.34 },
        { key: '4000000001:12', object: 'Bed', activity: 'Sleep', repetition: 0.62 }] });
    expect(fake(valid.slice(0, 15), []).bridge.simDetailsOf(7)?.repeated).toEqual([]);
  });

  it.each([-1, 0.5, NaN, Infinity, 4294967296])('rejects invalid entity %s before calling WASM', entity => {
    const { bridge, reads } = fake(valid);
    expect(bridge.simDetailsOf(entity)).toBeNull();
    expect(reads()).toBe(0);
  });

  it('rejects missing, truncated and misaligned numeric or label rows', () => {
    for (const values of [[], valid.slice(0, 14), valid.slice(0, 16), valid.slice(0, 20)]) {
      expect(fake(values).bridge.simDetailsOf(7)).toBeNull();
    }
    for (const labels of [[], ['Armchair'], ['Armchair', 'Rest'], ['Armchair', 'Rest', 'Bed', 'Sleep', 'Extra']]) {
      expect(fake(valid, labels).bridge.simDetailsOf(7)).toBeNull();
    }
  });

  it('rejects invalid sleep, factors, activity identifiers and repetition before displaying them', () => {
    const replacements = [
      ...[NaN, Infinity, 0.5, -2147483649, 2147483648].map(value => [0, value]),
      ...[1, 7, 8, 14].flatMap(index => [NaN, Infinity, -0.1].map(value => [index, value])),
      ...[15, 16, 18, 19].flatMap(index => [-1, 0.5, NaN, Infinity, 4294967296].map(value => [index, value])),
      ...[17, 20].flatMap(index => [-0.1, 1.1, NaN, Infinity].map(value => [index, value])),
    ];
    for (const [index, value] of replacements) {
      const values = [...valid]; values[index] = value;
      expect(fake(values).bridge.simDetailsOf(7), `slot ${index}: ${value}`).toBeNull();
    }
  });
});
