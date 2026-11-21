// The admin panel's wire format and reads (issue 312, [AP-tests-web] item 1
// and [AP-tests-wasm] in docs/specs/2026-11-20-admin-panel.md).
//
// The encoder is held to the shared fixture the Rust decoder is held to
// (crates/terri-core/tests/admin_wire.rs writes and checks it), so the two
// sides cannot drift: every case below must come out byte for byte as the
// fixture has it.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ADMIN_COMMAND_CODE, ADMIN_EDIT_CODES, ADMIN_REFUSAL_CODES, AdminWireError, MAX_ADMIN_EDITS, MAX_ADMIN_FUNDS_CENTS,
  decodeAdminApply, decodeAdminBegin, decodeAdminBills, decodeAdminMoodlets, decodeAdminPerson,
  decodeAdminRepetition, decodeAdminTimers, decodeAdminUndo, encodeAdminChange, parseDollars,
  type AdminChange, type AdminEdit,
} from '../src/admin/codec.js';

interface FixtureEdit { edit: string; code: number; [field: string]: unknown }
interface FixtureCase { name: string; edits: FixtureEdit[]; bytes: number[] }
const FIXTURE = JSON.parse(readFileSync(
  new URL('../../crates/terri-core/tests/fixtures/admin-wire.json', import.meta.url), 'utf8')) as {
  command_code: number; cases: FixtureCase[];
};

/** A fixture edit as the encoder takes it: the same fields without the wire code. */
function edit(row: FixtureEdit): AdminEdit {
  const { code: _code, ...rest } = row;
  return rest as unknown as AdminEdit;
}

describe('the shared wire fixture', () => {
  it('has the command code and a case for every edit', () => {
    expect(FIXTURE.command_code).toBe(ADMIN_COMMAND_CODE);
    const named = new Set(FIXTURE.cases.flatMap(row => row.edits.map(e => e.edit)));
    expect([...named].sort()).toEqual(Object.keys(ADMIN_EDIT_CODES).sort());
    expect(Object.keys(ADMIN_EDIT_CODES)).toHaveLength(26);
  });

  it('gives every edit the code the Rust side writes', () => {
    for (const row of FIXTURE.cases) for (const e of row.edits) {
      expect(ADMIN_EDIT_CODES[e.edit as keyof typeof ADMIN_EDIT_CODES], `${row.name}: ${e.edit}`).toBe(e.code);
    }
  });

  it.each(FIXTURE.cases.map(row => [row.name, row] as const))('encodes %s to the fixture bytes', (_name, row) => {
    expect(Array.from(encodeAdminChange({ edits: row.edits.map(edit) }))).toEqual(row.bytes);
  });
});

describe('the encoder refuses what it must not send', () => {
  const need = (over: Record<string, unknown> = {}): AdminChange =>
    ({ edits: [{ edit: 'SetNeed', sim: 3, need: 1, value: 50, ...over } as AdminEdit] });

  it('refuses an empty change and one past the edit limit', () => {
    expect(() => encodeAdminChange({ edits: [] })).toThrow(AdminWireError);
    const one = need().edits[0];
    expect(encodeAdminChange({ edits: Array(MAX_ADMIN_EDITS).fill(one) })[0]).toBe(41);
    expect(() => encodeAdminChange({ edits: Array(MAX_ADMIN_EDITS + 1).fill(one) })).toThrow(AdminWireError);
  });

  it('refuses a number that is not finite, in every float field', () => {
    for (const value of [NaN, Infinity, -Infinity]) expect(() => encodeAdminChange(need({ value }))).toThrow(AdminWireError);
    // Finite as a number, but past what a float holds.
    expect(() => encodeAdminChange(need({ value: 1e300 }))).toThrow(AdminWireError);
    expect(() => encodeAdminChange({ edits: [{ edit: 'SetFeeling', from: 1, to: 2, value: NaN }] })).toThrow(AdminWireError);
  });

  it('refuses an integer past its type', () => {
    expect(() => encodeAdminChange(need({ need: 256 }))).toThrow(AdminWireError);
    expect(() => encodeAdminChange(need({ need: -1 }))).toThrow(AdminWireError);
    expect(() => encodeAdminChange(need({ need: 1.5 }))).toThrow(AdminWireError);
    expect(() => encodeAdminChange(need({ sim: 2 ** 32 }))).toThrow(AdminWireError);
    expect(() => encodeAdminChange(need({ sim: -1 }))).toThrow(AdminWireError);
    expect(() => encodeAdminChange(need({ sim: '3' }))).toThrow(AdminWireError);
    expect(encodeAdminChange(need({ sim: 2 ** 32 - 1 })).length).toBeGreaterThan(0);
  });

  it('refuses money past the bound and holds the bound itself', () => {
    const funds = (cents: number): AdminChange => ({ edits: [{ edit: 'SetFunds', cents }] });
    expect(() => encodeAdminChange(funds(MAX_ADMIN_FUNDS_CENTS + 1))).toThrow(AdminWireError);
    expect(() => encodeAdminChange(funds(-MAX_ADMIN_FUNDS_CENTS - 1))).toThrow(AdminWireError);
    expect(() => encodeAdminChange(funds(1.5))).toThrow(AdminWireError);
    expect(Array.from(encodeAdminChange(funds(MAX_ADMIN_FUNDS_CENTS)))).toEqual([41, 1, 18, 128, 192, 168, 202, 154, 58]);
    expect(Array.from(encodeAdminChange(funds(-MAX_ADMIN_FUNDS_CENTS)))).toEqual([41, 1, 18, 255, 191, 168, 202, 154, 58]);
    expect(Array.from(encodeAdminChange(funds(0)))).toEqual([41, 1, 18, 0]);
    expect(Array.from(encodeAdminChange(funds(-1)))).toEqual([41, 1, 18, 1]);
  });

  it('refuses a wrong field type and an unknown edit', () => {
    expect(() => encodeAdminChange({ edits: [{ edit: 'SetJobSearch', sim: 3, on: 1 } as unknown as AdminEdit] })).toThrow(AdminWireError);
    expect(() => encodeAdminChange({ edits: [{ edit: 'SetJob', sim: 3, job: undefined, shift: 0 } as unknown as AdminEdit] })).toThrow(AdminWireError);
    expect(() => encodeAdminChange({ edits: [{ edit: 'Nothing' } as unknown as AdminEdit] })).toThrow(AdminWireError);
    expect(() => encodeAdminChange({ edits: [{ edit: 'SetNeed', sim: 3, need: 1 } as unknown as AdminEdit] })).toThrow(AdminWireError);
  });
});

describe('typed dollars', () => {
  const cents = (text: string) => parseDollars(text);

  it('parses to exact cents from the text', () => {
    expect(cents('2318.40')).toEqual({ ok: true, cents: 231_840 });
    expect(cents('-0.01')).toEqual({ ok: true, cents: -1 });
    expect(cents('0')).toEqual({ ok: true, cents: 0 });
    expect(cents('-0')).toEqual({ ok: true, cents: 0 });
    expect(Object.is((cents('-0.00') as { cents: number }).cents, 0)).toBe(true);
    expect(cents('5')).toEqual({ ok: true, cents: 500 });
    expect(cents('5.')).toEqual({ ok: true, cents: 500 });
    expect(cents('.5')).toEqual({ ok: true, cents: 50 });
    expect(cents('0.1')).toEqual({ ok: true, cents: 10 });
    expect(cents('  $1,000.50  ')).toEqual({ ok: true, cents: 100_050 });
    expect(cents('-$12')).toEqual({ ok: true, cents: -1200 });
    expect(cents('007')).toEqual({ ok: true, cents: 700 });
    // A value a float multiply gets wrong: 1.15 * 100 is 114.99999999999999.
    expect(cents('1.15')).toEqual({ ok: true, cents: 115 });
    expect(cents('4.35')).toEqual({ ok: true, cents: 435 });
  });

  it('holds the bound exactly', () => {
    expect(cents('10000000000.00')).toEqual({ ok: true, cents: MAX_ADMIN_FUNDS_CENTS });
    expect(cents('-10000000000')).toEqual({ ok: true, cents: -MAX_ADMIN_FUNDS_CENTS });
    expect(cents('10000000000.01')).toEqual({ ok: false, reason: 'range' });
    expect(cents('99999999999999999999')).toEqual({ ok: false, reason: 'range' });
  });

  it('refuses an exponent, three decimals and anything that is not a plain amount', () => {
    expect(cents('1e3')).toEqual({ ok: false, reason: 'format' });
    expect(cents('1E3')).toEqual({ ok: false, reason: 'format' });
    expect(cents('1.005')).toEqual({ ok: false, reason: 'places' });
    expect(cents('1.000')).toEqual({ ok: false, reason: 'places' });
    expect(cents('')).toEqual({ ok: false, reason: 'empty' });
    expect(cents('   ')).toEqual({ ok: false, reason: 'empty' });
    for (const text of ['abc', '-', '.', '$', '1 000', '1,00', '1,0000', '--1', '+1', '1.2.3', '0x10', 'Infinity', 'NaN', '1,000,00']) {
      expect(cents(text), text).toEqual({ ok: false, reason: 'format' });
    }
  });
});

describe('results', () => {
  it('reads an applied change and every refusal code', () => {
    expect(decodeAdminApply([1, 0, 0, 4])).toEqual({ applied: true, depth: 4 });
    expect(ADMIN_REFUSAL_CODES).toEqual([...Array(19).keys()].map(n => n + 1).concat(99));
    for (const refusal of ADMIN_REFUSAL_CODES) {
      expect(decodeAdminApply(Uint32Array.of(0, 2, refusal, 3))).toEqual({ applied: false, edit: 2, refusal, depth: 3 });
    }
  });

  it('refuses a result that is not one the native side makes', () => {
    for (const row of [[], [1, 0, 0], [1, 0, 0, 1, 0], [0, 0, 0, 1], [0, 0, 20, 1], [0, 0, 98, 1], [0, 0, 100, 1],
      [1, 0, 3, 1], [1, 2, 0, 1], [2, 0, 0, 1], [0, 0, 3.5, 1], [0, -1, 3, 1], [0, 0, 3, NaN], [0, 0, 3, 2 ** 32]]) {
      expect(() => decodeAdminApply(row), JSON.stringify(row)).toThrow(AdminWireError);
    }
  });

  it('reads the begin and undo codes', () => {
    expect([0, 1, 2, 3].map(decodeAdminBegin)).toEqual(['ok', 'build-active', 'would-not-reload', 'already-open']);
    expect([0, 1, 2].map(decodeAdminUndo)).toEqual(['ok', 'nothing', 'failed']);
    for (const code of [-1, 4, 1.5, NaN]) expect(() => decodeAdminBegin(code)).toThrow(AdminWireError);
    for (const code of [-1, 3, 1.5, NaN]) expect(() => decodeAdminUndo(code)).toThrow(AdminWireError);
  });
});

describe('reads', () => {
  const person = (over: number[] = []): number[] => {
    const row = [10, 20, 30, 40, 50, 60, 70, 80, 3, 1, 150, 55, 2, 1, 1, 3, 140, 190];
    over.forEach((value, at) => { if (value !== undefined) row[at] = value; });
    return row;
  };

  it('reads a person in the layout admin_person documents', () => {
    expect(decodeAdminPerson(person())).toEqual({
      needs: [10, 20, 30, 40, 50, 60, 70], satisfaction: 80, careerRow: 3, shift: 1, pay: 150, jobSatisfaction: 55,
      goodWeeks: 2, poorWeeks: 1, searching: true, advanceWeeks: 3, payMin: 140, payMax: 190,
    });
    const jobless = decodeAdminPerson(person([10, 20, 30, 40, 50, 60, 70, 80, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
    expect(jobless).toMatchObject({ careerRow: null, searching: false, pay: 0 });
  });

  it('reads the empty answer as no person', () => {
    expect(decodeAdminPerson([])).toBeNull();
    expect(decodeAdminPerson(new Float64Array(0))).toBeNull();
  });

  it('refuses a person of the wrong length or with a bad flag', () => {
    expect(() => decodeAdminPerson(person().slice(0, 17))).toThrow(AdminWireError);
    expect(() => decodeAdminPerson([...person(), 0])).toThrow(AdminWireError);
    expect(() => decodeAdminPerson(person([NaN]))).toThrow(AdminWireError);
    expect(() => decodeAdminPerson(person([...Array(14).fill(0), 2]))).toThrow(AdminWireError);
    expect(() => decodeAdminPerson(person([0, 0, 0, 0, 0, 0, 0, 0, -2]))).toThrow(AdminWireError);
  });

  it('reads repetition and timers as rows', () => {
    expect(decodeAdminRepetition([9, 2, 1.5, 4, 0, 3])).toEqual([{ object: 9, row: 2, value: 1.5 }, { object: 4, row: 0, value: 3 }]);
    expect(decodeAdminRepetition([])).toEqual([]);
    expect(() => decodeAdminRepetition([9, 2])).toThrow(AdminWireError);
    expect(decodeAdminTimers([1, 5000, 5, 99])).toEqual([{ timer: 1, endsTick: 5000 }, { timer: 5, endsTick: 99 }]);
    expect(() => decodeAdminTimers([6, 1])).toThrow(AdminWireError);
    expect(() => decodeAdminTimers([1])).toThrow(AdminWireError);
  });

  it('reads every moodlet source', () => {
    const rows = [
      0, 0, -3, -1,
      10, 40, -5, -1, 16, 30, -4, -1,
      20, 15, -10, -1, 26, 5, -8, -1,
      30, 0, 6, -1,
      31, 7, 2.5, -1,
      32, 0, -12, -1,
      40, 0, -20, 900, 45, 0, -30, 1200,
    ];
    expect(decodeAdminMoodlets(rows).map(m => m.source)).toEqual([
      { kind: 'other' },
      { kind: 'need', need: 0, critical: false, level: 40 }, { kind: 'need', need: 6, critical: false, level: 30 },
      { kind: 'need', need: 0, critical: true, level: 15 }, { kind: 'need', need: 6, critical: true, level: 5 },
      { kind: 'job' },
      { kind: 'feeling', sim: 7 },
      { kind: 'bills' },
      { kind: 'timer', timer: 0, endsTick: 900 }, { kind: 'timer', timer: 5, endsTick: 1200 },
    ]);
    expect(decodeAdminMoodlets(rows)[4].score).toBe(-8);
    for (const kind of [1, 9, 17, 19, 27, 33, 39, 46, 100, -1]) {
      expect(() => decodeAdminMoodlets([kind, 0, 0, -1]), String(kind)).toThrow(AdminWireError);
    }
    expect(() => decodeAdminMoodlets([0, 0, 0])).toThrow(AdminWireError);
  });

  it('reads bills and the due days that follow them', () => {
    expect(decodeAdminBills([0])).toEqual({ bills: [], dueDays: [] });
    expect(decodeAdminBills([0, 56, 28, 0])).toEqual({ bills: [], dueDays: [56, 28, 0] });
    const read = decodeAdminBills([2, 28, 1, 6100, 305, -1, 1830, 32, 0, 0, 90000, 0, 31, 4500, 28, 56, 28, 0]);
    expect(read.bills).toEqual([
      { dueDay: 28, kind: 1, amountCents: 6100, lateFeeCents: 305, paidDay: null, feeCapCents: 1830, overdueFrom: 32 },
      { dueDay: 0, kind: 0, amountCents: 90000, lateFeeCents: 0, paidDay: 31, feeCapCents: 4500, overdueFrom: 28 },
    ]);
    expect(read.dueDays).toEqual([56, 28, 0]);
    expect(() => decodeAdminBills([])).toThrow(AdminWireError);
    expect(() => decodeAdminBills([1, 28, 1, 6100])).toThrow(AdminWireError);
    expect(() => decodeAdminBills([-1])).toThrow(AdminWireError);
    expect(() => decodeAdminBills([0.5])).toThrow(AdminWireError);
  });
});
