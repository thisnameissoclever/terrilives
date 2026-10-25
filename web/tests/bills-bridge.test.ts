import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import {
  SimBridge,
  parseBillLines,
  parseBillsOverview,
  parseIssuedBills,
  parseNextBills,
  roomReason,
  wallReason,
} from '../src/bridge.js';

let memory: WebAssembly.Memory;
beforeAll(async () => {
  memory = (await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') })).memory;
});

// funds, keep aside, shortfall, next due day, overdue, overdue fees, days
// per month, grace days, fee percent, fee cap percent, month days.
const OVERVIEW = [100_000, 42_455, 0, 7, 0, 0, 7, 5, 5, 50, 3, 7, 0, -1, -1];

describe('the bills exports at the boundary (issue 298, [WB-panel])', () => {
  it('reads a well-formed overview and refuses every malformed one', () => {
    expect(parseBillsOverview(OVERVIEW)).toEqual({
      fundsCents: 100_000, keepAsideCents: 42_455, shortfallCents: 0, nextDueDay: 7, overdueCents: 0,
      overdueFeeCents: 0, daysPerMonth: 7, graceDays: 5, lateFeePercent: 5, lateFeeCapPercent: 50, monthDays: 3, monthLength: 7, unpaidCents: 0, unpaidDueDay: null, overdueFromDay: null,
    });
    expect(parseBillsOverview([])).toBeNull();
    expect(parseBillsOverview(OVERVIEW.slice(1))).toBeNull();
    const broken = (index: number, value: number) => OVERVIEW.map((v, i) => (i === index ? value : v));
    for (const [index, value] of [[0, NaN], [1, -1], [1, 0.5], [2, 50_000], [3, -1], [4, Infinity], [5, -2],
      [6, 0], [7, 7], [8, 101], [9, 101], [10, 8]] as const) {
      expect(parseBillsOverview(broken(index, value)), `slot ${index} = ${value}`).toBeNull();
    }
    expect(parseBillsOverview(broken(0, -500))?.fundsCents).toBe(-500);
    // An unpaid bill due on day 7, overdue from day 12.
    const unpaid = [100_000, 42_455, 0, 14, 0, 0, 7, 5, 5, 50, 3, 7, 1_000, 7, 12];
    expect(parseBillsOverview(unpaid)).toMatchObject({ unpaidCents: 1_000, unpaidDueDay: 7, overdueFromDay: 12 });
    const changed = (index: number, value: number) => unpaid.map((v, i) => (i === index ? value : v));
    for (const [index, value] of [[11, 0], [11, 2], [12, 50_000], [13, -1], [14, -1], [14, 6], [13, 0.5]] as const) {
      expect(parseBillsOverview(changed(index, value)), `slot ${index} = ${value}`).toBeNull();
    }
  });

  it('reads the next bills in kind order and refuses anything else', () => {
    expect(parseNextBills([0, 100, 200, 3, 0, 300])).toEqual([
      { kind: 0, soFarCents: 100, expectedCents: 200 }, { kind: 3, soFarCents: 0, expectedCents: 300 }]);
    expect(parseNextBills([])).toEqual([]);
    for (const values of [[0, 1], [4, 0, 0], [0, -1, 0], [0, 0, 0.5], [1, 0, 0, 1, 0, 0], [2, 0, 0, 0, 0, 0]]) {
      expect(parseNextBills(values), JSON.stringify(values)).toEqual([]);
    }
  });

  it('reads bill lines and refuses a malformed one', () => {
    expect(parseBillLines([3, 1, 14, 60, 840, 0])).toEqual([{ line: 3, kindIndex: 1, count: 14, unitCents: 60, amountCents: 840, tileDays: 0 }]);
    expect(parseBillLines([1, 0, 192, 90, 2469, 1344])[0].tileDays).toBe(1344);
    for (const values of [[6, 0, 0, 0, 0, 0], [0, -1, 0, 0, 0, 0], [0, 0, 1.5, 0, 0, 0], [0, 0, 0, -1, 0, 0], [0, 0, 0, 0, 0, -1], [0, 0, 0, 0, 0]]) {
      expect(parseBillLines(values), JSON.stringify(values)).toEqual([]);
    }
  });

  it('reads issued bills with an unpaid bill\'s missing paid day as null', () => {
    expect(parseIssuedBills([0, 7, 29_360, 1_468, -1, 1, 7, 4_900, 0, 9])).toEqual([
      { kind: 0, dueDay: 7, amountCents: 29_360, feeCents: 1_468, paidDay: null },
      { kind: 1, dueDay: 7, amountCents: 4_900, feeCents: 0, paidDay: 9 },
    ]);
    for (const values of [[4, 7, 1, 0, -1], [0, 7, 0, 0, -1], [0, 7, 1, -1, -1], [0, 7, 1, 0, 6], [0, 7, 1, 0, -2], [0, 7, 1, 0]]) {
      expect(parseIssuedBills(values), JSON.stringify(values)).toEqual([]);
    }
  });

  it('words the bed refusals for walls and rooms', () => {
    expect(wallReason(22)).toBe('That change would leave a bed outside.');
    expect(roomReason(22)).toBe('That change would leave a bed outside.');
  });

  it('reads a new game\'s bills, labels and night pay through the real boundary', () => {
    const handle = SimHandle.from_lot();
    const bridge = new SimBridge(handle, memory);
    try {
      handle.tick();
      const overview = bridge.billsOverview();
      expect(overview).not.toBeNull();
      expect(overview).toMatchObject({ nextDueDay: 7, daysPerMonth: 7, graceDays: 5, monthDays: 1,
        overdueCents: 0, lateFeePercent: 5, lateFeeCapPercent: 50, monthLength: 7, unpaidCents: 0,
        unpaidDueDay: null, overdueFromDay: null });
      expect(overview!.fundsCents).toBe(40_000);
      expect(overview!.shortfallCents).toBe(0);
      expect(overview!.keepAsideCents).toBeGreaterThan(0);
      expect(bridge.billsNext().map(bill => bill.kind)).toEqual([0, 1, 2, 3]);
      expect(bridge.billsLines(0).map(line => line.line)).toEqual([0, 1, 2]);
      expect(bridge.billsLines(4)).toEqual([]);
      expect(bridge.billsLines(-1)).toEqual([]);
      expect(bridge.billsOverdue()).toEqual([]);
      expect(bridge.billsLastMonth()).toEqual([]);
      expect(bridge.billKindLabels()).toEqual({
        uses: ['Baths', 'Dish washing', 'Hand washing', 'Radio', 'Showers', 'Stove cooking', 'Television', 'Toilet flushes'],
        daily: ['Aquariums', 'Fridges', 'Lamps', 'Pools'],
      });
      expect(bridge.nightShiftPremiumPercent()).toBe(15);
      for (const person of Array.from(bridge.ids()).filter((_, i) => bridge.kinds()[i] === 0)) {
        expect(bridge.nightPayCentsOf(person), 'the shipped household works days').toBeNull();
      }
      expect(bridge.nightPayCentsOf(-1)).toBeNull();
    } finally { handle.free(); }
  });

  it('refuses a bed outside every room with its own words', () => {
    const handle = SimHandle.from_lot();
    const bridge = new SimBridge(handle, memory);
    try {
      let refused: { object: number; x: number; y: number; facing: number } | undefined;
      for (const object of Array.from(bridge.ids())) {
        const facing = bridge.objectFacing(object);
        if (facing === null) continue;
        for (let y = 0; y < handle.lot_height() && !refused; y += 1) {
          for (let x = 0; x < handle.lot_width(); x += 1) {
            if (handle.placement_preview(object, x, y, facing)[0] === 21) { refused = { object, x, y, facing }; break; }
          }
        }
        if (refused) break;
      }
      expect(refused, 'a bed has a yard tile it may not stand on').toBeDefined();
      const preview = bridge.placementPreview(refused!.object, refused!.x, refused!.y, refused!.facing);
      expect(preview.valid).toBe(false);
      expect(preview.reason).toBe('Beds can only go inside a room.');
    } finally { handle.free(); }
  });
});
