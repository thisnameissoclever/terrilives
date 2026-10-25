/**
 * The household bills' player-facing text ([WB-panel] and [WB-strings] in
 * `docs/specs/2026-10-18-wages-and-bills.md`). Every string here is
 * functional text proposed for the owner's review.
 */
import type { BillKind, BillsOverview } from '../bridge.js';

/** The four bills' names, in kind order. */
export const BILL_NAMES = ['Rent', 'Electricity', 'Water', 'Transportation'] as const;

/** The name of bill `kind`. */
export function billName(kind: BillKind): string {
  return BILL_NAMES[kind];
}

const DOLLARS = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const CENTS = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Cents as dollars and cents, `$293.60`, as the Bills panel shows money. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  return `${sign}$${CENTS.format(Math.abs(cents) / 100)}`;
}

/** Cents as whole dollars rounded up, `$425`, as the Bills row shows money. */
export function formatDollarsUp(cents: number): string {
  return `$${DOLLARS.format(Math.ceil(Math.max(0, cents) / 100))}`;
}

/** The day the HUD shows for day index `day`: `Day {day + 1}`. */
export function formatDay(day: number): string {
  return `Day ${(day + 1).toLocaleString('en-US')}`;
}

/** The Bills row's text: `$425 due Day 8`, or `$40 overdue` while a bill is overdue. */
export function formatBillsRow(overview: BillsOverview): string {
  if (overview.overdueCents > 0) {
    return `${formatDollarsUp(overview.overdueCents + overview.overdueFeeCents)} overdue`;
  }
  return `${formatDollarsUp(overview.keepAsideCents)} due ${formatDay(overview.nextDueDay)}`;
}

/** The "How bills work" paragraph, with the tuning's numbers. */
export function billsRules(overview: BillsOverview): string {
  return `Bills arrive on the first day of each month. A month is ${overview.daysPerMonth} days. `
    + 'Bills are paid automatically from Funds. '
    + `A bill still unpaid after ${overview.graceDays} days is overdue: a late fee of `
    + `${overview.lateFeePercent}% of the bill is added each day, up to ${overview.lateFeeCapPercent}%, `
    + 'and every housemate is Behind on bills until it is paid.';
}
