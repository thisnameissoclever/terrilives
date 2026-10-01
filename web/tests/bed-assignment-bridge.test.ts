import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.js';

let memory: WebAssembly.Memory;
beforeAll(async () => { memory = (await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') })).memory; });

describe('bed assignment release bridge', () => {
  it('enqueues, applies, refuses conflicts, clears and round-trips a real assignment', () => {
    const handle = SimHandle.from_lot();
    try {
      const bridge = new SimBridge(handle, memory);
      const people = Array.from(bridge.ids()).filter((_, index) => bridge.kinds()[index] === 0);
      const before = handle.save_bytes();
      const places = bridge.bedPlacesOf(people[0])!;
      expect(places.length).toBeGreaterThan(0);
      expect(handle.save_bytes()).toEqual(before);
      expect(places.every(row => row.assignee === null && row.occupant === null)).toBe(true);
      expect(places[0].label).toMatch(/^Bed at \(\d+, \d+\), place 1: .+$/);
      expect(bridge.setBedAssignment(people[0], places[0])).toBe(true);
      expect(bridge.lastBedAssignmentResult()).toBeNull();
      handle.flush_commands();
      expect(bridge.lastBedAssignmentResult()).toEqual({ sequence: 1n, agent: people[0],
        place: { bed: places[0].bed, ordinal: places[0].ordinal }, reason: null });
      expect(bridge.bedPlacesOf(people[0])![0]).toMatchObject({ assignee: people[0], assigneeName: bridge.simName(people[0]) });
      const assigned = handle.save_bytes();
      expect(bridge.setBedAssignment(people[1], places[0])).toBe(true);
      handle.flush_commands();
      expect(bridge.lastBedAssignmentResult()?.reason).toBe('That place is assigned to another Sim.');
      expect(bridge.setBedAssignment(people[0], null)).toBe(true);
      handle.flush_commands();
      expect(bridge.bedPlacesOf(people[0])![0].assignee).toBeNull();
      expect(handle.load_bytes(assigned)).toBe(true);
      expect(bridge.bedPlacesOf(people[0])![0].assignee).toBe(people[0]);
      expect(bridge.lastBedAssignmentResult()).toBeNull();
      expect(bridge.bedPlacesOf(places[0].bed)).toBeNull();
    } finally { handle.free(); }
  });
});

function fake(values: number[], result: number[] = [], sequence = 0n) {
  const calls: unknown[][] = [];
  const handle = { bed_places_of: (agent: number) => { calls.push(['read', agent]); return new Float64Array(values); },
    object_name_of: () => 'Double bed', sim_name: (id: number) => `Sim ${id}`,
    set_bed_assignment: (...args: unknown[]) => { calls.push(args); return true; },
    bed_assignment_sequence: () => sequence, last_bed_assignment_result: () => new Float64Array(result) } as unknown as SimHandle;
  return { bridge: new SimBridge(handle, memory), calls };
}

describe('bed assignment bridge validation', () => {
  const valid = [1, 4000000001, 0, 3, 5, 4000000002, 4000000003, 4000000001, 1, 3, 5, -1, -1];
  it('preserves full u32 identities and bigint feedback without aliasing', () => {
    expect(fake(valid).bridge.bedPlacesOf(4000000002)?.[0]).toEqual({ bed: 4000000001, ordinal: 0,
      label: 'Bed at (3, 5), place 1: Double bed', assignee: 4000000002, occupant: 4000000003,
      assigneeName: 'Sim 4000000002', occupantName: 'Sim 4000000003' });
    expect(fake([1]).bridge.bedPlacesOf(2)).toEqual([]);
    expect(fake([], [4000000002, 1, 4000000001, 1, 0], 9007199254740993n).bridge.lastBedAssignmentResult())
      .toEqual({ sequence: 9007199254740993n, agent: 4000000002, place: { bed: 4000000001, ordinal: 1 }, reason: null });
  });
  it('rejects invalid input before narrowing it through WASM', () => {
    const { bridge, calls } = fake(valid);
    for (const bad of [-1, 0.5, NaN, Infinity, 4294967296]) {
      expect(bridge.bedPlacesOf(bad)).toBeNull();
      expect(bridge.setBedAssignment(bad, null)).toBe(false);
      expect(bridge.setBedAssignment(2, { bed: bad, ordinal: 0 })).toBe(false);
      expect(bridge.setBedAssignment(2, { bed: 10, ordinal: bad })).toBe(false);
    }
    expect(bridge.setBedAssignment(2, { bed: 10, ordinal: 256 })).toBe(false);
    expect(calls).toEqual([]);
    expect(bridge.setBedAssignment(2, null)).toBe(true);
    expect(calls).toEqual([[2, undefined, 0]]);
  });
  it('rejects malformed, duplicate and unordered rows', () => {
    for (const values of [[], [0], [2], [1, 10], valid.slice(0, -1), [1, ...valid.slice(1, 7), ...valid.slice(1, 7)]]) {
      expect(fake(values).bridge.bedPlacesOf(2)).toBeNull();
    }
    for (const [index, value] of [[1, -1], [2, 256], [3, NaN], [4, Infinity], [5, -2], [6, 0.5], [7, 9], [11, 4000000002], [12, 4000000003]]) {
      const rows = [...valid]; rows[index] = value;
      expect(fake(rows).bridge.bedPlacesOf(2), `${index}:${value}`).toBeNull();
    }
  });
  it('rejects malformed or unknown results without inventing success', () => {
    for (const row of [[], [2, 0], [2, 2, 10, 0, 0], [2, 0, 10, 0, 0], [2, 0, 0, 1, 0], [2, 1, 10, 256, 0], [2, 1, 10, 0, 9], [2, 1, 10.5, 0, 0]]) {
      expect(fake([], row, 1n).bridge.lastBedAssignmentResult()).toBeNull();
    }
    expect(fake([], [2, 0, 0, 0, 0], 0n).bridge.lastBedAssignmentResult()).toBeNull();
    expect(fake([], [2, 0, 0, 0, 0], 2n).bridge.lastBedAssignmentResult()?.place).toBeNull();
  });
});
