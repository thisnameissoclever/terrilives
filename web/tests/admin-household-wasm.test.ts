// The Household tab and Skip ahead against the released wasm ([T12] in
// docs/specs/2026-11-20-admin-panel.md): the real bill and funds reads draw the
// tab, the changes it sends are changes the real simulation applies, and a
// skip is ordinary ticking.
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.js';
import { createHouseholdTab } from '../src/admin/admin-household.js';
import { SkipRunner } from '../src/admin/admin-skip.js';
import { householdSource } from '../src/admin/admin-sources.js';
import type { SkipResult } from '../src/admin/admin-panel.js';
import { enter, finders, tabHarness } from './helpers/admin-tab.js';

let memory: WebAssembly.Memory;
beforeAll(async () => {
  memory = (await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') })).memory;
});

function withGame<T>(body: (sim: SimBridge) => T): T {
  const handle = SimHandle.from_lot();
  try { return body(new SimBridge(handle, memory)); } finally { handle.free(); }
}

describe('the Household tab on the released wasm', () => {
  it('reads real funds, terms and a real bill, and what it sends the simulation applies', () => {
    withGame(sim => {
      const source = householdSource(sim);
      const h = tabHarness([{ simId: 1, name: 'Tim' }]);
      expect(sim.adminBegin()).toBe('ok');
      try {
        // A bill on day 0, which is a month start at or before today.
        expect(sim.adminApply({ edits: [{ edit: 'AddBill', due_day: 0, kind: 0, amount_cents: 12_345, late_fee_cents: 0 }] })).toMatchObject({ applied: true });
        h.attach(createHouseholdTab(source)(h.context));
        const f = finders(h.state.tab!.body);
        const bill = f.root.querySelector('[data-bill="0:0"]')!;
        expect(bill, 'the real bill is a row').toBeTruthy();
        expect(source.terms(), 'the terms read in a world with a lot').not.toBeNull();
        expect(source.monthAmounts()).toHaveLength(4);
        expect((f.control('Funds') as unknown as { value: string }).value).toMatch(/^-?[\d,]+\.\d\d$/);

        // Each change goes to the real world as the tab sent it.
        const amount = bill.all().find(node => node.getAttribute('aria-label') === 'Rent Day 1 amount')!;
        enter(amount, '20');
        f.button('Add $10,000').click();
        for (const { change, label } of h.sent) expect(sim.adminApply(change), label).toMatchObject({ applied: true });
        expect(sim.adminBills().bills.find(row => row.dueDay === 0 && row.kind === 0)!.amountCents).toBe(2000);
        const before = sim.fundsCents();
        h.state.tab!.refresh();
        const pay = f.root.querySelector('[data-bill="0:0"]')!.all().find(node => node.tagName === 'button' && node.textContent === 'Pay from funds')!;
        pay.click();
        expect(sim.adminApply(h.sent.at(-1)!.change)).toMatchObject({ applied: true });
        expect(sim.fundsCents(), 'the bill came out of the funds').toBe(before - 2000);
        expect(sim.adminBills().bills.find(row => row.dueDay === 0 && row.kind === 0)!.paidDay).not.toBeNull();
        h.state.tab!.refresh();
        expect(f.root.querySelector('[data-bill="0:0"]')!.querySelector('.admin-bill-status')!.textContent).toMatch(/^Paid Day \d+$/);
      } finally {
        sim.adminEnd();
      }
    });
  });

  it('adds a bill from the new bill row as the simulation accepts it', () => {
    withGame(sim => {
      const h = tabHarness([{ simId: 1, name: 'Tim' }]);
      h.attach(createHouseholdTab(householdSource(sim))(h.context));
      const f = finders(h.state.tab!.body);
      expect(sim.adminBegin()).toBe('ok');
      try {
        enter(f.control('Bill'), '1');
        f.button('Add bill').click();
        expect(h.sent.at(-1)!.label).toBe('Add Electricity bill');
        expect(sim.adminApply(h.sent.at(-1)!.change)).toMatchObject({ applied: true });
        expect(sim.adminBills().bills.some(row => row.kind === 1)).toBe(true);
      } finally {
        sim.adminEnd();
      }
    });
  });
});

describe('Skip ahead on the released wasm', () => {
  function runner(sim: SimBridge) {
    return new SkipRunner({
      tick: () => sim.tick(),
      ticksPerHour: () => sim.dayTicks() / 24,
      ticksPerFrame: () => sim.adminLimits().skipTicksPerFrame,
      living: () => new Map(),
    }, () => ({ maxHours: sim.adminLimits().skipMaxHours, defaultHours: sim.adminLimits().skipDefaultHours }));
  }

  it('reads the knobs from the content', () => {
    withGame(sim => {
      expect(runner(sim).limits()).toEqual({ maxHours: 168, defaultHours: 8 });
      expect(sim.adminLimits().skipTicksPerFrame).toBe(300);
    });
  });

  it('is ordinary ticking: the same ticks leave the same world as playing them', () => {
    const skipped = withGame(sim => {
      const start = sim.clockTick();
      const results: SkipResult[] = [];
      const run = runner(sim);
      run.start(3, { progress: () => {}, finish: result => results.push(result) });
      let frames = 0;
      while (run.running) { run.step(); frames += 1; }
      expect(results).toEqual([{ kind: 'done', hours: 3 }]);
      expect(sim.clockTick() - start, 'three hours of ticks').toBe(3 * sim.dayTicks() / 24);
      expect(frames, 'at 300 ticks a frame').toBe(Math.ceil(3 * sim.dayTicks() / 24 / 300));
      return sim.worldHash();
    });
    const played = withGame(sim => {
      for (let tick = 0; tick < 3 * sim.dayTicks() / 24; tick++) sim.tick();
      return sim.worldHash();
    });
    expect(skipped).toBe(played);
  });
});
