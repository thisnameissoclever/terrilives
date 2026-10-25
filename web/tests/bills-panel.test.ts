import { describe, expect, it } from 'vitest';

import type { BillLine, BillsOverview, IssuedBill, NextBill } from '../src/bridge.js';
import { BillsPanel, billLineText, lastMonthLineText, overdueLineText, weekdayOf, type BillsSource } from '../src/ui/bills-panel.js';
import { billsRules, formatBillsRow, formatCents, formatDollarsUp } from '../src/ui/bills-text.js';

/** A minimal element: text, children, attributes, listeners and the dialog calls the panel uses. */
class FakeElement {
  textContent = '';
  className = '';
  id = '';
  type = '';
  open = false;
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, (() => void)[]>();
  children: FakeElement[] = [];
  constructor(readonly tagName: string) {}
  append(...nodes: FakeElement[]) { this.children.push(...nodes); }
  replaceChildren(...nodes: FakeElement[]) { this.children = nodes; }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  removeAttribute(name: string) { this.attributes.delete(name); }
  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  dispatch(type: string) { for (const listener of this.listeners.get(type) ?? []) listener(); }
  showModal() { this.open = true; }
  close() { if (this.open) { this.open = false; this.dispatch('close'); } }
  /** Every text in the subtree, one entry per element with text. */
  texts(): string[] {
    return [...(this.textContent ? [this.textContent] : []), ...this.children.flatMap(child => child.texts())];
  }
  find(predicate: (element: FakeElement) => boolean): FakeElement[] {
    return [...(predicate(this) ? [this] : []), ...this.children.flatMap(child => child.find(predicate))];
  }
}

const fakeDocument = { createElement: (tag: string) => new FakeElement(tag) } as unknown as Document;

const OVERVIEW: BillsOverview = {
  fundsCents: 100_000,
  keepAsideCents: 42_455,
  shortfallCents: 0,
  nextDueDay: 7,
  overdueCents: 0,
  overdueFeeCents: 0,
  daysPerMonth: 7,
  graceDays: 5,
  lateFeePercent: 5,
  lateFeeCapPercent: 50,
  monthDays: 3,
};

const NEXT: NextBill[] = [
  { kind: 0, soFarCents: 12_583, expectedCents: 29_360 },
  { kind: 1, soFarCents: 2_100, expectedCents: 4_900 },
  { kind: 2, soFarCents: 1_500, expectedCents: 3_500 },
  { kind: 3, soFarCents: 1_200, expectedCents: 4_695 },
];

const LINES: Record<number, BillLine[]> = {
  0: [
    { line: 0, kindIndex: 0, count: 3, unitCents: 7_000, amountCents: 3_000 },
    { line: 1, kindIndex: 0, count: 192, unitCents: 100, amountCents: 8_229 },
    { line: 2, kindIndex: 0, count: 112, unitCents: 30, amountCents: 1_440 },
  ],
  1: [
    { line: 0, kindIndex: 0, count: 3, unitCents: 1_400, amountCents: 600 },
    { line: 3, kindIndex: 0, count: 14, unitCents: 60, amountCents: 840 },
    { line: 3, kindIndex: 1, count: 0, unitCents: 80, amountCents: 0 },
    { line: 4, kindIndex: 0, count: 6, unitCents: 20, amountCents: 120 },
  ],
  2: [{ line: 0, kindIndex: 0, count: 3, unitCents: 1_400, amountCents: 600 }],
  3: [
    { line: 0, kindIndex: 0, count: 3, unitCents: 700, amountCents: 300 },
    { line: 5, kindIndex: 0, count: 3, unitCents: 300, amountCents: 900 },
  ],
};

const LABELS = { uses: ['Showers', 'Baths'], daily: ['Fridges'] };

function source(overrides: Partial<BillsSource> = {}): BillsSource {
  return {
    billsOverview: () => OVERVIEW,
    billsNext: () => NEXT,
    billsLines: kind => LINES[kind] ?? [],
    billsOverdue: () => [],
    billsLastMonth: () => [],
    billKindLabels: () => LABELS,
    // Day index 3, a Thursday.
    clockTick: () => 3 * 1440 + 600,
    dayTicks: () => 1440,
    weekdayIndex: () => 3,
    ...overrides,
  };
}

function pause() {
  const events: string[] = [];
  return { events, suspend: (reason: string) => events.push(`suspend ${reason}`), resume: (reason: string) => events.push(`resume ${reason}`) };
}

function opened(overrides: Partial<BillsSource> = {}) {
  const control = pause();
  const panel = new BillsPanel(source(overrides), fakeDocument, control);
  expect(panel.open()).toBe(true);
  const root = panel.element() as unknown as FakeElement;
  return { panel, root, control, text: root.texts() };
}

describe('bills text', () => {
  it('shows cents in the panel and whole dollars rounded up in the row', () => {
    expect(formatCents(29_360)).toBe('$293.60');
    expect(formatCents(1_000_000)).toBe('$10,000.00');
    expect(formatCents(-500)).toBe('-$5.00');
    expect(formatDollarsUp(42_455)).toBe('$425');
    expect(formatDollarsUp(42_400)).toBe('$424');
    expect(formatDollarsUp(1_000_000)).toBe('$10,000');
  });

  it('reads the row as the amount due and its day, or the overdue total with fees', () => {
    expect(formatBillsRow(OVERVIEW)).toBe('$425 due Day 8');
    expect(formatBillsRow({ ...OVERVIEW, keepAsideCents: 1_000_000, nextDueDay: 999 })).toBe('$10,000 due Day 1,000');
    expect(formatBillsRow({ ...OVERVIEW, overdueCents: 29_360, overdueFeeCents: 1_468 })).toBe('$309 overdue');
  });

  it('finds a due day\'s weekday from today\'s', () => {
    expect(weekdayOf(7, 3, 3)).toBe('Monday');
    expect(weekdayOf(3, 3, 3)).toBe('Thursday');
    expect(weekdayOf(0, 3, 3)).toBe('Monday');
    expect(weekdayOf(1.5, 3, 3)).toBeNull();
  });

  it('words each line of a bill, leaving out usage nobody used', () => {
    expect(LINES[0].map(line => billLineText(line, LABELS, 7))).toEqual([
      'Base charge, 3 of 7 days: $30.00',
      'Indoor tiles: 192 at $1.00 a month',
      'Outdoor tiles: 112 at $0.30 a month',
    ]);
    expect(LINES[1].map(line => billLineText(line, LABELS, 7))).toEqual([
      'Base charge, 3 of 7 days: $6.00', 'Showers: 14 x $0.60', null, 'Fridges: 6 days x $0.20',
    ]);
    expect(billLineText(LINES[3][1], LABELS, 7)).toBe('Trips to work: 3 x $3.00');
    expect(billLineText({ line: 3, kindIndex: 9, count: 2, unitCents: 1, amountCents: 2 }, LABELS, 7)).toBeNull();
  });
});

describe('the Bills panel', () => {
  it('renders keep aside, cover and shortfall lines', () => {
    const { text } = opened();
    expect(text).toContain('Funds: $1,000.00');
    expect(text).toContain('Keep aside $424.55 for the bills due Day 8, Monday.');
    expect(text).toContain('Funds cover these bills.');
    const short = opened({ billsOverview: () => ({ ...OVERVIEW, fundsCents: 2_455, shortfallCents: 40_000 }) });
    expect(short.text).toContain('Funds are $400.00 short.');
    expect(short.text).not.toContain('Funds cover these bills.');
  });

  it('lists overdue bills only when one is overdue', () => {
    expect(opened().text).not.toContain('Overdue');
    const bill: IssuedBill = { kind: 0, dueDay: 7, amountCents: 29_360, feeCents: 1_468, paidDay: null };
    expect(overdueLineText(bill)).toBe('Rent due Day 8: $293.60 plus $14.68 in late fees');
    const { text } = opened({
      billsOverview: () => ({ ...OVERVIEW, overdueCents: 29_360, overdueFeeCents: 1_468 }),
      billsOverdue: () => [bill],
    });
    expect(text).toContain('Overdue');
    expect(text).toContain('Rent due Day 8: $293.60 plus $14.68 in late fees');
    expect(text).toContain('Overdue bills are paid automatically as soon as Funds cover them, oldest first.');
  });

  it('lists next bills with so far and expected amounts in cents', () => {
    const { text } = opened();
    expect(text).toContain('Next bills');
    expect(text).toContain('Due Day 8, Monday');
    for (const [name, expected, soFar] of [['Rent', '$293.60', '$125.83'], ['Electricity', '$49.00', '$21.00'],
      ['Water', '$35.00', '$15.00'], ['Transportation', '$46.95', '$12.00']]) {
      expect(text).toContain(name);
      expect(text).toContain(`Expected ${expected}`);
      expect(text).toContain(`So far ${soFar}`);
    }
  });

  it('expands each bill into its lines and keeps it expanded across redraws', () => {
    let funds = 100_000;
    const { panel, root } = opened({ billsOverview: () => ({ ...OVERVIEW, fundsCents: funds }) });
    const rows = root.find(element => element.tagName === 'details');
    expect(rows).toHaveLength(4);
    expect(rows[1].texts()).toEqual(['Electricity', 'Expected $49.00', 'So far $21.00',
      'Base charge, 3 of 7 days: $6.00', 'Showers: 14 x $0.60', 'Fridges: 6 days x $0.20']);
    expect(rows[3].texts()).toContain('Trips to work: 3 x $3.00');
    rows[1].open = true;
    rows[1].dispatch('toggle');
    funds = 90_000;
    panel.update();
    const redrawn = root.find(element => element.tagName === 'details');
    expect(redrawn[1]).not.toBe(rows[1]);
    expect(redrawn.map(row => row.open)).toEqual([false, true, false, false]);
  });

  it('shows the last month with paid and unpaid bills', () => {
    const paid: IssuedBill = { kind: 0, dueDay: 0, amountCents: 29_360, feeCents: 0, paidDay: 0 };
    const late: IssuedBill = { kind: 1, dueDay: 0, amountCents: 4_900, feeCents: 245, paidDay: 6 };
    const unpaid: IssuedBill = { kind: 3, dueDay: 0, amountCents: 4_695, feeCents: 0, paidDay: null };
    expect(lastMonthLineText(paid)).toBe('Rent: $293.60, paid Day 1');
    expect(lastMonthLineText(late)).toBe('Electricity: $49.00 plus $2.45 in late fees, paid Day 7');
    expect(lastMonthLineText(unpaid)).toBe('Transportation: $46.95, unpaid');
    expect(opened().text).not.toContain('Last month');
    const { text } = opened({ billsLastMonth: () => [paid, late, unpaid] });
    expect(text).toContain('Last month');
    expect(text).toContain('Transportation: $46.95, unpaid');
  });

  it('reads the rules paragraph from the overview numbers', () => {
    const rules = 'Bills arrive on the first day of each month. A month is 7 days. Bills are paid automatically '
      + 'from Funds. A bill still unpaid after 5 days is overdue: a late fee of 5% of the bill is added each day, '
      + 'up to 50%, and every housemate is Behind on bills until it is paid.';
    expect(billsRules(OVERVIEW)).toBe(rules);
    const { text } = opened();
    expect(text).toContain('How bills work');
    expect(text).toContain(rules);
    expect(billsRules({ ...OVERVIEW, daysPerMonth: 30, graceDays: 3 })).toContain('A month is 30 days.');
  });

  it('closes on Close and Escape and resumes the paused game', () => {
    const { panel, root, control } = opened();
    expect(control.events).toEqual(['suspend bills']);
    expect(panel.open()).toBe(false);
    const close = root.find(element => element.tagName === 'button')[0];
    expect(close.textContent).toBe('Close');
    close.dispatch('click');
    expect(root.open).toBe(false);
    expect(control.events).toEqual(['suspend bills', 'resume bills']);
    expect(panel.open()).toBe(true);
    // Escape closes a modal dialog in the browser, which fires its close event.
    root.open = false;
    root.dispatch('close');
    expect(control.events).toEqual(['suspend bills', 'resume bills', 'suspend bills', 'resume bills']);
  });

  it('does not open or pause in a world without bills', () => {
    const control = pause();
    const panel = new BillsPanel(source({ billsOverview: () => null }), fakeDocument, control);
    expect(panel.open()).toBe(false);
    expect(control.events).toEqual([]);
  });
});
