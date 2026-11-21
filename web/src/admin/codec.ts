/**
 * The admin panel's wire format and reads (issue 312, [AP-cmd-wire] and
 * [AP-wasm] in `docs/specs/2026-11-20-admin-panel.md`).
 *
 * `encodeAdminChange` writes the postcard bytes of `SimCommand::Admin`, wire
 * code 41, exactly as `crates/terri-core/src/admin.rs` decodes them. The
 * shared fixture `crates/terri-core/tests/fixtures/admin-wire.json` holds one
 * golden vector per edit and `web/tests/admin-codec.test.ts` requires this
 * encoder to reproduce every one, so the two sides cannot drift.
 *
 * The decoders turn the flat number lists the wasm exports return into typed
 * rows. A list that does not have its documented shape throws
 * `AdminWireError`: the native side builds them, so a bad one is a bug, not
 * input to tolerate.
 */

/** The command code of `SimCommand::Admin`. */
export const ADMIN_COMMAND_CODE = 41;
/** The most edits one change may hold, as `MAX_ADMIN_EDITS`. */
export const MAX_ADMIN_EDITS = 1024;
/** The most cents any funds, amount or fee value may name, as `MAX_ADMIN_FUNDS_CENTS`. */
export const MAX_ADMIN_FUNDS_CENTS = 1_000_000_000_000;

/** Malformed admin bytes, or a value the encoder will not send. */
export class AdminWireError extends Error {
  constructor(detail: string) { super(`Malformed admin data: ${detail}.`); this.name = 'AdminWireError'; }
}

function check(ok: boolean, detail: string): asserts ok {
  if (!ok) throw new AdminWireError(detail);
}

type Field = 'u8' | 'u32' | 'i64' | 'f32' | 'bool' | 'optionU32';

/**
 * Every edit, in wire-code order: its name, and its fields in the order the
 * Rust variant declares them. The order is wire format.
 */
const EDITS = [
  ['SetNeed', [['sim', 'u32'], ['need', 'u8'], ['value', 'f32']]],
  ['SetSatisfaction', [['sim', 'u32'], ['value', 'f32']]],
  ['SetRepetition', [['sim', 'u32'], ['object', 'u32'], ['row', 'u32'], ['value', 'f32']]],
  ['EndTimedMoodlet', [['sim', 'u32'], ['timer', 'u8']]],
  ['SetAffinity', [['sim', 'u32'], ['kind', 'u32'], ['value', 'f32']]],
  ['SetSkillPractice', [['sim', 'u32'], ['skill', 'u32'], ['practice', 'f32']]],
  ['SetTraitState', [['sim', 'u32'], ['trait_index', 'u32'], ['state', 'f32']]],
  ['AddTrait', [['sim', 'u32'], ['trait_index', 'u32']]],
  ['RemoveTrait', [['sim', 'u32'], ['trait_index', 'u32']]],
  ['SetJob', [['sim', 'u32'], ['job', 'optionU32'], ['shift', 'u32']]],
  ['SetShift', [['sim', 'u32'], ['shift', 'u32']]],
  ['SetPay', [['sim', 'u32'], ['dollars', 'u32']]],
  ['SetJobSatisfaction', [['sim', 'u32'], ['value', 'f32']]],
  ['SetGoodWeeks', [['sim', 'u32'], ['weeks', 'u32']]],
  ['SetPoorWeeks', [['sim', 'u32'], ['weeks', 'u32']]],
  ['SetJobSearch', [['sim', 'u32'], ['on', 'bool']]],
  ['SetFeeling', [['from', 'u32'], ['to', 'u32'], ['value', 'f32']]],
  ['StartFight', [['from', 'u32'], ['to', 'u32']]],
  ['SetFunds', [['cents', 'i64']]],
  ['AdjustFunds', [['cents', 'i64']]],
  ['SetBill', [['due_day', 'u32'], ['kind', 'u8'], ['amount_cents', 'i64'], ['late_fee_cents', 'i64']]],
  ['MoveBill', [['due_day', 'u32'], ['kind', 'u8'], ['to_due_day', 'u32']]],
  ['PayBill', [['due_day', 'u32'], ['kind', 'u8']]],
  ['MarkBillPaid', [['due_day', 'u32'], ['kind', 'u8']]],
  ['DeleteBill', [['due_day', 'u32'], ['kind', 'u8']]],
  ['AddBill', [['due_day', 'u32'], ['kind', 'u8'], ['amount_cents', 'i64'], ['late_fee_cents', 'i64']]],
] as const satisfies readonly (readonly [string, readonly (readonly [string, Field])[]])[];

type EditRow = typeof EDITS[number];
type EditName = EditRow[0];
type FieldType<F extends Field> = F extends 'bool' ? boolean : F extends 'optionU32' ? number | null : number;
type EditOf<R extends EditRow> = {
  readonly edit: R[0];
} & { readonly [P in R[1][number] as P[0]]: FieldType<P[1]> };

/** One edit of the world, as the shared fixture writes it (without the code). */
export type AdminEdit = { [R in EditRow as R[0]]: EditOf<R> }[EditName];
/** One player action in the panel and one Undo step: every edit applies, or none does. */
export interface AdminChange { readonly edits: readonly AdminEdit[] }

/** Each edit's wire code, by name. */
export const ADMIN_EDIT_CODES: Readonly<Record<EditName, number>> = Object.fromEntries(
  EDITS.map(([name], code) => [name, code]),
) as Record<EditName, number>;

const U32_MAX = 0xffffffff;

class Writer {
  readonly bytes: number[] = [];
  byte(value: number): void { this.bytes.push(value); }
  u8(value: number, what: string): void {
    check(Number.isInteger(value) && value >= 0 && value <= 255, `${what} is not a byte`);
    this.byte(value);
  }
  varint(value: bigint): void {
    do {
      const low = Number(value & 127n);
      value >>= 7n;
      this.byte(value ? low | 128 : low);
    } while (value);
  }
  u32(value: number, what: string): void {
    check(Number.isInteger(value) && value >= 0 && value <= U32_MAX, `${what} is not a u32`);
    this.varint(BigInt(value));
  }
  /** Postcard writes a signed integer zigzag, then as a varint. */
  i64(value: number, what: string): void {
    check(Number.isSafeInteger(value) && Math.abs(value) <= MAX_ADMIN_FUNDS_CENTS, `${what} is out of range`);
    const n = BigInt(value);
    this.varint(BigInt.asUintN(64, (n << 1n) ^ (n >> 63n)));
  }
  f32(value: number, what: string): void {
    check(Number.isFinite(value), `${what} is not finite`);
    const view = new DataView(new ArrayBuffer(4));
    view.setFloat32(0, value, true);
    check(Number.isFinite(view.getFloat32(0, true)), `${what} does not fit a float`);
    for (let at = 0; at < 4; at++) this.byte(view.getUint8(at));
  }
  bool(value: boolean, what: string): void {
    check(typeof value === 'boolean', `${what} is not a boolean`);
    this.byte(value ? 1 : 0);
  }
  optionU32(value: number | null, what: string): void {
    if (value === null) { this.byte(0); return; }
    this.byte(1);
    this.u32(value, what);
  }
}

/**
 * The bytes of `SimCommand::Admin` for `change`, for `admin_apply`. Throws
 * `AdminWireError` for an empty or oversized change, a field of the wrong
 * type or past its type's range, or a number that is not finite. Ranges the
 * simulation owns (a need's 0 to 100, a bill's due day) are its to refuse,
 * not this encoder's.
 */
export function encodeAdminChange(change: AdminChange): Uint8Array {
  check(change.edits.length >= 1 && change.edits.length <= MAX_ADMIN_EDITS, 'a change holds 1 to 1024 edits');
  const out = new Writer();
  out.byte(ADMIN_COMMAND_CODE);
  out.varint(BigInt(change.edits.length));
  for (const edit of change.edits) {
    const code = ADMIN_EDIT_CODES[edit.edit];
    check(code !== undefined, `unknown edit ${String(edit.edit)}`);
    const fields = EDITS[code][1] as readonly (readonly [string, Field])[];
    out.byte(code);
    const values = edit as unknown as Record<string, unknown>;
    for (const [name, type] of fields) {
      const what = `${edit.edit}.${name}`;
      const value = values[name];
      switch (type) {
        case 'u8': out.u8(value as number, what); break;
        case 'u32': out.u32(value as number, what); break;
        case 'i64': out.i64(value as number, what); break;
        case 'f32': out.f32(value as number, what); break;
        case 'bool': out.bool(value as boolean, what); break;
        case 'optionU32': out.optionU32(value as number | null, what); break;
      }
    }
  }
  return new Uint8Array(out.bytes);
}

// Typed dollars -------------------------------------------------------------

export type DollarsParse =
  | { readonly ok: true; readonly cents: number }
  /**
   * `empty`: nothing typed. `format`: not a plain dollar amount. `places`:
   * more than two decimal places. `range`: past the bound the funds, an
   * amount or a fee may take.
   */
  | { readonly ok: false; readonly reason: 'empty' | 'format' | 'places' | 'range' };

/**
 * Typed dollars to exact cents, from the text and never through a float
 * multiply ([AP-e-funds]). Accepts an optional minus sign and dollar sign,
 * comma groups of three, and at most two decimals: "2318.40", "-0.01",
 * "$1,000", ".5". Refuses exponents ("1e3"), spaces inside the number, more
 * than two decimals ("1.005") and anything past 10,000,000,000.00 either way.
 */
export function parseDollars(text: string): DollarsParse {
  const typed = text.trim();
  if (typed === '') return { ok: false, reason: 'empty' };
  const match = /^(-?)\$?(\d{1,3}(?:,\d{3})+|\d*)(?:\.(\d*))?$/.exec(typed);
  if (!match) return { ok: false, reason: 'format' };
  const [, sign, groups, decimals = ''] = match;
  const whole = groups.replaceAll(',', '');
  if (whole === '' && decimals === '') return { ok: false, reason: 'format' };
  if (decimals.length > 2) return { ok: false, reason: 'places' };
  const trimmed = whole.replace(/^0+(?=\d)/, '');
  // 10^10 dollars is eleven digits; refusing a longer run keeps the product exact.
  if (trimmed.length > 11) return { ok: false, reason: 'range' };
  const cents = Number(trimmed === '' ? '0' : trimmed) * 100 + Number(decimals.padEnd(2, '0'));
  if (cents > MAX_ADMIN_FUNDS_CENTS) return { ok: false, reason: 'range' };
  return { ok: true, cents: sign === '-' && cents !== 0 ? -cents : cents };
}

// Results -------------------------------------------------------------------

/** What `admin_begin` reports. */
export type AdminBeginResult = 'ok' | 'build-active' | 'would-not-reload' | 'already-open';
const BEGIN: readonly AdminBeginResult[] = ['ok', 'build-active', 'would-not-reload', 'already-open'];

export function decodeAdminBegin(code: number): AdminBeginResult {
  check(Number.isInteger(code) && code >= 0 && code < BEGIN.length, `begin result ${code}`);
  return BEGIN[code];
}

/** What `admin_undo` reports: stepped back, nothing to undo (or the panel is closed), or failed with the world unchanged. */
export type AdminUndoResult = 'ok' | 'nothing' | 'failed';
const UNDO: readonly AdminUndoResult[] = ['ok', 'nothing', 'failed'];

export function decodeAdminUndo(code: number): AdminUndoResult {
  check(Number.isInteger(code) && code >= 0 && code < UNDO.length, `undo result ${code}`);
  return UNDO[code];
}

/**
 * Why a change was refused, by the code the shell words ([AP-cmd-refusals]):
 * 1 the panel is closed, 2 not a housemate, 3 out of range, 4 unknown content,
 * 5 not found, 6 at work, 7 too many traits, 8 already worn, 9 not worn,
 * 10 no value, 11 same person, 12 bill exists, 13 bill paid, 14 bad due day,
 * 15 late fee too early, 16 late fee too high, 17 cannot afford, 18 busy,
 * 19 malformed (never sent by the panel), 99 would not load.
 */
export type AdminRefusalCode =
  1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 99;
export const ADMIN_REFUSAL_CODES: readonly AdminRefusalCode[] =
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 99];

export type AdminApplyResult =
  | { readonly applied: true; readonly depth: number }
  | { readonly applied: false; readonly edit: number; readonly refusal: AdminRefusalCode; readonly depth: number };

/** `[applied, edit index, refusal code, undo depth]` from `admin_apply`. */
export function decodeAdminApply(row: ArrayLike<number>): AdminApplyResult {
  check(row.length === 4, 'apply result length');
  const [applied, edit, code, depth] = [row[0], row[1], row[2], row[3]];
  check([applied, edit, code, depth].every(n => Number.isInteger(n) && n >= 0 && n <= U32_MAX), 'apply result values');
  if (applied === 1) {
    check(edit === 0 && code === 0, 'an applied change names no refusal');
    return { applied: true, depth };
  }
  check(applied === 0 && (ADMIN_REFUSAL_CODES as readonly number[]).includes(code), `refusal code ${code}`);
  return { applied: false, edit, refusal: code as AdminRefusalCode, depth };
}

// Reads ---------------------------------------------------------------------

function finite(row: ArrayLike<number>): void {
  for (let at = 0; at < row.length; at++) check(Number.isFinite(row[at]), 'a read holds a number that is not finite');
}

const NEED_COUNT = 7;
const PERSON_LEN = NEED_COUNT + 1 + 10;

export interface AdminPerson {
  /** In `NeedId` order: Hunger, Energy, Hygiene, Bladder, Social, Fun, Comfort. */
  readonly needs: readonly number[];
  readonly satisfaction: number;
  /** The career row held, or null with no job. The fields below are 0 without a job. */
  readonly careerRow: number | null;
  readonly shift: number;
  readonly pay: number;
  readonly jobSatisfaction: number;
  readonly goodWeeks: number;
  readonly poorWeeks: number;
  /** Whether they look for work on their own; meaningful with or without a job. */
  readonly searching: boolean;
  readonly advanceWeeks: number;
  readonly payMin: number;
  readonly payMax: number;
}

/** `admin_person`; null for anyone who is not a living housemate (the empty read). */
export function decodeAdminPerson(row: ArrayLike<number>): AdminPerson | null {
  if (row.length === 0) return null;
  check(row.length === PERSON_LEN, 'person length');
  finite(row);
  const at = NEED_COUNT;
  check(row[at + 1] === -1 || Number.isInteger(row[at + 1]) && row[at + 1] >= 0, 'career row');
  check(row[at + 7] === 0 || row[at + 7] === 1, 'job search flag');
  return {
    needs: Array.from({ length: NEED_COUNT }, (_, need) => row[need]),
    satisfaction: row[at],
    careerRow: row[at + 1] === -1 ? null : row[at + 1],
    shift: row[at + 2],
    pay: row[at + 3],
    jobSatisfaction: row[at + 4],
    goodWeeks: row[at + 5],
    poorWeeks: row[at + 6],
    searching: row[at + 7] === 1,
    advanceWeeks: row[at + 8],
    payMin: row[at + 9],
    payMax: row[at + 10],
  };
}

function rowsOf(row: ArrayLike<number>, width: number, what: string): void {
  check(row.length % width === 0, `${what} length`);
  finite(row);
}

export interface AdminRepetition {
  readonly object: number;
  readonly row: number;
  readonly value: number;
  /** A row that advertises Hunger: the rows that make a person Feeling sick. */
  readonly food: boolean;
}

/** `admin_repetition`: `[object, row, value, food]` per entry. */
export function decodeAdminRepetition(row: ArrayLike<number>): AdminRepetition[] {
  rowsOf(row, 4, 'repetition');
  return Array.from({ length: row.length / 4 }, (_, i) => {
    const flag = row[i * 4 + 3];
    check(flag === 0 || flag === 1, 'repetition food flag');
    return { object: row[i * 4], row: row[i * 4 + 1], value: row[i * 4 + 2], food: flag === 1 };
  });
}

export interface AdminTimer {
  /** 0 burnt dinner, 1 had a fight, 2 promoted, 3 got a raise, 4 demoted, 5 fired. */
  readonly timer: number;
  readonly endsTick: number;
}

/** `admin_timers`: `[timer code, ends tick]` per running timer. */
export function decodeAdminTimers(row: ArrayLike<number>): AdminTimer[] {
  rowsOf(row, 2, 'timers');
  return Array.from({ length: row.length / 2 }, (_, i) => {
    const timer = row[i * 2];
    check(Number.isInteger(timer) && timer >= 0 && timer <= 5, 'timer code');
    return { timer, endsTick: row[i * 2 + 1] };
  });
}

/** Where a moodlet comes from, when that has a short explanation. */
export type AdminMoodSource =
  | { readonly kind: 'other' }
  /** A need at or below `level`, the critical level when `critical`. `need` is the `NeedId` order. */
  | { readonly kind: 'need'; readonly need: number; readonly critical: boolean; readonly level: number }
  | { readonly kind: 'job' }
  /** The feeling about the housemate with this `SimId`. */
  | { readonly kind: 'feeling'; readonly sim: number }
  | { readonly kind: 'bills' }
  | { readonly kind: 'timer'; readonly timer: number; readonly endsTick: number };

export interface AdminMoodlet { readonly source: AdminMoodSource; readonly score: number }

/**
 * `admin_moodlets`: `[kind, arg, score, ends tick or -1]` per moodlet, in the
 * order of `mood_summary_of` after its overall label. Kinds: 0 other; 10 to
 * 16 a need at the low level and 20 to 26 at the critical level (`arg` the
 * level); 30 job satisfaction; 31 a feeling (`arg` the other's `SimId`); 32 an
 * overdue bill; 40 to 45 a timed moodlet (`ends` its end tick).
 */
export function decodeAdminMoodlets(row: ArrayLike<number>): AdminMoodlet[] {
  rowsOf(row, 4, 'moodlets');
  return Array.from({ length: row.length / 4 }, (_, i) => {
    const [kind, arg, score, ends] = [row[i * 4], row[i * 4 + 1], row[i * 4 + 2], row[i * 4 + 3]];
    let source: AdminMoodSource;
    if (kind === 0) source = { kind: 'other' };
    else if (kind >= 10 && kind <= 16) source = { kind: 'need', need: kind - 10, critical: false, level: arg };
    else if (kind >= 20 && kind <= 26) source = { kind: 'need', need: kind - 20, critical: true, level: arg };
    else if (kind === 30) source = { kind: 'job' };
    else if (kind === 31) source = { kind: 'feeling', sim: arg };
    else if (kind === 32) source = { kind: 'bills' };
    else if (kind >= 40 && kind <= 45) source = { kind: 'timer', timer: kind - 40, endsTick: ends };
    else throw new AdminWireError(`moodlet kind ${kind}`);
    return { source, score };
  });
}

export interface AdminBill {
  readonly dueDay: number;
  /** 0 rent, 1 electricity, 2 water, 3 transportation. */
  readonly kind: number;
  readonly amountCents: number;
  readonly lateFeeCents: number;
  /** The day it was paid, or null while unpaid. */
  readonly paidDay: number | null;
  readonly feeCapCents: number;
  /** The first day the bill is overdue. */
  readonly overdueFrom: number;
}

export interface AdminBills {
  /** In due-day then kind order, as the record keeps them. */
  readonly bills: readonly AdminBill[];
  /** The due days a bill can take, newest first. */
  readonly dueDays: readonly number[];
}

const BILL_ROW_LEN = 7;

/** `admin_bills`: the bill count n, n rows of seven numbers, then the due days. */
export function decodeAdminBills(row: ArrayLike<number>): AdminBills {
  check(row.length >= 1, 'bills length');
  finite(row);
  const count = row[0];
  check(Number.isInteger(count) && count >= 0 && 1 + count * BILL_ROW_LEN <= row.length, 'bill count');
  const bills = Array.from({ length: count }, (_, i) => {
    const at = 1 + i * BILL_ROW_LEN;
    return {
      dueDay: row[at], kind: row[at + 1], amountCents: row[at + 2], lateFeeCents: row[at + 3],
      paidDay: row[at + 4] === -1 ? null : row[at + 4], feeCapCents: row[at + 5], overdueFrom: row[at + 6],
    };
  });
  return { bills, dueDays: Array.from({ length: row.length - 1 - count * BILL_ROW_LEN }, (_, i) => row[1 + count * BILL_ROW_LEN + i]) };
}

/** `admin_affinities`: one value per affinity kind in pack order, -1 to 1; empty for a non-housemate. */
export function decodeAdminAffinities(row: ArrayLike<number>): number[] {
  finite(row);
  const values = Array.from(row);
  check(values.every(value => value >= -1 && value <= 1), 'an affinity outside -1 to 1');
  return values;
}

/** `admin_trait_skills`: per pack trait, the skill a capability trains, or null. */
export function decodeAdminTraitSkills(row: ArrayLike<number>): (number | null)[] {
  finite(row);
  return Array.from(row, value => {
    check(value === -1 || Number.isInteger(value) && value >= 0, 'a trait skill index');
    return value === -1 ? null : value;
  });
}

/** One level of one career path: the row `SetJob` takes and the shift it is sent with. */
export interface AdminJobOption {
  readonly path: number;
  readonly level: number;
  readonly row: number;
  /** The first shift the level offers, or null when it offers none and cannot be chosen. */
  readonly firstShift: number | null;
}

/** `admin_job_options`: `[path, level, row, first shift or -1]` per career level, in path then level order. */
export function decodeAdminJobOptions(row: ArrayLike<number>): AdminJobOption[] {
  rowsOf(row, 4, 'job options');
  return Array.from({ length: row.length / 4 }, (_, i) => {
    const [path, level, held, shift] = [row[i * 4], row[i * 4 + 1], row[i * 4 + 2], row[i * 4 + 3]];
    check([path, level, held].every(n => Number.isInteger(n) && n >= 0), 'a job option');
    check(shift === -1 || Number.isInteger(shift) && shift >= 0, 'a job option shift');
    return { path, level, row: held, firstShift: shift === -1 ? null : shift };
  });
}

/** The tuning the panel's ranges and words come from. */
export interface AdminLimits {
  /** The most repetition an entry holds. */
  readonly habituationMax: number;
  /** Above this, repetition is Overdoing. */
  readonly overdoingThreshold: number;
  /** At or above this, a food row reads Feeling sick. */
  readonly sickThreshold: number;
  /** The most traits a person wears. */
  readonly maxTraits: number;
  /** The most poor weeks in a row the panel sets. */
  readonly maxPoorWeeks: number;
  /** The most hours one Skip ahead runs. */
  readonly skipMaxHours: number;
  /** The hours the Skip box starts with. */
  readonly skipDefaultHours: number;
  /** The ticks Skip ahead runs in one rendered frame. */
  readonly skipTicksPerFrame: number;
}

/**
 * `admin_limits`: `[habituation_max, overdoing_threshold, sick_threshold,
 * housemate_max_traits, most poor weeks, skip maximum hours, skip default
 * hours, skip ticks per frame]`.
 */
export function decodeAdminLimits(row: ArrayLike<number>): AdminLimits {
  check(row.length === 8, 'limits length');
  finite(row);
  check(row[0] > 0 && row[1] > 0 && row[2] > 0, 'limits are positive');
  check(Number.isInteger(row[3]) && row[3] >= 1 && Number.isInteger(row[4]) && row[4] >= 0, 'limit counts');
  check([row[5], row[6], row[7]].every(n => Number.isInteger(n) && n >= 1) && row[6] <= row[5], 'skip limits');
  return {
    habituationMax: row[0], overdoingThreshold: row[1], sickThreshold: row[2], maxTraits: row[3], maxPoorWeeks: row[4],
    skipMaxHours: row[5], skipDefaultHours: row[6], skipTicksPerFrame: row[7],
  };
}
