import { describe, expect, it } from 'vitest';
import type { AdminBill } from '../src/admin/codec.js';
import { createHouseholdTab, type HouseholdSource } from '../src/admin/admin-household.js';
import type { AdminSkipState } from '../src/admin/admin-panel.js';
import type { FakeNode } from './helpers/fake-dom.js';
import { enter, finders, tabHarness } from './helpers/admin-tab.js';

// The Household tab ([AP-e-house], [AP-skip], [T12] in
// docs/specs/2026-11-20-admin-panel.md): funds, bills, the clock and Skip
// ahead. Day indices count from 0; the HUD shows `Day n + 1`.

const TODAY = 99; // the HUD's Day 100, a Tuesday
const DAY_TICKS = 1440;

function bill(over: Partial<AdminBill> & Pick<AdminBill, 'dueDay' | 'kind'>): AdminBill {
  const amountCents = over.amountCents ?? 5000;
  return {
    lateFeeCents: 0, paidDay: null, feeCapCents: Math.floor(amountCents / 2), overdueFrom: over.dueDay + 5, amountCents, ...over,
  };
}

interface World {
  funds: number;
  bills: AdminBill[];
  dueDays: number[];
  monthAmounts: number[];
  skipLimits: { maxHours: number; defaultHours: number };
  terms: { graceDays: number; lateFeePercent: number; lateFeeCapPercent: number; nextDueDay: number } | null;
  /** The world's tick; a skip moves it. */
  tick?: number;
}

function world(): World {
  return {
    funds: 231_840,
    bills: [
      bill({ dueDay: 91, kind: 0, amountCents: 7360, lateFeeCents: 1472 }),
      bill({ dueDay: 91, kind: 1, amountCents: 3420, lateFeeCents: 684 }),
      bill({ dueDay: 98, kind: 2, amountCents: 2410 }),
      bill({ dueDay: 98, kind: 3, amountCents: 2200, paidDay: 98 }),
    ],
    dueDays: [98, 91, 84, 77],
    monthAmounts: [7360, 3420, 2410, 2200],
    skipLimits: { maxHours: 168, defaultHours: 8 },
    terms: { graceDays: 5, lateFeePercent: 5, lateFeeCapPercent: 50, nextDueDay: 105 },
  };
}

function build(state: World = world()) {
  const h = tabHarness([{ simId: 3, name: 'Tim' }]);
  h.skip.limits = state.skipLimits;
  const source: HouseholdSource = {
    fundsCents: () => state.funds,
    bills: () => ({ bills: state.bills.map(row => ({ ...row })), dueDays: state.dueDays.slice() }),
    terms: () => state.terms,
    monthAmounts: () => state.monthAmounts.slice(),
    clockTick: () => state.tick ?? TODAY * DAY_TICKS + 280,
    dayTicks: () => DAY_TICKS,
    weekdayIndex: () => (Math.floor((state.tick ?? TODAY * DAY_TICKS + 280) / DAY_TICKS) - TODAY + 1) % 7,
  };
  const find = (due: number, kind: number) => state.bills.findIndex(row => row.dueDay === due && row.kind === kind);
  h.state.onApply = change => {
    for (const edit of change.edits) {
      switch (edit.edit) {
        case 'SetFunds': state.funds = edit.cents; break;
        case 'AdjustFunds': state.funds += edit.cents; break;
        case 'SetBill': {
          const at = find(edit.due_day, edit.kind);
          state.bills[at] = { ...state.bills[at], amountCents: edit.amount_cents, lateFeeCents: edit.late_fee_cents };
          break;
        }
        case 'DeleteBill': state.bills.splice(find(edit.due_day, edit.kind), 1); break;
        case 'MarkBillPaid': { const at = find(edit.due_day, edit.kind); state.bills[at] = { ...state.bills[at], paidDay: TODAY }; break; }
        case 'AddBill': state.bills.push(bill({ dueDay: edit.due_day, kind: edit.kind, amountCents: edit.amount_cents, lateFeeCents: edit.late_fee_cents })); break;
        default: break;
      }
    }
  };
  h.attach(createHouseholdTab(source)(h.context));
  return { h, f: finders(h.state.tab!.body), state };
}

type Built = ReturnType<typeof build>;
const sent = (b: Built, at = -1) => b.h.sent.at(at)!;
const isDisabled = (node: FakeNode) => (node as unknown as { disabled: boolean }).disabled;
const row = (b: Built, due: number, kind: number): FakeNode => b.f.root.querySelector(`[data-bill="${due}:${kind}"]`)!;
const within = (node: FakeNode, label: string): FakeNode => node.all().find(child => child.getAttribute('aria-label') === label)!;
const buttonIn = (node: FakeNode, text: string): FakeNode | undefined => node.all().find(child => child.tagName === 'button' && child.textContent === text);
const optionsOf = (node: FakeNode) => (node as unknown as { options: { value: string; textContent: string }[] }).options;

describe('Funds', () => {
  it('shows the funds in dollars and cents', () => {
    const b = build();
    expect((b.f.control('Funds') as unknown as { value: string }).value).toBe('2,318.40');
    expect(b.f.section('Funds')).toBeDefined();
  });

  it('sets the funds from typed dollars, exactly to the cent', () => {
    const b = build();
    enter(b.f.control('Funds'), '5000.5');
    expect(sent(b).change.edits).toEqual([{ edit: 'SetFunds', cents: 500_050 }]);
    expect(sent(b).label).toBe('Change funds');
    enter(b.f.control('Funds'), '$1,234.56');
    expect(sent(b).change.edits).toEqual([{ edit: 'SetFunds', cents: 123_456 }]);
    enter(b.f.control('Funds'), '-12.50');
    expect(sent(b).change.edits).toEqual([{ edit: 'SetFunds', cents: -1250 }]);
    enter(b.f.control('Funds'), '-12.50');
    expect(b.h.sent, 'the same funds, nothing sent').toHaveLength(3);
  });

  it('puts the old value back for text that is not dollars, and says why for too many decimals', () => {
    const b = build();
    for (const text of ['1e3', 'lots', '', '12 34']) enter(b.f.control('Funds'), text);
    expect(b.h.sent).toEqual([]);
    expect((b.f.control('Funds') as unknown as { value: string }).value).toBe('2,318.40');
    expect(b.f.status('Funds')).toBe('');
    enter(b.f.control('Funds'), '10.005');
    expect(b.h.sent).toEqual([]);
    expect(b.f.status('Funds')).toBe('Use at most two decimal places.');
    expect((b.f.control('Funds') as unknown as { value: string }).value).toBe('2,318.40');
  });

  it('clamps a sum past the bound to the bound, either way', () => {
    const b = build();
    enter(b.f.control('Funds'), '99999999999');
    expect(sent(b).change.edits).toEqual([{ edit: 'SetFunds', cents: 1_000_000_000_000 }]);
    enter(b.f.control('Funds'), '-99999999999');
    expect(sent(b).change.edits).toEqual([{ edit: 'SetFunds', cents: -1_000_000_000_000 }]);
  });

  it('adds, subtracts and zeroes with its buttons, one change each', () => {
    const b = build();
    b.f.button('Add $1,000').click();
    expect(sent(b).change.edits).toEqual([{ edit: 'AdjustFunds', cents: 100_000 }]);
    expect(sent(b).label).toBe('Add $1,000');
    b.f.button('Subtract $1,000').click();
    expect(sent(b).change.edits).toEqual([{ edit: 'AdjustFunds', cents: -100_000 }]);
    expect(sent(b).label).toBe('Subtract $1,000');
    b.f.button('Add $10,000').click();
    expect(sent(b).change.edits).toEqual([{ edit: 'AdjustFunds', cents: 1_000_000 }]);
    expect(sent(b).label).toBe('Add $10,000');
    b.f.button('Set to $0').click();
    expect(sent(b).change.edits).toEqual([{ edit: 'SetFunds', cents: 0 }]);
    expect(sent(b).label).toBe('Set funds to $0');
    expect(b.h.sent).toHaveLength(4);
  });

  it('disables Set to $0 once the funds are 0, and shows a refusal in place', () => {
    const state = world();
    state.funds = 0;
    const zero = build(state);
    expect(isDisabled(zero.f.button('Set to $0'))).toBe(true);
    const b = build();
    b.h.state.refuse = 3;
    b.f.button('Add $10,000').click();
    expect(b.f.status('Funds')).toBe('That value is outside the allowed range.');
    expect(b.f.status('Bills')).toBe('');
  });

  it('shows the new funds after a change', () => {
    const b = build();
    b.f.button('Add $1,000').click();
    expect((b.f.control('Funds') as unknown as { value: string }).value).toBe('3,318.40');
  });
});

describe('Time and Skip ahead', () => {
  it('shows the day, weekday and time of the clock', () => {
    const b = build();
    expect(b.f.section('Time').textContent).toContain('Day 100, Tuesday, 04:40');
    expect(b.f.section('Time').textContent).toContain('Now');
  });

  it('starts with the default hours, clamps the box to 1 to the maximum, and skips that many', () => {
    const b = build();
    expect((b.f.box('Skip ahead by') as unknown as { value: string }).value).toBe('8');
    const box = b.f.box('Skip ahead by') as unknown as { min: string; max: string };
    expect([box.min, box.max]).toEqual(['1', '168']);
    b.f.button('Skip').click();
    expect(b.h.skip.log).toEqual(['start 8']);
    enter(b.f.box('Skip ahead by'), '500');
    expect((b.f.box('Skip ahead by') as unknown as { value: string }).value).toBe('168');
    enter(b.f.box('Skip ahead by'), '0');
    expect((b.f.box('Skip ahead by') as unknown as { value: string }).value).toBe('1');
    b.f.button('Skip').click();
    expect(b.h.skip.log).toEqual(['start 8', 'start 1']);
    enter(b.f.box('Skip ahead by'), '12');
    b.f.button('Skip').click();
    expect(b.h.skip.log.at(-1)).toBe('start 12');
    expect(b.h.sent, 'a skip sends no admin change').toEqual([]);
  });

  it('keeps the typed hours through a redraw', () => {
    const b = build();
    enter(b.f.box('Skip ahead by'), '12');
    b.h.state.tab!.refresh();
    expect((b.f.box('Skip ahead by') as unknown as { value: string }).value).toBe('12');
    b.f.button('Skip').click();
    expect(b.h.skip.log).toEqual(['start 12']);
  });

  it('says before it starts that skipping cannot be undone', () => {
    expect(build().f.section('Time').textContent).toContain("Skipping can't be undone, and it clears Undo.");
  });

  it('hides Skip when the host cannot run it', () => {
    const b = build();
    b.h.skip.available = false;
    b.h.state.tab!.refresh();
    expect(b.f.hasButton('Skip')).toBe(false);
    expect(b.f.has('Skip ahead by value')).toBe(false);
    expect(b.f.section('Time').textContent).toContain('Day 100');
  });

  it('shows the progress with Stop while it runs, and locks everything else', () => {
    const b = build();
    b.h.skip.state = { running: true, asked: 8, done: 3 } as AdminSkipState;
    b.h.state.tab!.refresh();
    expect(b.f.section('Time').textContent).toContain('Skipping: 3 of 8 hours.');
    expect(b.f.hasButton('Skip')).toBe(false);
    b.f.button('Stop').click();
    expect(b.h.skip.log).toEqual(['stop']);
    const locked = b.f.root.all().filter(node => ['button', 'input', 'select'].includes(node.tagName) && node.textContent !== 'Stop');
    expect(locked.length).toBeGreaterThan(10);
    for (const node of locked) expect(isDisabled(node), node.getAttribute('aria-label') ?? node.textContent).toBe(true);
  });

  it('updates the progress in place, without rebuilding the Stop button that has focus', () => {
    const b = build();
    b.h.skip.state = { running: true, asked: 8, done: 0 } as AdminSkipState;
    b.h.state.tab!.refresh();
    const stop = b.f.button('Stop');
    stop.focus();
    b.h.skip.state = { running: true, asked: 8, done: 5 } as AdminSkipState;
    b.h.state.tab!.skipChanged!();
    expect(b.f.section('Time').textContent).toContain('Skipping: 5 of 8 hours.');
    expect(b.f.button('Stop')).toBe(stop);
    expect(b.h.fake.activeElement).toBe(stop);
  });

  it('moves the Now clock with the skip, so it never shows the time the skip started from', () => {
    const state = world();
    const b = build(state);
    b.h.skip.state = { running: true, asked: 24, done: 0 } as AdminSkipState;
    b.h.state.tab!.refresh();
    expect(b.f.section('Time').textContent).toContain('Day 100, Tuesday, 04:40');
    const stop = b.f.button('Stop');
    stop.focus();
    state.tick = (TODAY + 1) * DAY_TICKS + 280;
    b.h.skip.state = { running: true, asked: 24, done: 24 } as AdminSkipState;
    b.h.state.tab!.skipChanged!();
    expect(b.f.section('Time').textContent).toContain('Day 101, Wednesday, 04:40');
    expect(b.f.button('Stop')).toBe(stop);
    expect(b.h.fake.activeElement).toBe(stop);
  });

  it('moves focus from Skip to Stop and back to Skip', () => {
    const b = build();
    const skip = b.f.button('Skip');
    skip.focus();
    b.h.skip.state = { running: true, asked: 8, done: 0 } as AdminSkipState;
    b.h.state.tab!.refresh();
    expect(b.h.fake.activeElement).toBe(b.f.button('Stop'));
    b.h.skip.state = { running: false, last: { kind: 'done', hours: 8 } };
    b.h.state.tab!.refresh();
    expect(b.h.fake.activeElement).toBe(b.f.button('Skip'));
  });

  it('says how the last skip ended', () => {
    const cases: [AdminSkipState, string][] = [
      [{ running: false, last: { kind: 'done', hours: 8 } }, 'Skipped 8 hours.'],
      [{ running: false, last: { kind: 'done', hours: 1 } }, 'Skipped 1 hour.'],
      [{ running: false, last: { kind: 'stopped', hours: 3 } }, 'Stopped after 3 hours.'],
      [{ running: false, last: { kind: 'died', hours: 3, name: 'Bill' } }, 'Stopped after 3 hours: Bill died.'],
    ];
    for (const [state, words] of cases) {
      const b = build();
      b.h.skip.state = state;
      b.h.state.tab!.refresh();
      expect(b.f.section('Time').textContent, words).toContain(words);
    }
    expect(build().f.section('Time').textContent).not.toMatch(/Skipped|Stopped after/);
  });
});

describe('Bills', () => {
  it('lists every bill in the order the record keeps them, with its status', () => {
    const b = build();
    const rows = b.f.root.querySelectorAll('.admin-bill-row');
    expect(rows.map(node => node.getAttribute('data-bill'))).toEqual(['91:0', '91:1', '98:2', '98:3']);
    const status = (due: number, kind: number) => row(b, due, kind).querySelector('.admin-bill-status')!.textContent;
    expect(status(91, 0)).toBe('Overdue');
    expect(status(91, 1)).toBe('Overdue');
    expect(status(98, 2)).toBe('No fee until Day 104');
    expect(status(98, 3)).toBe('Paid Day 99');
    // Each status has its own class: Overdue (needs action), the grace status, and Paid.
    const tone = (due: number, kind: number) => row(b, due, kind).querySelector('.admin-bill-status')!.getAttribute('class');
    expect(tone(91, 0)).toBe('admin-bill-status admin-bill-overdue');
    expect(tone(91, 1)).toBe('admin-bill-status admin-bill-overdue');
    expect(tone(98, 2)).toBe('admin-bill-status admin-bill-grace');
    expect(tone(98, 3)).toBe('admin-bill-status admin-bill-paid');
    expect(row(b, 91, 0).querySelector('.admin-bill-name')!.textContent).toBe('Rent');
    expect(row(b, 98, 3).querySelector('.admin-bill-name')!.textContent).toBe('Transportation');
  });

  it('shows each amount and late fee in dollars', () => {
    const b = build();
    expect((within(row(b, 91, 0), 'Rent Day 92 amount') as unknown as { value: string }).value).toBe('73.60');
    expect((within(row(b, 91, 0), 'Rent Day 92 late fee') as unknown as { value: string }).value).toBe('14.72');
    expect((within(row(b, 98, 2), 'Water Day 99 late fee') as unknown as { value: string }).value).toBe('0.00');
  });

  it('offers the due days as the read gives them, with their weekdays, and keeps a bill on a day outside them', () => {
    const state = world();
    state.bills[0] = { ...state.bills[0], dueDay: 70 };
    const b = build(state);
    const select = within(row(b, 98, 2), 'Water Day 99 due');
    expect(optionsOf(select).map(option => option.textContent)).toEqual(['Day 99, Monday', 'Day 92, Monday', 'Day 85, Monday', 'Day 78, Monday']);
    expect(select.value).toBe('98');
    const old = within(row(b, 70, 0), 'Rent Day 71 due');
    expect(optionsOf(old).map(option => option.value)).toEqual(['98', '91', '84', '77', '70']);
    expect(old.value).toBe('70');
  });

  it('disables a paid bill\'s fields and offers only Delete', () => {
    const b = build();
    const paid = row(b, 98, 3);
    for (const label of ['Transportation Day 99 due', 'Transportation Day 99 amount', 'Transportation Day 99 late fee']) {
      expect(isDisabled(within(paid, label)), label).toBe(true);
    }
    expect(buttonIn(paid, 'Delete')).toBeDefined();
    expect(buttonIn(paid, 'Pay from funds')).toBeUndefined();
    expect(buttonIn(paid, 'Mark paid, free')).toBeUndefined();
  });

  it('disables the late fee before the grace has passed and says when it starts', () => {
    const b = build();
    expect(isDisabled(within(row(b, 98, 2), 'Water Day 99 late fee'))).toBe(true);
    expect(isDisabled(within(row(b, 91, 0), 'Rent Day 92 late fee'))).toBe(false);
    expect(row(b, 98, 2).querySelector('.admin-bill-status')!.textContent).toBe('No fee until Day 104');
  });

  it('changes the amount keeping the fee, and the fee keeping the amount', () => {
    const b = build();
    enter(within(row(b, 91, 0), 'Rent Day 92 amount'), '80');
    expect(sent(b).change.edits).toEqual([{ edit: 'SetBill', due_day: 91, kind: 0, amount_cents: 8000, late_fee_cents: 1472 }]);
    expect(sent(b).label).toBe('Change Rent bill');
    enter(within(row(b, 91, 1), 'Electricity Day 92 late fee'), '1.5');
    expect(sent(b).change.edits).toEqual([{ edit: 'SetBill', due_day: 91, kind: 1, amount_cents: 3420, late_fee_cents: 150 }]);
  });

  it('keeps the amount at a cent or more and the fee between 0 and its cap', () => {
    const b = build();
    enter(within(row(b, 91, 0), 'Rent Day 92 amount'), '0');
    // The fee's cap is half the amount, so a cent holds no fee.
    expect(sent(b).change.edits).toEqual([{ edit: 'SetBill', due_day: 91, kind: 0, amount_cents: 1, late_fee_cents: 0 }]);
    enter(within(row(b, 91, 1), 'Electricity Day 92 late fee'), '999');
    // 50 percent of $34.20 is $17.10.
    expect(sent(b).change.edits).toEqual([{ edit: 'SetBill', due_day: 91, kind: 1, amount_cents: 3420, late_fee_cents: 1710 }]);
    enter(within(row(b, 91, 1), 'Electricity Day 92 late fee'), '-5');
    expect(sent(b).change.edits).toEqual([{ edit: 'SetBill', due_day: 91, kind: 1, amount_cents: 3420, late_fee_cents: 0 }]);
  });

  it('lowers a fee that the new amount would put over its cap, in the same change', () => {
    const b = build();
    enter(within(row(b, 91, 0), 'Rent Day 92 amount'), '20');
    // Half of $20.00 is $10.00, under the $14.72 fee it had.
    expect(sent(b).change.edits).toEqual([{ edit: 'SetBill', due_day: 91, kind: 0, amount_cents: 2000, late_fee_cents: 1000 }]);
    enter(within(row(b, 91, 1), 'Electricity Day 92 amount'), '90');
    expect(sent(b).change.edits, 'a fee under the new cap is kept').toEqual([{ edit: 'SetBill', due_day: 91, kind: 1, amount_cents: 9000, late_fee_cents: 684 }]);
  });

  it('moves a bill to another due day', () => {
    const b = build();
    enter(within(row(b, 98, 2), 'Water Day 99 due'), '84');
    expect(sent(b).change.edits).toEqual([{ edit: 'MoveBill', due_day: 98, kind: 2, to_due_day: 84 }]);
    expect(sent(b).label).toBe('Move Water bill');
  });

  it('pays, marks paid and deletes, each as its own change named for the bill', () => {
    const b = build();
    buttonIn(row(b, 98, 2), 'Pay from funds')!.click();
    expect(sent(b).change.edits).toEqual([{ edit: 'PayBill', due_day: 98, kind: 2 }]);
    expect(sent(b).label).toBe('Pay Water bill');
    buttonIn(row(b, 91, 0), 'Mark paid, free')!.click();
    expect(sent(b).change.edits).toEqual([{ edit: 'MarkBillPaid', due_day: 91, kind: 0 }]);
    expect(sent(b).label).toBe('Mark Rent bill paid');
    buttonIn(row(b, 98, 3), 'Delete')!.click();
    expect(sent(b).change.edits).toEqual([{ edit: 'DeleteBill', due_day: 98, kind: 3 }]);
    expect(sent(b).label).toBe('Delete Transportation bill');
  });

  it('disables Pay from funds with the reason when the funds fall short', () => {
    const state = world();
    state.funds = 8000; // Rent is $73.60 and its $14.72 fee: $88.32
    const b = build(state);
    expect(isDisabled(buttonIn(row(b, 91, 0), 'Pay from funds')!)).toBe(true);
    expect(row(b, 91, 0).textContent).toContain("Funds don't cover this bill.");
    expect(isDisabled(buttonIn(row(b, 98, 2), 'Pay from funds')!), 'the water bill is covered').toBe(false);
    expect(row(b, 98, 2).textContent).not.toContain("Funds don't cover");
  });

  it('says once, under the table, that funds do not cover several bills, and not under each row', () => {
    const state = world();
    state.funds = 3000; // Rent $88.32 and electricity $41.04 are short; water $24.10 is covered
    const b = build(state);
    for (const [due, kindIndex] of [[91, 0], [91, 1]] as const) {
      expect(isDisabled(buttonIn(row(b, due, kindIndex), 'Pay from funds')!)).toBe(true);
      expect(row(b, due, kindIndex).textContent).not.toContain("Funds don't");
    }
    expect(isDisabled(buttonIn(row(b, 98, 2), 'Pay from funds')!)).toBe(false);
    const text = b.f.section('Bills').textContent;
    expect(text.split("Funds don't cover these bills.")).toHaveLength(2);
    expect(text).not.toContain("Funds don't cover this bill.");
    const table = b.f.section('Bills').querySelector('.admin-bill-table')!;
    const siblings = table.parent!.nodes;
    expect(siblings[siblings.indexOf(table) + 1].textContent, 'directly under the table').toBe("Funds don't cover these bills.");
  });

  it('keeps the note under its row when exactly one bill is affected, and shows none when funds cover every bill', () => {
    const state = world();
    state.funds = 8000;
    const one = build(state);
    expect(row(one, 91, 0).textContent).toContain("Funds don't cover this bill.");
    expect(one.f.section('Bills').textContent).not.toContain('these bills');
    const rich = build();
    expect(rich.f.section('Bills').textContent).not.toContain("Funds don't cover");
  });

  it('shows a refusal in the bills status line with the words of the code', () => {
    const cases: [number, string][] = [
      [14, 'Bills fall due on the first day of a billing month, today or earlier.'],
      [12, 'There is already a water bill due that day.'],
      [13, 'That bill is paid.'],
      [17, "Funds don't cover this bill."],
      [15, 'A late fee starts only after Day 103.'],
      [16, 'The late fee can be at most $12.05.'],
    ];
    for (const [code, words] of cases) {
      const b = build();
      b.h.state.refuse = code as never;
      enter(within(row(b, 98, 2), 'Water Day 99 due'), '84');
      expect(b.f.status('Bills'), `refusal ${code}`).toBe(words);
      expect(b.f.status('Funds')).toBe('');
    }
  });

  it('shows a refusal against the bill that was sent, with the numbers the sentence needs', () => {
    const b = build();
    b.h.state.refuse = 16;
    enter(within(row(b, 91, 1), 'Electricity Day 92 late fee'), '5');
    expect(b.f.status('Bills')).toBe('The late fee can be at most $17.10.');
    b.h.state.refuse = 15;
    enter(within(row(b, 91, 1), 'Electricity Day 92 late fee'), '5');
    expect(b.f.status('Bills')).toBe('A late fee starts only after Day 96.');
  });

  it('removes every late fee as one change, keeping the amounts, and hides the button when none is left', () => {
    const b = build();
    b.f.button('Remove all late fees').click();
    expect(sent(b).change.edits).toEqual([
      { edit: 'SetBill', due_day: 91, kind: 0, amount_cents: 7360, late_fee_cents: 0 },
      { edit: 'SetBill', due_day: 91, kind: 1, amount_cents: 3420, late_fee_cents: 0 },
    ]);
    expect(sent(b).label).toBe('Remove late fees');
    expect(b.h.sent).toHaveLength(1);
    expect(b.f.hasButton('Remove all late fees')).toBe(false);
  });

  it('marks every unpaid bill paid as one change, and hides the button when none is unpaid', () => {
    const b = build();
    b.f.button('Mark all paid, free').click();
    expect(sent(b).change.edits).toEqual([
      { edit: 'MarkBillPaid', due_day: 91, kind: 0 },
      { edit: 'MarkBillPaid', due_day: 91, kind: 1 },
      { edit: 'MarkBillPaid', due_day: 98, kind: 2 },
    ]);
    expect(sent(b).label).toBe('Mark all bills paid');
    expect(b.f.hasButton('Mark all paid, free')).toBe(false);
  });

  it('shows No bills when there are none, and still offers a new one', () => {
    const state = world();
    state.bills = [];
    const b = build(state);
    expect(b.f.section('Bills').textContent).toContain('No bills.');
    expect(b.f.hasButton('Add bill')).toBe(true);
    expect(b.f.hasButton('Remove all late fees')).toBe(false);
    expect(b.f.hasButton('Mark all paid, free')).toBe(false);
  });

  it('says when the next bills are due and how late fees and automatic payment work', () => {
    const text = build().f.section('Bills').textContent;
    expect(text).toContain('Next bills due: Day 106, Monday');
    expect(text).toContain('Late fee: 5% a day after 5 days, up to 50% of the bill');
    expect(text).toContain('Unpaid bills are paid from funds automatically when the game resumes, oldest first, while funds cover them.');
  });
});

describe('the bill cells on a phone', () => {
  // A phone shows each bill as a card, so each field names itself from its cell's data-label (reviewed words).
  const labels = (node: FakeNode): string[][] => node.nodes
    .filter(cell => cell.hasAttribute('data-label')).map(cell => [cell.className, cell.getAttribute('data-label')!]);

  it('labels the due day, amount and late fee of a bill, and its name and status carry their own words', () => {
    const b = build();
    expect(labels(row(b, 91, 0))).toEqual([['admin-bill-due', 'Due'], ['admin-bill-money', 'Amount'], ['admin-bill-money', 'Late fee']]);
  });
  it('labels all four fields of the new bill', () => {
    const b = build();
    const fresh = b.f.root.querySelector('.admin-bill-new')!;
    expect(fresh.nodes.filter(cell => cell.hasAttribute('data-label')).map(cell => cell.getAttribute('data-label')))
      .toEqual(['Bill', 'Due', 'Amount', 'Late fee']);
  });
});
describe('a new bill', () => {
  const kind = (b: Built) => b.f.control('Bill');
  const due = (b: Built) => b.f.control('Due');
  const amount = (b: Built) => b.f.control('Amount') as unknown as { value: string };
  const fee = (b: Built) => b.f.control('Late fee') as unknown as { value: string; disabled: boolean };

  it('starts as a rent bill on the newest due day, for what this month has come to', () => {
    const b = build();
    expect(optionsOf(kind(b)).map(option => option.textContent)).toEqual(['Rent', 'Electricity', 'Water', 'Transportation']);
    expect(kind(b).value).toBe('0');
    expect(due(b).value).toBe('98');
    expect(optionsOf(due(b)).map(option => option.textContent)).toEqual(['Day 99, Monday', 'Day 92, Monday', 'Day 85, Monday', 'Day 78, Monday']);
    expect(amount(b).value).toBe('73.60');
  });

  it('starts on the first kind and due day that has no bill yet, so Add bill is not refused', () => {
    const state = world();
    state.bills.push(bill({ dueDay: 98, kind: 0 }), bill({ dueDay: 98, kind: 1 }));
    const b = build(state);
    expect(due(b).value, 'every kind exists on day 98').toBe('91');
    expect(kind(b).value, 'rent and electricity exist on day 91').toBe('2');
    expect(isDisabled(b.f.button('Add bill'))).toBe(false);
    b.f.button('Add bill').click();
    expect(sent(b).change.edits).toEqual([{ edit: 'AddBill', due_day: 91, kind: 2, amount_cents: 2410, late_fee_cents: 0 }]);
  });

  it('moves the due day to one without that kind when only the kind is chosen', () => {
    const b = build();
    enter(kind(b), '1');
    expect(due(b).value, 'electricity exists on 91 only, so 98 is free').toBe('98');
    enter(kind(b), '2');
    expect(due(b).value, 'water exists on 98, so the next day on offer').toBe('91');
  });

  it('disables Add bill, with no added text, while the chosen kind and due day already exist', () => {
    const b = build();
    const fresh = b.f.root.querySelector('.admin-bill-new')!;
    const before = fresh.textContent;
    enter(kind(b), '1');
    enter(kind(b), '0');
    enter(due(b), '91');
    expect(isDisabled(b.f.button('Add bill'))).toBe(true);
    expect(fresh.textContent, 'no note or status appears').toBe(before);
    b.f.button('Add bill').click();
    expect(b.h.sent).toEqual([]);
    enter(due(b), '84');
    expect(isDisabled(b.f.button('Add bill'))).toBe(false);
  });

  it('disables every control of the row when every kind exists on every due day', () => {
    const state = world();
    state.bills = state.dueDays.flatMap(dueDay => [0, 1, 2, 3].map(kindIndex => bill({ dueDay, kind: kindIndex })));
    const b = build(state);
    for (const control of [kind(b), due(b), b.f.control('Amount'), b.f.control('Late fee')]) expect(isDisabled(control)).toBe(true);
    expect(isDisabled(b.f.button('Add bill'))).toBe(true);
  });

  it('disables the fee until the chosen due day\'s grace has passed', () => {
    const b = build();
    expect(fee(b).disabled, 'day 98 plus 5 days is still ahead').toBe(true);
    enter(due(b), '91');
    expect(fee(b).disabled).toBe(false);
  });

  it('follows the kind with its amount while the amount is untouched', () => {
    const b = build();
    enter(kind(b), '2');
    expect(amount(b).value).toBe('24.10');
    enter(amount(b) as unknown as FakeNode, '30');
    enter(kind(b), '1');
    expect(amount(b).value, 'a typed amount stays').toBe('30.00');
  });

  it('adds the bill with its kind, due day, amount and fee', () => {
    const b = build();
    enter(kind(b), '2');
    enter(due(b), '91');
    enter(amount(b) as unknown as FakeNode, '12.34');
    enter(fee(b) as unknown as FakeNode, '1.20');
    b.f.button('Add bill').click();
    expect(sent(b).change.edits).toEqual([{ edit: 'AddBill', due_day: 91, kind: 2, amount_cents: 1234, late_fee_cents: 120 }]);
    expect(sent(b).label).toBe('Add Water bill');
  });

  it('keeps the draft through a re-read, and starts a fresh amount after an add', () => {
    const b = build();
    enter(kind(b), '3');
    enter(due(b), '84');
    b.f.button('Add $1,000').click();
    expect(kind(b).value, 'the draft survives the redraw').toBe('3');
    expect(due(b).value).toBe('84');
    b.f.button('Add bill').click();
    expect(amount(b).value, 'the amount is the kind\'s again').toBe('22.00');
    expect(kind(b).value).toBe('3');
  });

  it('keeps the new amount at a cent or more and the fee within its cap', () => {
    const b = build();
    enter(due(b), '91');
    enter(amount(b) as unknown as FakeNode, '0');
    expect(amount(b).value).toBe('0.01');
    enter(amount(b) as unknown as FakeNode, '10');
    enter(fee(b) as unknown as FakeNode, '99');
    expect(fee(b).value, 'half of $10.00').toBe('5.00');
  });

  it('shows the refusal for a bill that already exists, naming its kind', () => {
    const b = build();
    b.h.state.refuse = 12;
    enter(kind(b), '2');
    b.f.button('Add bill').click();
    expect(b.f.status('Bills')).toBe('There is already a water bill due that day.');
  });

  it('shows the cap a too large new fee is held to', () => {
    const b = build();
    enter(due(b), '91');
    b.h.state.refuse = 16;
    enter(fee(b) as unknown as FakeNode, '1');
    b.f.button('Add bill').click();
    // Day 91 has rent and electricity, so the row moved to water, $24.10 with a fee cap of half.
    expect(kind(b).value).toBe('2');
    expect(b.f.status('Bills')).toBe('The late fee can be at most $12.05.');
  });
});

describe('reading the world again', () => {
  it('shows the new bills after Mark all paid, and the old after a refusal', () => {
    const b = build();
    b.h.state.refuse = 17;
    buttonIn(row(b, 91, 0), 'Pay from funds')!.click();
    expect(row(b, 91, 0).querySelector('.admin-bill-status')!.textContent).toBe('Overdue');
    b.h.state.refuse = null;
    b.f.button('Mark all paid, free').click();
    expect(row(b, 91, 0).querySelector('.admin-bill-status')!.textContent).toBe('Paid Day 100');
  });

  it('keeps focus on the control that sent the change, and moves it to the heading when that control goes', () => {
    const b = build();
    const box = within(row(b, 91, 0), 'Rent Day 92 amount');
    box.focus();
    enter(box, '99');
    expect(b.h.fake.activeElement).toBe(within(row(b, 91, 0), 'Rent Day 92 amount'));
    const del = buttonIn(row(b, 98, 3), 'Delete')!;
    del.focus();
    del.click();
    const heading = b.f.section('Bills').querySelector('.admin-section-title')!;
    expect(b.h.fake.activeElement).toBe(heading);
  });

  it('clears a status on the next re-read', () => {
    const b = build();
    b.h.state.refuse = 3;
    b.f.button('Add $1,000').click();
    expect(b.f.status('Funds')).not.toBe('');
    b.h.state.tab!.refresh();
    expect(b.f.status('Funds')).toBe('');
  });
});
