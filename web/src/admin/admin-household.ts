import { BILL_NAMES, formatDay } from '../ui/bills-text.js';
import { WEEKDAY_NAMES, formatTimeOfDay } from '../ui/game-hud.js';
import { MAX_ADMIN_FUNDS_CENTS, type AdminBill, type AdminBills, type AdminEdit } from './codec.js';
import type { AdminTab, AdminTabContext, AdminTabFactory } from './admin-panel.js';
import { HOUSEHOLD_WORDS as W, undoLabels } from './admin-words.js';
import {
  actionButton, createSection, formatMoney, labelled, make, moneyBox, numberRow, rebuild, selectControl, textNode,
  type SelectOption, type Section,
} from './admin-controls.js';

// The admin panel's Household tab (issue 312, [AP-e-house] and [AP-skip] in
// docs/specs/2026-11-20-admin-panel.md): the funds, the bills, the clock and
// Skip ahead, as Mockup C.
//
// A bill is named by its due day and kind. A paid bill can only be deleted. A
// late fee belongs to a bill only once its grace days have passed, so the fee
// box stays shut until then. Skip ahead is the shell's: this tab asks
// `context.skip` and shows what it says, and while a skip runs every control
// but Stop is shut.

/** The funds buttons' amounts, in cents: labels of this view, as the review window's presets are. */
const ADD_SMALL = 100_000;
const ADD_LARGE = 1_000_000;

/** What the tab reads, by name; `main.ts` adapts the bridge to it. */
export interface HouseholdSource {
  fundsCents(): number;
  /** The bills in the record's order and the due days a bill can take, newest first. */
  bills(): AdminBills;
  /** The terms a new bill is issued under and the next due day, or null in a world without bills. */
  terms(): { readonly graceDays: number; readonly lateFeePercent: number; readonly lateFeeCapPercent: number; readonly nextDueDay: number } | null;
  /** What each kind's bill has come to this month so far, in cents, by kind. */
  monthAmounts(): readonly number[];
  clockTick(): number;
  dayTicks(): number;
  /** The weekday of the current tick, 0 for Monday. */
  weekdayIndex(): number;
}

/** A new bill as it is being filled in; it survives every redraw until it is added. */
interface Draft {
  kind: number;
  /** The chosen due day, or null for the newest on offer. */
  due: number | null;
  /** The typed amount in cents, or null while the kind's own amount stands. */
  amountCents: number | null;
  feeCents: number;
}

/**
 * Names a bill cell for the phone's card layout, which drops the table header
 * and writes each field's name above its box from this attribute ([AP-web-phone]).
 */
function withDataLabel(cell: HTMLElement, label: string): HTMLElement {
  cell.setAttribute('data-label', label);
  return cell;
}

class HouseholdTab implements AdminTab {
  readonly body: HTMLElement;
  private readonly funds: Section;
  private readonly time: Section;
  private readonly bills: Section;
  private draft: Draft = { kind: 0, due: null, amountCents: null, feeCents: 0 };
  private skipHours: number | null = null;
  private skipLine: HTMLElement | null = null;
  private nowNode: HTMLElement | null = null;

  constructor(private readonly context: AdminTabContext, private readonly source: HouseholdSource) {
    const doc = context.doc;
    this.funds = createSection(doc, W.funds);
    this.time = createSection(doc, W.time);
    this.bills = createSection(doc, W.bills);
    this.body = make(doc, 'div', 'admin-household');
    const left = make(doc, 'div', 'admin-column');
    left.append(this.funds.root, this.time.root);
    const right = make(doc, 'div', 'admin-column admin-bills-column');
    right.append(this.bills.root);
    this.body.append(left, right);
  }

  refresh(): void {
    // A status is about the change just sent, which the shell reports after this returns.
    for (const section of [this.funds, this.time, this.bills]) section.report(null);
    this.draw();
  }

  /**
   * A skip started, moved or ended. While it runs only its line and the clock
   * change, so the Stop button keeps its focus and Now shows the time reached.
   */
  skipChanged(): void {
    const state = this.context.skip.state();
    if (state.running && this.skipLine !== null) {
      this.skipLine.textContent = W.skipping(state.done, state.asked);
      if (this.nowNode !== null) this.nowNode.textContent = this.clockText();
    } else this.draw();
  }

  /** "Day {n}, {Weekday}, {hh:mm}" for the world's clock now. */
  private clockText(): string {
    const tick = this.source.clockTick();
    const dayTicks = this.source.dayTicks();
    return W.clock(Math.floor(tick / dayTicks) + 1, WEEKDAY_NAMES[this.source.weekdayIndex()] ?? '', formatTimeOfDay(tick % dayTicks, dayTicks));
  }

  private draw(): void {
    const locked = this.context.skip.state().running;
    this.drawFunds(locked);
    this.drawTime();
    this.drawBills(locked);
  }

  private weekday(day: number): string {
    const today = Math.floor(this.source.clockTick() / this.source.dayTicks());
    const count = WEEKDAY_NAMES.length;
    return WEEKDAY_NAMES[(((this.source.weekdayIndex() + day - today) % count) + count) % count];
  }

  private dayLabel(day: number): string {
    return W.day(day + 1, this.weekday(day));
  }

  private today(): number {
    return Math.floor(this.source.clockTick() / this.source.dayTicks());
  }

  // ---- Funds ---------------------------------------------------------------

  private drawFunds(locked: boolean): void {
    const doc = this.context.doc;
    const section = this.funds;
    const cents = this.source.fundsCents();
    const send = (edit: AdminEdit, label: string): void => { this.context.apply({ edits: [edit] }, { label, report: section.report }); };
    rebuild(doc, section.body, section.heading, () => {
      const row = make(doc, 'div', 'admin-row admin-funds-row');
      row.append(textNode(doc, 'span', 'admin-prefix', '$'), moneyBox({
        doc, label: W.funds, key: 'funds', cents, min: -MAX_ADMIN_FUNDS_CENTS, max: MAX_ADMIN_FUNDS_CENTS, disabled: locked,
        onCommit: value => send({ edit: 'SetFunds', cents: value }, undoLabels.funds),
        onPlaces: () => section.report(W.places),
      }));
      const buttons = make(doc, 'div', 'admin-row admin-funds-buttons');
      const adjust = (text: string, key: string, amount: number, label: string) => actionButton(doc, {
        text, key, disabled: locked, onClick: () => send({ edit: 'AdjustFunds', cents: amount }, label),
      });
      buttons.append(
        adjust(W.addThousand, 'funds-add-small', ADD_SMALL, undoLabels.addThousand),
        adjust(W.subtractThousand, 'funds-subtract-small', -ADD_SMALL, undoLabels.subtractThousand),
        adjust(W.addTenThousand, 'funds-add-large', ADD_LARGE, undoLabels.addTenThousand),
        actionButton(doc, {
          text: W.zeroFunds, key: 'funds-zero', disabled: locked || cents === 0,
          onClick: () => send({ edit: 'SetFunds', cents: 0 }, undoLabels.zeroFunds),
        }),
      );
      return [row, buttons];
    });
  }

  // ---- Time and Skip ahead -------------------------------------------------

  private drawTime(): void {
    const doc = this.context.doc;
    const section = this.time;
    const skip = this.context.skip;
    const state = skip.state();
    this.skipLine = null;
    rebuild(doc, section.body, section.heading, () => {
      this.nowNode = textNode(doc, 'strong', 'admin-now', this.clockText());
      const nodes: HTMLElement[] = [labelled(doc, W.now, this.nowNode)];
      if (!skip.available()) return nodes;
      const limits = skip.limits();
      this.skipHours ??= limits.defaultHours;
      const toggle = actionButton(doc, {
        text: state.running ? W.stop : W.skip, key: 'skip-toggle', intent: state.running ? 'negative' : 'neutral',
        onClick: () => (state.running ? skip.stop() : skip.start(this.skipHours ?? limits.defaultHours)),
      });
      nodes.push(numberRow({
        doc, label: W.skipBy, key: 'skip-hours', min: 1, max: limits.maxHours, step: 1, decimals: 0, value: this.skipHours,
        disabled: state.running,
        onCommit: hours => { this.skipHours = hours; },
      }, [textNode(doc, 'span', 'admin-word', W.hours), toggle]).root);
      nodes.push(textNode(doc, 'p', 'admin-note', W.skipNote));
      let line = '';
      if (state.running) line = W.skipping(state.done, state.asked);
      else if (state.last !== null) {
        const last = state.last;
        line = last.kind === 'done' ? W.skipped(last.hours) : last.kind === 'stopped' ? W.stopped(last.hours) : W.died(last.hours, last.name);
      }
      const status = textNode(doc, 'p', 'admin-skip-line', line);
      status.setAttribute('role', 'status');
      this.skipLine = status;
      nodes.push(status);
      return nodes;
    });
  }

  // ---- Bills ---------------------------------------------------------------

  private drawBills(locked: boolean): void {
    const doc = this.context.doc;
    const section = this.bills;
    const { bills, dueDays } = this.source.bills();
    const terms = this.source.terms();
    const unpaid = bills.filter(bill => bill.paidDay === null);
    const withFees = unpaid.filter(bill => bill.lateFeeCents > 0);
    const funds = this.source.fundsCents();

    rebuild(doc, section.actions, section.heading, () => {
      const buttons: HTMLElement[] = [];
      if (withFees.length > 0) {
        buttons.push(actionButton(doc, {
          text: W.removeFees, key: 'bills-remove-fees', disabled: locked,
          onClick: () => this.sendBills(section, withFees.map(bill => ({
            edit: 'SetBill', due_day: bill.dueDay, kind: bill.kind, amount_cents: bill.amountCents, late_fee_cents: 0,
          })), undoLabels.removeLateFees),
        }));
      }
      if (unpaid.length > 0) {
        buttons.push(actionButton(doc, {
          text: W.markAllPaid, key: 'bills-mark-all', disabled: locked,
          onClick: () => this.sendBills(section, unpaid.map(bill => ({ edit: 'MarkBillPaid', due_day: bill.dueDay, kind: bill.kind })), undoLabels.markAllPaid),
        }));
      }
      return buttons;
    });

    rebuild(doc, section.body, section.heading, () => {
      const table = make(doc, 'table', 'admin-bill-table');
      const head = make(doc, 'thead');
      const headRow = make(doc, 'tr');
      for (const title of [W.bill, W.due, W.amount, W.lateFee, W.status, '']) headRow.append(textNode(doc, 'th', 'admin-bill-head', title));
      head.append(headRow);
      const body = make(doc, 'tbody');
      for (const bill of bills) body.append(this.billRow(bill, dueDays, funds, locked));
      body.append(this.newRow(dueDays, terms, locked));
      table.append(head, body);
      const nodes: HTMLElement[] = [table];
      if (bills.length === 0) nodes.unshift(textNode(doc, 'p', 'admin-note', W.noBills));
      const notes = make(doc, 'div', 'admin-bill-notes');
      if (terms !== null) {
        notes.append(
          textNode(doc, 'p', 'admin-note', W.nextDue(terms.nextDueDay + 1, this.weekday(terms.nextDueDay))),
          textNode(doc, 'p', 'admin-note', W.feeRule(terms.lateFeePercent, terms.graceDays, terms.lateFeeCapPercent)),
        );
      }
      notes.append(textNode(doc, 'p', 'admin-note', W.autoPay));
      nodes.push(notes);
      return nodes;
    });
  }

  private sendBills(section: Section, edits: AdminEdit[], label: string, words?: { kind?: string; day?: number; cap?: string }, done?: () => void): void {
    this.context.apply({ edits }, {
      label,
      words,
      report: message => {
        section.report(message);
        if (message === null) done?.();
      },
    });
  }

  /** The most a bill of `amount` holds in late fees under the current terms, in cents. */
  private feeCap(amount: number): number {
    const percent = this.source.terms()?.lateFeeCapPercent;
    return percent === undefined ? Number.MAX_SAFE_INTEGER : Math.floor(amount * percent / 100);
  }

  /** The due days on offer, with `own` kept when it has fallen out of the window. */
  private dueOptions(dueDays: readonly number[], own?: number): SelectOption[] {
    const days = own === undefined || dueDays.includes(own) ? [...dueDays] : [...dueDays, own].sort((a, b) => b - a);
    return days.map(day => ({ value: String(day), label: this.dayLabel(day) }));
  }

  private billRow(bill: AdminBill, dueDays: readonly number[], funds: number, locked: boolean): HTMLElement {
    const doc = this.context.doc;
    const section = this.bills;
    const name = BILL_NAMES[bill.kind as 0 | 1 | 2 | 3];
    const rowName = `${name} ${formatDay(bill.dueDay)}`;
    const key = `bill-${bill.dueDay}-${bill.kind}`;
    const paid = bill.paidDay !== null;
    const today = this.today();
    const feeShut = paid || today < bill.overdueFrom;
    const words = { kind: name.toLowerCase(), day: bill.overdueFrom, cap: formatMoney(bill.feeCapCents) };
    const send = (edits: AdminEdit[], label: string): void => this.sendBills(section, edits, label, words);
    const row = make(doc, 'tr', 'admin-bill-row');
    row.setAttribute('data-bill', `${bill.dueDay}:${bill.kind}`);
    const cell = (className: string, ...children: (HTMLElement | string)[]): HTMLElement => {
      const td = make(doc, 'td', className);
      td.append(...children);
      return td;
    };
    const money = (word: string, suffix: string, cents: number, min: number, max: number, disabled: boolean, commit: (value: number) => void): HTMLElement => withDataLabel(cell(
      'admin-bill-money', textNode(doc, 'span', 'admin-prefix', '$'),
      moneyBox({ doc, label: `${rowName} ${word}`, key: `${key}-${suffix}`, cents, min, max, disabled, onCommit: commit }),
    ), suffix === 'amount' ? W.amount : W.lateFee);
    const overdue = !paid && today >= bill.overdueFrom;
    const status = paid ? W.paidDay(bill.paidDay! + 1) : overdue ? W.overdue : W.noFeeUntil(bill.overdueFrom + 1);
    // Overdue needs action (danger colour, bold); the grace status is a warning; Paid is done.
    const statusClass = paid ? 'admin-bill-status admin-bill-paid' : overdue ? 'admin-bill-status admin-bill-overdue' : 'admin-bill-status admin-bill-grace';
    row.append(
      cell('admin-bill-name', name),
      withDataLabel(cell('admin-bill-due', selectControl({
        doc, label: `${rowName} ${W.due.toLowerCase()}`, key: `${key}-due`, options: this.dueOptions(dueDays, bill.dueDay),
        value: String(bill.dueDay), disabled: paid || locked,
        onCommit: to => send([{ edit: 'MoveBill', due_day: bill.dueDay, kind: bill.kind, to_due_day: Number(to) }], undoLabels.moveBill(name)),
      })), W.due),
      money(W.amount.toLowerCase(), 'amount', bill.amountCents, 1, MAX_ADMIN_FUNDS_CENTS, paid || locked, amount => {
        // A smaller amount lowers the most a fee can be, so a fee over it comes down with it.
        const fee = Math.min(bill.lateFeeCents, this.feeCap(amount));
        send([{ edit: 'SetBill', due_day: bill.dueDay, kind: bill.kind, amount_cents: amount, late_fee_cents: fee }], undoLabels.bill(name));
      }),
      money(W.lateFee.toLowerCase(), 'fee', bill.lateFeeCents, 0, Math.max(0, bill.feeCapCents), feeShut || locked, fee =>
        send([{ edit: 'SetBill', due_day: bill.dueDay, kind: bill.kind, amount_cents: bill.amountCents, late_fee_cents: fee }], undoLabels.bill(name))),
      cell(statusClass, status),
    );
    const actions = make(doc, 'td', 'admin-bill-actions');
    if (!paid) {
      const short = funds < bill.amountCents + bill.lateFeeCents;
      actions.append(
        actionButton(doc, {
          text: W.pay, key: `${key}-pay`, name: `${rowName}: ${W.pay}`, disabled: locked || short,
          onClick: () => send([{ edit: 'PayBill', due_day: bill.dueDay, kind: bill.kind }], undoLabels.payBill(name)),
        }),
        actionButton(doc, {
          text: W.markPaid, key: `${key}-mark`, name: `${rowName}: ${W.markPaid}`, disabled: locked,
          onClick: () => send([{ edit: 'MarkBillPaid', due_day: bill.dueDay, kind: bill.kind }], undoLabels.markBillPaid(name)),
        }),
      );
      if (short) actions.append(textNode(doc, 'span', 'admin-note', W.cannotCover));
    }
    actions.append(actionButton(doc, {
      text: W.remove, key: `${key}-delete`, name: `${rowName}: ${W.remove}`, intent: 'destructive', disabled: locked,
      onClick: () => send([{ edit: 'DeleteBill', due_day: bill.dueDay, kind: bill.kind }], undoLabels.deleteBill(name)),
    }));
    row.append(actions);
    return row;
  }

  /** The row that adds a bill: kind, due day, amount, late fee and Add bill. */
  private newRow(dueDays: readonly number[], terms: ReturnType<HouseholdSource['terms']>, locked: boolean): HTMLElement {
    const doc = this.context.doc;
    const section = this.bills;
    const draft = this.draft;
    const grace = terms?.graceDays ?? 0;
    const today = this.today();
    const due = draft.due !== null && dueDays.includes(draft.due) ? draft.due : dueDays[0];
    const kindName = BILL_NAMES[draft.kind as 0 | 1 | 2 | 3];
    const monthly = this.source.monthAmounts()[draft.kind] ?? 0;
    const amount = draft.amountCents ?? Math.max(1, monthly);
    const feeShut = due === undefined || today < due + grace;
    const cap = this.feeCap(amount);
    const fee = feeShut ? 0 : Math.min(draft.feeCents, cap);
    const redraw = (): void => this.draw();
    const row = make(doc, 'tr', 'admin-bill-new');
    const cell = (className: string, ...children: HTMLElement[]): HTMLElement => {
      const td = make(doc, 'td', className);
      td.append(...children);
      return td;
    };
    const money = (word: string, suffix: string, cents: number, min: number, max: number, disabled: boolean, commit: (value: number) => void): HTMLElement => withDataLabel(cell(
      'admin-bill-money', textNode(doc, 'span', 'admin-prefix', '$'),
      moneyBox({ doc, label: word, key: `bill-new-${suffix}`, cents, min, max, disabled, onCommit: commit }),
    ), word);
    row.append(
      withDataLabel(cell('admin-bill-name', selectControl({
        doc, label: W.bill, key: 'bill-new-kind', disabled: locked, value: String(draft.kind),
        options: BILL_NAMES.map((label, kind) => ({ value: String(kind), label })),
        onCommit: value => { draft.kind = Number(value); redraw(); },
      })), W.bill),
      withDataLabel(cell('admin-bill-due', selectControl({
        doc, label: W.due, key: 'bill-new-due', options: this.dueOptions(dueDays), value: due === undefined ? '' : String(due),
        disabled: locked || due === undefined,
        onCommit: value => { draft.due = Number(value); redraw(); },
      })), W.due),
      money(W.amount, 'amount', amount, 1, MAX_ADMIN_FUNDS_CENTS, locked, value => { draft.amountCents = value; redraw(); }),
      money(W.lateFee, 'fee', fee, 0, cap, locked || feeShut, value => { draft.feeCents = value; }),
      cell('admin-bill-status'),
      cell('admin-bill-actions', actionButton(doc, {
        text: W.addBill, key: 'bill-new-add', intent: 'affirmative', disabled: locked || due === undefined,
        onClick: () => {
          if (due === undefined) return;
          // The fee box does not redraw the row, so the fee is the draft's as it stands now.
          const typedFee = feeShut ? 0 : Math.min(draft.feeCents, cap);
          this.sendBills(section, [{ edit: 'AddBill', due_day: due, kind: draft.kind, amount_cents: amount, late_fee_cents: typedFee }],
            undoLabels.addBill(kindName), { kind: kindName.toLowerCase(), day: due + grace, cap: formatMoney(cap) },
            // The kind's own amount comes back for the next one.
            () => { draft.amountCents = null; draft.feeCents = 0; redraw(); });
        },
      })),
    );
    return row;
  }
}

/** The Household tab, for the shell's `tabs` map. */
export function createHouseholdTab(source: HouseholdSource): AdminTabFactory {
  return context => new HouseholdTab(context, source);
}
