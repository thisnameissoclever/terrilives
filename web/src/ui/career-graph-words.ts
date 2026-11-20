import type { CareerInputWeek, CareerWeek } from '../bridge.js';

// The words the Career tab's graph and the review window share: what kind of
// week a score was, what happened that week, and the legend. One place, so
// the two surfaces never word the same week differently ([CT-q-tipwords]).
// Functional text, for the owner's review ([CT-strings] S-tip and S-legend).

export const CAREER_EVENT_NONE = 0;
export const CAREER_EVENT_PROMOTION = 1;
export const CAREER_EVENT_RAISE = 2;
export const CAREER_EVENT_DEMOTION = 3;
export const CAREER_EVENT_FIRED = 4;
export const CAREER_EVENT_CHANGED_PATH = 5;

export interface CareerGraphThresholds {
  readonly poor: number;
  readonly good: number;
}

/** A reviewed week and, for an event that moved the person, the title they held after it. */
export interface CareerGraphWeek extends CareerWeek {
  readonly after?: string | null;
}

export type CareerWeekKind = 'good' | 'steady' | 'poor';

/** The marker's title text, or null for a week with nothing to mark. */
export function careerEventTitle(event: number): string | null {
  switch (event) {
    case CAREER_EVENT_PROMOTION: return 'Promoted';
    case CAREER_EVENT_RAISE: return 'Got a raise';
    case CAREER_EVENT_DEMOTION: return 'Demoted';
    case CAREER_EVENT_FIRED: return 'Fired';
    case CAREER_EVENT_CHANGED_PATH: return 'Changed path';
    default: return null;
  }
}

/** Good at or above the good threshold, poor under the poor one, as the simulation counts them. */
export function careerWeekKind(performance: number, thresholds: CareerGraphThresholds): CareerWeekKind {
  if (performance >= thresholds.good) return 'good';
  return performance < thresholds.poor ? 'poor' : 'steady';
}

/** A threshold as the player reads it, a whole number. */
export function careerThresholdText(value: number): string {
  return String(Math.round(value));
}

const KIND_LABEL: Readonly<Record<CareerWeekKind, string>> = {
  good: 'Good week:', steady: 'Steady week:', poor: 'Poor week:',
};

/** The kind of week as a bold label and the rest of its sentence. */
export function careerKindSentence(kind: CareerWeekKind, thresholds: CareerGraphThresholds): { label: string; rest: string } {
  const good = careerThresholdText(thresholds.good);
  const poor = careerThresholdText(thresholds.poor);
  const rest = kind === 'good' ? `${good} or more counts toward promotion.`
    : kind === 'poor' ? `under ${poor}. Poor weeks in a row bring a warning.`
      : `between ${poor} and ${good} counts toward neither.`;
  return { label: KIND_LABEL[kind], rest };
}

/** `Promoted to Senior clerk.`, `Got a raise.` and the rest; null for a week with no event. */
export function careerEventSentence(week: CareerGraphWeek): string | null {
  const after = week.after ?? null;
  switch (week.event) {
    case CAREER_EVENT_PROMOTION: return after === null ? 'Promoted.' : `Promoted to ${after}.`;
    case CAREER_EVENT_RAISE: return 'Got a raise.';
    case CAREER_EVENT_DEMOTION: return after === null ? 'Demoted.' : `Demoted to ${after}.`;
    case CAREER_EVENT_FIRED: return 'Fired.';
    case CAREER_EVENT_CHANGED_PATH: return after === null ? 'Changed path.' : `Changed path to ${after}.`;
    default: return null;
  }
}

/** `Week 3 review: 90 of 100`. Weeks count from 1 for the player. */
export function careerTipHeading(week: CareerGraphWeek): string {
  return `Week ${week.week + 1} review: ${Math.round(week.performance)} of 100`;
}

/** The whole tooltip as one sentence run, for a live region. */
export function careerTipText(week: CareerGraphWeek, thresholds: CareerGraphThresholds): string {
  const kind = careerKindSentence(careerWeekKind(week.performance, thresholds), thresholds);
  const event = careerEventSentence(week);
  return `${careerTipHeading(week)}. ${kind.label} ${kind.rest}${event === null ? '' : ` ${event}`}`;
}

export type CareerLegendKind = 'line' | 'good' | 'poor' | 'promotion' | 'demotion' | 'raise' | 'change';

export interface CareerLegendItem {
  readonly kind: CareerLegendKind;
  readonly text: string;
}

/** The legend: the line and the two thresholds, then only the event markers present in `weeks`. */
export function careerLegendItems(weeks: readonly CareerWeek[], thresholds: CareerGraphThresholds): CareerLegendItem[] {
  const present = (event: number) => weeks.some(week => week.event === event);
  const items: CareerLegendItem[] = [
    { kind: 'line', text: 'Weekly review score' },
    { kind: 'good', text: `Good, ${careerThresholdText(thresholds.good)}` },
    { kind: 'poor', text: `Poor, ${careerThresholdText(thresholds.poor)}` },
  ];
  if (present(CAREER_EVENT_PROMOTION)) items.push({ kind: 'promotion', text: 'Promoted' });
  if (present(CAREER_EVENT_DEMOTION)) items.push({ kind: 'demotion', text: 'Demoted' });
  if (present(CAREER_EVENT_RAISE)) items.push({ kind: 'raise', text: 'Raise' });
  if (present(CAREER_EVENT_CHANGED_PATH)) items.push({ kind: 'change', text: 'Changed path' });
  return items;
}

/**
 * Adds the title each promotion, demotion or change of path led to. The
 * title is the one the person held in the next reviewed week, or the current
 * job after the last reviewed week; a week with no score inputs falls back
 * to one level up or down for a promotion or demotion, and otherwise names
 * no title rather than guess.
 */
export function withEventTitles(
  weeks: readonly CareerWeek[],
  inputs: readonly CareerInputWeek[],
  titleOf: (path: number, level: number) => string | null,
  currentTitle: string | null,
): CareerGraphWeek[] {
  const rows = new Map(inputs.map(row => [row.week, row]));
  return weeks.map((week, index): CareerGraphWeek => {
    const moves = week.event === CAREER_EVENT_PROMOTION || week.event === CAREER_EVENT_DEMOTION
      || week.event === CAREER_EVENT_CHANGED_PATH;
    if (!moves) return week;
    const next = weeks[index + 1];
    let after: string | null = null;
    if (next === undefined) after = currentTitle;
    else {
      const row = rows.get(next.week);
      if (row !== undefined) after = titleOf(row.path, row.level);
    }
    const own = rows.get(week.week);
    if (after === null && own !== undefined && week.event !== CAREER_EVENT_CHANGED_PATH) {
      after = titleOf(own.path, own.level + (week.event === CAREER_EVENT_PROMOTION ? 1 : -1));
    }
    return after === null ? week : { ...week, after };
  });
}
