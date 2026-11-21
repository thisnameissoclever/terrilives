// The admin panel through the released wasm and the bridge (issue 312,
// [AP-tests-wasm] item 3 in docs/specs/2026-11-20-admin-panel.md): open, apply
// one edit of each tab, Undo twice, close, save through the wasm save path,
// reload and compare hashes. `wasm-pack build` is a release build, so this
// runs the code that ships; a debug-only check cannot stand in for a real one.
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SaveRefusedError, SimBridge } from '../src/bridge.js';
import { AdminWireError } from '../src/admin/codec.js';

let memory: WebAssembly.Memory;
beforeAll(async () => {
  memory = (await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') })).memory;
});

/** Run `body` on a fresh game and free it afterwards. */
function withGame<T>(body: (sim: SimBridge, handle: SimHandle) => T): T {
  const handle = SimHandle.from_lot();
  try { return body(new SimBridge(handle, memory), handle); } finally { handle.free(); }
}

/** The living housemates' `SimId`s with their entity indices, ascending by `SimId`. */
function housemates(sim: SimBridge): { sim: number; index: number }[] {
  const found: { sim: number; index: number }[] = [];
  for (const index of Array.from(sim.ids())) {
    const id = sim.simIdOf(index);
    if (id !== null && !found.some(person => person.sim === id)) found.push({ sim: id, index });
  }
  return found.sort((a, b) => a.sim - b.sim);
}

describe('the admin panel through the released wasm', () => {
  it('opens, edits each tab, undoes twice, closes, saves, reloads and hashes alike', () => {
    withGame((sim, _handle) => {
      const [a, b] = housemates(sim);
      expect(b, 'two housemates').toBeDefined();
      expect(sim.adminBegin()).toBe('ok');
      expect(sim.adminUndoDepth()).toBe(0);
      const baseline = sim.worldHash();
      const hashes: bigint[] = [baseline];

      // Housemate tab: a need.
      const funds = sim.fundsCents();
      expect(sim.adminApply({ edits: [{ edit: 'SetNeed', sim: a.sim, need: 0, value: 12 }] })).toEqual({ applied: true, depth: 1 });
      hashes.push(sim.worldHash());
      expect(sim.adminPerson(a.sim)?.needs[0]).toBe(12);
      expect(sim.needsOf(a.index)[0]).toBe(12);

      // Relationships tab: a feeling.
      expect(sim.adminApply({ edits: [{ edit: 'SetFeeling', from: a.sim, to: b.sim, value: -0.5 }] })).toEqual({ applied: true, depth: 2 });
      hashes.push(sim.worldHash());

      // Household tab: the funds.
      expect(sim.adminApply({ edits: [{ edit: 'SetFunds', cents: 123_456 }] })).toEqual({ applied: true, depth: 3 });
      hashes.push(sim.worldHash());
      expect(sim.fundsCents()).toBe(123_456);
      expect(new Set(hashes).size, 'each edit moves the world hash').toBe(4);

      // Undo twice: the funds, then the feeling.
      expect(sim.adminUndo()).toBe('ok');
      expect(sim.adminUndoDepth()).toBe(2);
      expect(sim.worldHash()).toBe(hashes[2]);
      expect(sim.fundsCents()).toBe(funds);
      expect(sim.adminUndo()).toBe('ok');
      expect(sim.adminUndoDepth()).toBe(1);
      expect(sim.worldHash()).toBe(hashes[1]);
      // The world was rebuilt, so read the person again by their SimId.
      expect(sim.adminPerson(a.sim)?.needs[0]).toBe(12);

      sim.adminEnd();
      expect(sim.adminUndoDepth()).toBe(0);
      expect(sim.worldHash(), 'closing the session changes nothing').toBe(hashes[1]);

      const bytes = sim.saveBytes();
      const reloaded = SimHandle.from_lot();
      try {
        const loaded = new SimBridge(reloaded, memory);
        expect(loaded.loadBytes(bytes)).toBe(true);
        expect(loaded.worldHash()).toBe(hashes[1]);
        expect(loaded.adminUndoDepth()).toBe(0);
        expect(loaded.adminPerson(a.sim)?.needs[0]).toBe(12);
        expect(loaded.adminBegin()).toBe('ok');
      } finally {
        reloaded.free();
      }
    });
  });

  it('saves with the panel open, holding the edits and no session', () => {
    withGame(sim => {
      const [a] = housemates(sim);
      sim.adminBegin();
      sim.adminApply({ edits: [{ edit: 'SetSatisfaction', sim: a.sim, value: 33 }] });
      const bytes = sim.saveBytes();
      const reloaded = SimHandle.from_lot();
      try {
        const loaded = new SimBridge(reloaded, memory);
        expect(loaded.loadBytes(bytes)).toBe(true);
        expect(loaded.worldHash()).toBe(sim.worldHash());
        expect(loaded.adminUndoDepth()).toBe(0);
      } finally {
        reloaded.free();
      }
    });
  });

  it('refuses with the code and the edit the native side names', () => {
    withGame(sim => {
      const [a] = housemates(sim);
      expect(sim.adminApply({ edits: [{ edit: 'SetFunds', cents: 5 }] })).toMatchObject({ applied: false, refusal: 1 });
      sim.adminBegin();
      const hash = sim.worldHash();
      expect(sim.adminApply({ edits: [{ edit: 'SetNeed', sim: a.sim, need: 0, value: 101 }] }))
        .toEqual({ applied: false, edit: 0, refusal: 3, depth: 0 });
      expect(sim.adminApply({ edits: [
        { edit: 'SetNeed', sim: a.sim, need: 0, value: 50 },
        { edit: 'SetNeed', sim: 987_654, need: 1, value: 50 },
      ] })).toEqual({ applied: false, edit: 1, refusal: 2, depth: 0 });
      expect(sim.worldHash(), 'a refused change changes nothing').toBe(hash);
      // The encoder stops what the native side would call malformed before it is sent.
      expect(() => sim.adminApply({ edits: [] })).toThrow(AdminWireError);
    });
  });

  it('reads nothing for a person who is not a living housemate', () => {
    withGame(sim => {
      sim.adminBegin();
      expect(sim.adminPerson(987_654)).toBeNull();
      expect(sim.adminRepetition(987_654)).toEqual([]);
      expect(sim.adminMoodlets(987_654)).toEqual([]);
      expect(sim.adminTimers(987_654)).toEqual([]);
      for (const bad of [-1, 1.5, NaN, 2 ** 32]) expect(sim.adminPerson(bad)).toBeNull();
    });
  });

  it('keeps Build and the panel out of each other, naming the failure', () => {
    withGame(sim => {
      sim.adminBegin();
      expect(sim.beginBuild()).toEqual({ ok: false, error: { code: 16, detail: null } });
      sim.adminEnd();
      expect(sim.beginBuild().ok).toBe(true);
      expect(sim.adminBegin()).toBe('build-active');
    });
  });

  it('reads bills and the practice that gives a skill level', () => {
    withGame(sim => {
      const { bills, dueDays } = sim.adminBills();
      expect(dueDays.length).toBeGreaterThan(0);
      expect([...dueDays].sort((x, y) => y - x), 'newest first').toEqual(dueDays);
      expect(bills.every(bill => bill.dueDay % 1 === 0 && bill.kind < 4)).toBe(true);
      const levels = sim.skillLevels();
      expect(sim.skillPracticeFor(0, 0, 0)).toBe(0);
      expect(sim.skillPracticeFor(0, 1, 0)).toBeGreaterThan(0);
      expect(sim.skillPracticeFor(0, levels[0], 0)).toBeGreaterThan(sim.skillPracticeFor(0, levels[0] - 1, 0.5)!);
      expect(sim.skillPracticeFor(0, levels[0] + 1, 0)).toBeNull();
      expect(sim.skillPracticeFor(0, 0, 1)).toBeNull();
      expect(sim.skillPracticeFor(9999, 0, 0)).toBeNull();
      expect(sim.skillPracticeFor(0, 0, NaN)).toBeNull();
    });
  });
});

describe('a save the simulation refuses', () => {
  it('is a thrown error, never an empty save to store', () => {
    const empty = { save_bytes: () => new Uint8Array(0) } as unknown as SimHandle;
    const bridge = new SimBridge(empty, memory);
    expect(() => bridge.saveBytes()).toThrow(SaveRefusedError);
    const saved = { save_bytes: () => Uint8Array.of(1, 2, 3) } as unknown as SimHandle;
    expect(Array.from(new SimBridge(saved, memory).saveBytes())).toEqual([1, 2, 3]);
  });
});
