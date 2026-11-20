import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.js';
import { spriteIndex } from '../src/render/atlas.js';

let memory: WebAssembly.Memory;
beforeAll(async () => {
  memory = (await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') })).memory;
});

/** Identify ordinary doors by their physical edge, independently of their exported row order. */
function portalRows(sim: SimBridge) {
  const near = sim.portalPositions(), far = sim.portalFarSides();
  return new Map(Array.from({ length: sim.portalCount }, (_, index) => {
    const position = [near[index * 2], near[index * 2 + 1]], farSide = [far[index * 2], far[index * 2 + 1]];
    const key = position[1] === farSide[1] ? `0:${farSide[0]},${position[1]}` : `1:${position[0]},${farSide[1]}`;
    return [key, { index, position, farSide, depth: sim.portalDepthOffsets()[index], frame: sim.portalFrames()[index],
      leaf: sim.portalLeaves(false)[index], state: sim.portalStates()[index] }] as const;
  }));
}
const DOOR_KEYS = ['0:6,9', '0:8,2', '0:12,8', '0:16,2', '1:3,6', '1:13,6'];

/** Observe paid time independently of the attendance report while exercising doors. */
function observeShiftPayment(sim: SimBridge) {
  const ids = Array.from(sim.ids()), kinds = Array.from(sim.kinds());
  const worker = ids.find((entity, row) => kinds[row] === 0 && sim.simName(entity) === 'Tim')!;
  expect(worker).toBeDefined();
  const schedule = sim.careerScheduleOf(worker)!;
  const fullPayCents = sim.careerReport(worker)!.pay * 100;
  // Tim's $120 office pay before issue 298's raise, migrated on load to $180 ([WB-save]).
  expect(fullPayCents).toBe(18000);
  const initialCents = sim.fundsCents();
  expect(sim.clockTick()).toBeLessThan(schedule.shiftStart);
  const end = schedule.shiftStart + schedule.shiftTicks;
  const working = () => sim.activities()[Array.from(sim.ids()).indexOf(worker)] === 6;
  let workedTicks = 0, returnedAt: number | null = null;
  return {
    tick() {
      const before = sim.clockTick(), wasWorking = working();
      sim.tick();
      if (wasWorking && before >= schedule.shiftStart && before < end) workedTicks++;
      if (wasWorking && !working() && returnedAt === null) returnedAt = sim.clockTick();
    },
    assertSettled() {
      expect(returnedAt).toBe(end);
      expect(working()).toBe(false);
      const [scheduled, worked, missed, base, deduction, score, paidCents, settled] = sim.careerAttendanceOf(worker);
      expect(settled).toBe(1);
      expect(scheduled).toBe(schedule.shiftTicks);
      expect(worked).toBe(workedTicks);
      expect(worked).toBeGreaterThan(0);
      expect(worked).toBeLessThan(scheduled);
      expect(missed).toBe(scheduled - workedTicks);
      expect(deduction).toBeCloseTo(Math.max(0, missed - 120) / 6, 4);
      expect(score).toBeCloseTo(Math.max(0, base - deduction), 4);
      const expectedPay = Math.floor(fullPayCents * workedTicks / scheduled);
      expect(paidCents).toBe(expectedPay);
      expect(Number.isInteger(paidCents)).toBe(true);
      expect(sim.fundsCents()).toBe(initialCents + expectedPay);
      expect(sim.funds()).toBe(Math.floor((initialCents + expectedPay) / 100));
      sim.tick();
      expect(sim.fundsCents()).toBe(initialCents + expectedPay);
    },
  };
}

describe('front door through the release WASM bridge', () => {
  it('migrates the rotated-bathtub pre-door fingerprint through the release boundary', () => {
    const handle = SimHandle.from_lot();
    const sim = new SimBridge(handle, memory);
    const fixture = readFileSync(
      '../crates/terri-wasm/tests/fixtures/pre-front-door-schema2.hex',
      'utf8',
    );
    const bytes = Uint8Array.from(Buffer.from(fixture.replace(/\s/g, ''), 'hex'));
    try {
      expect(bytes.byteLength).toBe(2679);
      expect(new TextDecoder().decode(bytes.slice(0, 8))).toBe('TERRISAV');
      expect(Array.from(bytes.slice(8, 10))).toEqual([2, 0]);
      expect(sim.loadBytes(bytes)).toBe(true);
      expect(sim.portalCount).toBe(6);
      const doors = portalRows(sim);
      expect([...doors.keys()].sort()).toEqual([...DOOR_KEYS].sort());
      expect(doors.get('0:16,2')?.position).toEqual([15, 2]);
      const migrated = sim.saveBytes();
      expect(migrated).not.toEqual(bytes);
      expect(sim.loadBytes(migrated)).toBe(true);
      expect(sim.saveBytes()).toEqual(migrated);
      const payment = observeShiftPayment(sim);
      for (let tick = 0; tick < 1000; tick++) payment.tick();
      payment.assertSettled();
      expect(sim.activities()).not.toContain(6);
    } finally {
      handle.free();
    }
  });

  it('loads the real pre-bathtub household with an active front door', () => {
    const handle = SimHandle.from_lot();
    const sim = new SimBridge(handle, memory);
    const fixture = readFileSync('../crates/terri-wasm/tests/fixtures/pre-bathtub-rotation.hex', 'utf8');
    const bytes = Uint8Array.from(Buffer.from(fixture.replace(/\s/g, ''), 'hex'));
    try {
      expect(sim.loadBytes(bytes)).toBe(true);
      // This V1 save of the cell-wall house moves to edge walls as it loads,
      // so its five interior doors show at once: review finding [F3] on the doors
      // branch, where the V1 loader drew the doorways doorless until a tick.
      expect(sim.portalCount).toBe(6);
      const migrated = sim.saveBytes();
      expect(sim.loadBytes(migrated)).toBe(true);
      expect(sim.saveBytes()).toEqual(migrated);
      const payment = observeShiftPayment(sim);
      const front = portalRows(sim).get('0:16,2')!.index;
      const seen = new Set<number>();
      for (let tick = 0; tick < 1000; tick++) {
        payment.tick();
        seen.add(sim.portalStates()[front]);
      }
      expect([...seen].sort()).toEqual([0, 1, 2, 3]);
      payment.assertSettled();
    } finally {
      handle.free();
    }
  });

  it('reacquires each zero-copy portal column after memory growth', () => {
    const handle = SimHandle.from_lot();
    const sim = new SimBridge(handle, memory);
    expect(Array.from(sim.interiorDoorLines())).toEqual([6, 9, 8, 2, 12, 8, 16, 2]);
    expect(Array.from(sim.interiorHorizontalDoorLines())).toEqual([3, 6, 13, 6]);
    expect(sim.portalCount).toBe(6);
    const rows = portalRows(sim);
    expect([...rows.keys()].sort()).toEqual([...DOOR_KEYS].sort());
    for (const [key, position, farSide] of [
      ['0:6,9', [5,9], [6,9]], ['0:8,2', [7,2], [8,2]], ['0:12,8', [11,8], [12,8]],
      ['0:16,2', [15,2], [16,2]], ['1:3,6', [3,5], [3,6]], ['1:13,6', [13,5], [13,6]],
    ] as const) {
      expect(rows.get(key)).toMatchObject({ position, farSide, depth: 0.5, state: 0,
        frame: spriteIndex('frontDoorFrameSELeft'), leaf: spriteIndex('frontDoorClosedSELeft') });
    }
    const oldViews = [sim.portalPositions(), sim.portalFrames(), sim.portalLeaves(false),
      sim.portalLeaves(true), sim.portalStates(), sim.portalDepthOffsets(), sim.portalFarSides(), sim.portalOpenness(), sim.portalPreviousOpenness()];
    for (const view of oldViews) expect(view.buffer).toBe(memory.buffer);
    const expected = oldViews.map(view => Array.from(view));
    memory.grow(1);
    for (const view of oldViews) expect(view.byteLength).toBe(0);
    const newViews = [sim.portalPositions(), sim.portalFrames(), sim.portalLeaves(false),
      sim.portalLeaves(true), sim.portalStates(), sim.portalDepthOffsets(), sim.portalFarSides(), sim.portalOpenness(), sim.portalPreviousOpenness()];
    newViews.forEach((view, index) => {
      expect(view.buffer).toBe(memory.buffer);
      expect(Array.from(view)).toEqual(expected[index]);
    });
    handle.free();
  });

  it('plays every door state and preserves active crossings through save and load', () => {
    const handle = SimHandle.from_lot();
    const sim = new SimBridge(handle, memory);
    const loadedHandle = SimHandle.from_lot();
    const loaded = new SimBridge(loadedHandle, memory);
    const seen = new Set<number>();
    const front = portalRows(sim).get('0:16,2')!.index;
    let sawWork = false;
    let sawReturn = false;
    for (let tick = 0; tick < 1100; tick++) {
      sim.tick();
      const state = sim.portalStates()[front];
      seen.add(state);
      const working = sim.activities().some(activity => activity === 6);
      sawReturn ||= sawWork && !working;
      sawWork ||= working;
      expect(sim.portalLeaves(true)[front]).toBe(spriteIndex(
        state === 0 ? 'frontDoorClosedSELeft' : 'frontDoorOpenSELeft'));
      if (state !== 0) {
        const saved = sim.saveBytes();
        expect(loaded.loadBytes(saved)).toBe(true);
        expect(loaded.portalStates()).toEqual(sim.portalStates());
        expect(loaded.portalLeaves(false)).toEqual(sim.portalLeaves(false));
        expect(loaded.portalOpenness()).toEqual(sim.portalOpenness());
        expect(loaded.portalPreviousOpenness()).toEqual(loaded.portalOpenness());
        expect(loaded.saveBytes()).toEqual(saved);
        loaded.tick();
      }
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
    expect(sawWork).toBe(true);
    expect(sawReturn).toBe(true);
    handle.free();
    loadedHandle.free();
  });

  it('keeps the prior swing sample across paused command drains', () => {
    const handle = SimHandle.from_lot();
    const sim = new SimBridge(handle, memory);
    try {
      let transitions = 0;
      for (let tick = 0; tick < 300; tick++) {
        const before = [...sim.portalOpenness()];
        sim.tick();
        expect([...sim.portalPreviousOpenness()]).toEqual(before);
        if (before.some((amount, i) => amount !== sim.portalOpenness()[i])) transitions++;
        const previous = [...sim.portalPreviousOpenness()];
        handle.flush_commands();
        expect([...sim.portalPreviousOpenness()]).toEqual(previous);
      }
      expect(transitions).toBeGreaterThan(20);
    } finally { handle.free(); }
  });
});
