/**
 * The read-only Bills panel ([WB-panel] in
 * `docs/specs/2026-10-18-wages-and-bills.md`): what to keep aside, the
 * overdue bills, the next bills line by line, last month and how bills
 * work. Payment is automatic, so the panel has no Pay button. It is a modal
 * dialog that pauses the game while it is open, in the pattern of the
 * Chores dialog.
 */
import type { BillKindLabels, BillLine, BillsOverview, IssuedBill, NextBill } from '../bridge.js';
import { setActionIntent } from './action-intent.js';
import { billName, billsRules, formatCents, formatDay } from './bills-text.js';
import { WEEKDAY_NAMES } from './game-hud.js';

/** What the panel reads from the simulation. */
export interface BillsSource {
  billsOverview(): BillsOverview | null;
  billsNext(): NextBill[];
  billsLines(kind: number): BillLine[];
  billsOverdue(): IssuedBill[];
  billsLastMonth(): IssuedBill[];
  billKindLabels(): BillKindLabels;
  clockTick(): number;
  dayTicks(): number;
  weekdayIndex(): number;
}

/** The game's overlay pause: the panel holds it under the reason `bills` while open. */
export interface BillsPause {
  suspend(reason: string): void;
  resume(reason: string): void;
}

const PAUSE_REASON = 'bills';

/**
 * The weekday of day index `day`, from today's index and weekday. Weekdays
 * advance one a day, so the shell needs only the simulation's answer for
 * today. Null when an input cannot be read.
 */
export function weekdayOf(day: number, today: number, todayWeekday: number): string | null {
  if (![day, today, todayWeekday].every(Number.isInteger)) return null;
  const count = WEEKDAY_NAMES.length;
  return WEEKDAY_NAMES[(((todayWeekday + day - today) % count) + count) % count] ?? null;
}

/** `Day 8, Monday`, or `Day 8` when the weekday cannot be read. */
function dayAndWeekday(day: number, weekday: string | null): string {
  return weekday === null ? formatDay(day) : `${formatDay(day)}, ${weekday}`;
}

/**
 * A tile line: `Indoor tiles: 192 at $0.90 a month, 1 of 7 days: $24.69`, or, once the
 * layout changed this month so the days counted held other numbers of
 * tiles, today's count and the month's daily average, so the amount can be
 * checked. `monthDays` is the number of days counted.
 */
function tileLineText(name: string, line: BillLine, monthDays: number, monthLength: number): string {
  const rate = `at ${formatCents(line.unitCents)} a month, ${monthDays} of ${monthLength} days: ${formatCents(line.amountCents)}`;
  if (monthDays === 0 || line.tileDays === line.count * monthDays) return `${name}: ${line.count} ${rate}`;
  const average = (line.tileDays / monthDays).toLocaleString('en-US', { maximumFractionDigits: 1 });
  return `${name}: ${line.count} today, ${average} a day on average this month, ${rate}`;
}

/**
 * One line of a next bill as the panel shows it, or null for a usage line
 * with nothing counted. `daysPerMonth` is the `{m}` of the base charge
 * line (the month length the month is counted under), and `monthDays` the
 * days counted so far.
 */
export function billLineText(line: BillLine, labels: BillKindLabels, daysPerMonth: number, monthDays: number): string | null {
  switch (line.line) {
    case 0:
      return `Base charge, ${line.count} of ${daysPerMonth} days: ${formatCents(line.amountCents)}`;
    case 1:
      return tileLineText('Indoor tiles', line, monthDays, daysPerMonth);
    case 2:
      return tileLineText('Outdoor tiles', line, monthDays, daysPerMonth);
    case 3: {
      const label = labels.uses[line.kindIndex];
      return line.count === 0 || label === undefined ? null
        : `${label}: ${line.count} x ${formatCents(line.unitCents)}`;
    }
    case 4: {
      const label = labels.daily[line.kindIndex];
      return line.count === 0 || label === undefined ? null
        : `${label}: ${line.count} ${line.count === 1 ? 'day' : 'days'} x ${formatCents(line.unitCents)}`;
    }
    case 5:
      return `Trips to work: ${line.count} x ${formatCents(line.unitCents)}`;
  }
}

/** `{amount} plus {fees} in late fees`, or the amount alone without fees. */
function withFees(bill: IssuedBill): string {
  return bill.feeCents > 0
    ? `${formatCents(bill.amountCents)} plus ${formatCents(bill.feeCents)} in late fees`
    : formatCents(bill.amountCents);
}

/** An overdue bill's line: `Rent due Day 8: $293.60 plus $14.68 in late fees`, without the fees while there are none. */
export function overdueLineText(bill: IssuedBill): string {
  return `${billName(bill.kind)} due ${formatDay(bill.dueDay)}: ${withFees(bill)}`;
}

/** A bill of last month: `Rent: $293.60, paid Day 8` or `Rent: $293.60, unpaid`. */
export function lastMonthLineText(bill: IssuedBill): string {
  const state = bill.paidDay === null ? 'unpaid' : `paid ${formatDay(bill.paidDay)}`;
  return `${billName(bill.kind)}: ${withFees(bill)}, ${state}`;
}

/**
 * The keep-aside sentence. The amount counts every unpaid bill as well as
 * the next bills, so the sentence names the unpaid ones when there are any.
 */
export function keepAsideText(overview: BillsOverview, due: string): string {
  const what = overview.unpaidCents > 0 ? 'the unpaid bills and the bills' : 'the bills';
  return `Keep aside ${formatCents(overview.keepAsideCents)} for ${what} due ${due}.`;
}

/**
 * When the earliest unpaid bill becomes overdue, while it is not yet:
 * `Unpaid bills due Day 8 are overdue from Day 13.`; null otherwise.
 */
export function overdueFromText(overview: BillsOverview): string | null {
  if (overview.unpaidDueDay === null || overview.overdueFromDay === null || overview.overdueCents > 0) return null;
  return `Unpaid bills due ${formatDay(overview.unpaidDueDay)} are overdue from ${formatDay(overview.overdueFromDay)}.`;
}

/** Everything the panel shows, read at once so one comparison decides whether to redraw. */
interface Reading {
  readonly overview: BillsOverview;
  readonly today: number;
  readonly weekday: number;
  readonly next: readonly NextBill[];
  readonly lines: readonly (readonly BillLine[])[];
  readonly overdue: readonly IssuedBill[];
  readonly lastMonth: readonly IssuedBill[];
}

export class BillsPanel {
  private readonly dialog: HTMLDialogElement;
  private readonly body: HTMLElement;
  private labels: BillKindLabels | null = null;
  private opener: { focus(): void } | null = null;
  private signature = '';
  /** The bill kinds whose rows the player has expanded, kept across redraws. */
  private readonly expanded = new Set<number>();

  constructor(
    private readonly source: BillsSource,
    private readonly doc: Document,
    private readonly pause: BillsPause,
  ) {
    this.dialog = doc.createElement('dialog');
    this.dialog.id = 'bills-dialog';
    this.dialog.setAttribute('aria-labelledby', 'bills-title');
    const title = doc.createElement('h2');
    title.id = 'bills-title';
    title.textContent = 'Bills';
    const close = doc.createElement('button');
    close.type = 'button';
    close.className = 'hud-button';
    close.textContent = 'Close';
    setActionIntent(close, 'negative');
    close.addEventListener('click', () => this.close());
    const header = doc.createElement('header');
    header.className = 'bills-header';
    header.append(title, close);
    this.body = doc.createElement('div');
    this.body.className = 'bills-body';
    this.dialog.append(header, this.body);
    // Escape closes a modal dialog by itself; either way the game resumes
    // and focus goes back to what opened the panel.
    this.dialog.addEventListener('close', () => {
      this.pause.resume(PAUSE_REASON);
      const opener = this.opener;
      this.opener = null;
      opener?.focus();
    });
  }

  /** The dialog, for the page to attach. */
  element(): HTMLDialogElement {
    return this.dialog;
  }

  isOpen(): boolean {
    return this.dialog.open;
  }

  /**
   * Pauses the game and opens the panel; false when it is already open or
   * there are no bills. `opener`, such as the Bills row's button, gets the
   * focus back when the panel closes.
   */
  open(opener: { focus(): void } | null = null): boolean {
    if (this.dialog.open || this.source.billsOverview() === null) return false;
    this.opener = opener;
    this.pause.suspend(PAUSE_REASON);
    this.signature = '';
    this.update();
    this.dialog.showModal();
    return true;
  }

  close(): void {
    if (this.dialog.open) this.dialog.close();
  }

  /** Redraws the panel when what it shows has changed. */
  update(): void {
    const reading = this.read();
    const signature = JSON.stringify(reading);
    if (signature === this.signature) return;
    this.signature = signature;
    this.body.replaceChildren(...(reading === null ? [] : this.render(reading)));
  }

  private read(): Reading | null {
    const overview = this.source.billsOverview();
    if (overview === null) return null;
    const dayTicks = this.source.dayTicks();
    const today = Math.floor(this.source.clockTick() / dayTicks);
    const next = this.source.billsNext();
    return {
      overview,
      today,
      weekday: this.source.weekdayIndex(),
      next,
      lines: next.map(bill => this.source.billsLines(bill.kind)),
      overdue: this.source.billsOverdue(),
      lastMonth: this.source.billsLastMonth(),
    };
  }

  private kindLabels(): BillKindLabels {
    this.labels ??= this.source.billKindLabels();
    return this.labels;
  }

  private section(heading: string, className: string): HTMLElement {
    const section = this.doc.createElement('section');
    section.className = className;
    const title = this.doc.createElement('h3');
    title.textContent = heading;
    section.append(title);
    return section;
  }

  private paragraph(text: string, className?: string): HTMLElement {
    const line = this.doc.createElement('p');
    line.textContent = text;
    if (className !== undefined) line.className = className;
    return line;
  }

  private render(reading: Reading): HTMLElement[] {
    const { overview, today, weekday } = reading;
    const due = dayAndWeekday(overview.nextDueDay, weekdayOf(overview.nextDueDay, today, weekday));
    const sections: HTMLElement[] = [];

    const aside = this.doc.createElement('section');
    aside.className = 'bills-keep-aside';
    aside.append(
      this.paragraph(`Funds: ${formatCents(overview.fundsCents)}`),
      this.paragraph(keepAsideText(overview, due)),
      overview.shortfallCents > 0
        ? this.paragraph(`Funds are ${formatCents(overview.shortfallCents)} short.`, 'bills-short')
        : this.paragraph('Funds cover these bills.'),
    );
    const overdueFrom = overdueFromText(overview);
    if (overdueFrom !== null) aside.append(this.paragraph(overdueFrom, 'bills-note'));
    sections.push(aside);

    if (reading.overdue.length > 0) {
      const overdue = this.section('Overdue', 'bills-overdue');
      for (const bill of reading.overdue) overdue.append(this.paragraph(overdueLineText(bill)));
      overdue.append(this.paragraph(
        'Bills are paid in order, oldest first; each is paid as soon as Funds cover it and every bill before it.',
        'bills-note',
      ));
      sections.push(overdue);
    }

    const next = this.section('Next bills', 'bills-next');
    next.append(this.paragraph(`Due ${due}`, 'bills-due'));
    reading.next.forEach((bill, index) => next.append(this.billRow(bill, reading.lines[index], overview)));
    sections.push(next);

    if (reading.lastMonth.length > 0) {
      const last = this.section('Last month', 'bills-last-month');
      for (const bill of reading.lastMonth) last.append(this.paragraph(lastMonthLineText(bill)));
      sections.push(last);
    }

    const rules = this.section('How bills work', 'bills-rules');
    rules.append(this.paragraph(billsRules(overview)));
    sections.push(rules);
    return sections;
  }

  /** A next bill: its name and expected amount, its amount so far, and its lines when expanded. */
  private billRow(bill: NextBill, lines: readonly BillLine[], overview: BillsOverview): HTMLElement {
    const row = this.doc.createElement('details');
    row.className = 'bill-row';
    row.open = this.expanded.has(bill.kind);
    row.addEventListener('toggle', () => {
      if (row.open) this.expanded.add(bill.kind); else this.expanded.delete(bill.kind);
    });
    const summary = this.doc.createElement('summary');
    const name = this.doc.createElement('strong');
    name.textContent = billName(bill.kind);
    const expected = this.doc.createElement('span');
    expected.className = 'bill-expected';
    expected.textContent = `Expected ${formatCents(bill.expectedCents)}`;
    const soFar = this.doc.createElement('span');
    soFar.className = 'bill-so-far';
    soFar.textContent = `So far ${formatCents(bill.soFarCents)}`;
    summary.append(name, expected, soFar);
    row.append(summary);
    const labels = this.kindLabels();
    for (const line of lines) {
      const text = billLineText(line, labels, overview.monthLength, overview.monthDays);
      if (text !== null) row.append(this.paragraph(text, 'bill-line'));
    }
    return row;
  }
}
