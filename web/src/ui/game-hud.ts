/** The player-facing clock, household and selected-sim summary. */
import { setTextIfChanged } from './set-text-if-changed.js';
import type { SatisfactionSurface } from './satisfaction-meter.js';

/**
 * A job's working days and shift hours as the simulation reports them:
 * `workingDays` is a mask with bit 0 for Monday through bit 6 for Sunday,
 * and the two times are ticks of the day clock.
 */
export interface CareerSchedule {
  readonly workingDays: number;
  readonly shiftStart: number;
  readonly shiftTicks: number;
}

export interface GameHudSource {
  selectedIndex(): number | null;
  satisfactionOf(entityIndex: number): number | null;
  careerOf(entityIndex: number): string | null;
  careerScheduleOf(entityIndex: number): CareerSchedule | null;
  activityOf(entityIndex: number): number | null;
  chainStatusOf(entityIndex: number): string | null;
  stallReasonOf(entityIndex: number): string | null;
  queuedOrdersOf(entityIndex: number): number;
  funds(): number;
  clockTick(): number;
  dayTicks(): number;
  weekdayIndex(): number;
}

export interface TextTarget {
  textContent: string | null;
  hidden?: boolean;
}

export interface GameHudRoots {
  readonly clock: TextTarget;
  readonly funds: TextTarget;
  readonly satisfaction: TextTarget;
  readonly careerRow: TextTarget;
  readonly career: TextTarget;
  readonly activity: TextTarget;
  readonly ordersRow: TextTarget;
  readonly orders: TextTarget;
}

const ACTIVITY_NAMES = [
  'Deciding what to do',
  'Walking',
  'Waiting',
  'Eating',
  'Talking',
  'Sleeping',
  'At work',
  'Using object',
  'Reading',
  'Exercising',
  'Watching fish',
  'Sitting',
  'Showering',
  'Using the toilet',
  'Watching TV',
  'Lying down',
  'Washing hands',
  'Washing dishes',
  'Listening to the radio',
  'Handling correspondence',
  'Bathing',
  'Getting ingredients',
  'Preparing food',
  'Cooking',
] as const;

export function formatActivity(
  activity: number | null,
  chain: string | null,
  stalled: string | null,
): string {
  if (chain !== null) return chain;
  if (stalled !== null) return `Waiting: ${stalled}`;
  if (activity === null) return 'Nothing selected';
  return ACTIVITY_NAMES[activity] ?? `Activity ${activity}`;
}

/**
 * Weekday names indexed the way the simulation counts them: 0 is Monday
 * and 6 is Sunday ([CAL-week] in `docs/specs/2026-10-06-calendar.md`).
 */
export const WEEKDAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

/** The weekday name for an index from the simulation, or null for anything else. */
function weekdayName(weekday: number): string | null {
  return Number.isInteger(weekday) ? WEEKDAY_NAMES[weekday] ?? null : null;
}

/**
 * Maps a tick of the authored day onto a 24-hour `hh:mm`, so a content day
 * of any length reads as a familiar clock. `dayTicks` must be positive.
 */
function formatTimeOfDay(tickInDay: number, dayTicks: number): string {
  const minute = Math.floor((tickInDay * 1440) / dayTicks);
  const hours = Math.floor(minute / 60)
    .toString()
    .padStart(2, '0');
  const minutes = (minute % 60).toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * Formats the simulation clock without borrowing the player's wall clock.
 * `weekday` is the simulation's own answer for the current tick; the shell
 * never works one out from the day number, because only the simulation
 * knows which weekday day 1 is.
 */
export function formatSimTime(tick: number, dayTicks: number, weekday: number): string {
  const name = weekdayName(weekday);
  if (!Number.isFinite(tick) || !Number.isFinite(dayTicks) || dayTicks <= 0 || name === null) {
    return 'Day and time unavailable';
  }
  const safeTick = Math.max(0, Math.floor(tick));
  const safeDayTicks = Math.max(1, Math.floor(dayTicks));
  const day = Math.floor(safeTick / safeDayTicks) + 1;
  const time = formatTimeOfDay(safeTick % safeDayTicks, safeDayTicks);
  return `Day ${day}, ${name}, ${time}`;
}

const EVERY_WEEKDAY = (1 << WEEKDAY_NAMES.length) - 1;

/**
 * Names the days in a working-day mask: `every day` for all seven,
 * `Monday to Friday` for one unbroken run of two or more days in the
 * Monday-first week, and otherwise each day, separated by commas. A run
 * does not wrap from Sunday to Monday.
 */
function formatWorkingDays(mask: number): string {
  if (mask === EVERY_WEEKDAY) return 'every day';
  const days = WEEKDAY_NAMES.filter((_, weekday) => (mask & (1 << weekday)) !== 0);
  const first = WEEKDAY_NAMES.indexOf(days[0]);
  const last = WEEKDAY_NAMES.indexOf(days[days.length - 1]);
  const unbroken = last - first + 1 === days.length;
  return unbroken && days.length > 1 ? `${days[0]} to ${days[days.length - 1]}` : days.join(', ');
}

function isScheduleTime(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

/**
 * The Career row's text: the job label, then its working days and shift
 * hours, for example `Office clerk, Monday to Friday, 06:00 to 14:00`
 * ([CAL-hud]). A shift that runs past midnight ends at the next day's
 * time. Without a usable schedule the row keeps the label alone, which is
 * still true.
 */
export function formatCareerSchedule(
  label: string,
  schedule: CareerSchedule | null,
  dayTicks: number,
): string {
  if (schedule === null || !Number.isInteger(dayTicks) || dayTicks <= 0) return label;
  const { workingDays, shiftStart, shiftTicks } = schedule;
  if (!Number.isInteger(workingDays) || workingDays <= 0 || workingDays > EVERY_WEEKDAY) {
    return label;
  }
  if (!isScheduleTime(shiftStart) || !isScheduleTime(shiftTicks)) return label;
  const start = formatTimeOfDay(shiftStart % dayTicks, dayTicks);
  const end = formatTimeOfDay((shiftStart + shiftTicks) % dayTicks, dayTicks);
  return `${label}, ${formatWorkingDays(workingDays)}, ${start} to ${end}`;
}

export function formatFunds(value: number): string {
  if (!Number.isFinite(value)) return 'unavailable';
  return Math.trunc(value).toLocaleString('en-US');
}

export function formatSatisfaction(value: number | null): string {
  return value === null || !Number.isFinite(value) ? 'unavailable' : value.toFixed(1);
}

/**
 * Reads the durable player-facing state at the existing HUD cadence.
 */
export class GameHud {
  private lastReadMs: number | null = null;

  constructor(
    private readonly roots: GameHudRoots,
    private readonly refreshMs: number,
    private readonly satisfactionSurface?: SatisfactionSurface,
  ) {
    if (!Number.isFinite(refreshMs) || refreshMs <= 0) {
      throw new Error('HUD refresh interval must be positive');
    }
  }

  update(nowMs: number, source: GameHudSource): boolean {
    if (this.lastReadMs !== null && nowMs - this.lastReadMs < this.refreshMs) {
      return false;
    }
    this.lastReadMs = nowMs;

    const dayTicks = source.dayTicks();
    setTextIfChanged(this.roots.clock, formatSimTime(
      source.clockTick(),
      dayTicks,
      source.weekdayIndex(),
    ));
    setTextIfChanged(this.roots.funds, formatFunds(source.funds()));

    const selected = source.selectedIndex();
    const satisfaction =
      selected === null ? null : source.satisfactionOf(selected);
    setTextIfChanged(this.roots.satisfaction, formatSatisfaction(satisfaction));
    this.satisfactionSurface?.render(satisfaction);

    const career = selected === null ? null : source.careerOf(selected);
    this.roots.careerRow.hidden = career === null;
    const schedule =
      selected === null || career === null ? null : source.careerScheduleOf(selected);
    setTextIfChanged(
      this.roots.career,
      career === null ? '' : formatCareerSchedule(career, schedule, dayTicks),
    );

    const activity = selected === null ? null : source.activityOf(selected);
    const chain = selected === null ? null : source.chainStatusOf(selected);
    const stalled = selected === null ? null : source.stallReasonOf(selected);
    setTextIfChanged(this.roots.activity, formatActivity(activity, chain, stalled));

    const queued = selected === null ? 0 : source.queuedOrdersOf(selected);
    this.roots.ordersRow.hidden = queued === 0;
    setTextIfChanged(this.roots.orders, String(queued));
    return true;
  }
}
