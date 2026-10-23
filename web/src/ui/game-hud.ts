/** The player-facing clock, household and selected-sim summary. */
import { setTextIfChanged } from './set-text-if-changed.js';
import type { SatisfactionSurface } from './satisfaction-meter.js';
import { activityStatusLabel, type ActivityStatus } from '../activity-status.js';
import { weatherAt, type WeatherTuning } from '../render/weather.js';

/**
 * A job's working days and shift hours as the simulation reports them:
 * `workingDays` is a mask with bit 0 for Monday through bit 6 for Sunday,
 * and the two times are ticks of the day clock. `kind` is the held shift's
 * kind, 0 to 3 for day, early, late and night, or null when it cannot be
 * named; `index` is the shift's index at the level, 0 for the standard
 * shift (issue 296, [WS-shell]).
 */
export interface CareerSchedule {
  readonly workingDays: number;
  readonly shiftStart: number;
  readonly shiftTicks: number;
  readonly kind?: number | null;
  readonly index?: number | null;
}

/** The shift kind names, in kind order. Functional text, for the owner's review. */
export const SHIFT_NAMES = ['Day shift', 'Early shift', 'Late shift', 'Night shift'] as const;

/** The name of shift kind `kind`, or null for anything but 0 to 3. */
export function shiftName(kind: number | null | undefined): string | null {
  return typeof kind === 'number' && Number.isInteger(kind) && kind >= 0 && kind < SHIFT_NAMES.length
    ? SHIFT_NAMES[kind]
    : null;
}

export interface GameHudSource {
  activityStatusOf?(entityIndex: number): ActivityStatus | null;
  simName?(entityIndex: number): string;
  needNames?(): string[];
  readingStatusOf?(entityIndex: number): string | null;
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
  seasonIndex(): number;
  weatherTuning(): WeatherTuning | null;
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
  'Idle',
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
  'Mopping floor',
  'Wiping surface',
  'Emptying bin',
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
 * Season names indexed the way the simulation counts them: 0 is Spring and
 * 3 is Winter ([SEA-year] in `docs/specs/2026-10-17-seasons.md`).
 */
export const SEASON_NAMES = ['Spring', 'Summer', 'Autumn', 'Winter'] as const;

/** The season name for an index from the simulation, or null for anything else. */
function seasonName(season: number): string | null {
  return Number.isInteger(season) ? SEASON_NAMES[season] ?? null : null;
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
 * Formats the simulation clock without borrowing the player's wall clock,
 * as three lines: day and weekday, time, then season and current weather
 * ([CAL-hud], [SEA-hud]). The clock element preserves newlines. `weekday`
 * and `season` are the simulation's own answers for the current tick; the
 * shell never works either out from the day number, because only the
 * simulation knows which weekday and season day 1 is.
 */
export function formatSimTime(tick: number, dayTicks: number, weekday: number, season: number, weather = 'mild'): string {
  const name = weekdayName(weekday);
  const seasonLabel = seasonName(season);
  if (!Number.isFinite(tick) || !Number.isFinite(dayTicks) || dayTicks <= 0 || name === null
    || seasonLabel === null) {
    return 'Day and time unavailable';
  }
  const safeTick = Math.max(0, Math.floor(tick));
  const safeDayTicks = Math.max(1, Math.floor(dayTicks));
  const day = Math.floor(safeTick / safeDayTicks) + 1;
  const time = formatTimeOfDay(safeTick % safeDayTicks, safeDayTicks);
  return `Day ${day}, ${name}\n${time}\n${seasonLabel}: ${weather}`;
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
 * The Career row's text: the job label, the held shift's name, then its
 * working days and hours, for example
 * `Office clerk, Day shift, Monday to Friday, 06:00 to 14:00` ([CAL-hud],
 * issue 296's [WS-shell] item 1). A shift that runs past midnight ends at
 * the next day's time. A kind that cannot be named leaves the name out;
 * without a usable schedule the row keeps the label alone, which is still
 * true.
 */
export function formatCareerSchedule(
  label: string,
  schedule: CareerSchedule | null,
  dayTicks: number,
): string {
  const hours = schedule === null ? null : formatShiftHours(schedule, dayTicks);
  if (schedule === null || hours === null) return label;
  const name = shiftName(schedule.kind);
  return name === null ? `${label}, ${hours}` : `${label}, ${name}, ${hours}`;
}

/**
 * A shift's working days and hours, `Monday to Friday, 06:00 to 14:00`, or
 * null when the schedule or the day length cannot be read.
 */
export function formatShiftHours(schedule: CareerSchedule, dayTicks: number): string | null {
  if (!Number.isInteger(dayTicks) || dayTicks <= 0) return null;
  const { workingDays, shiftStart, shiftTicks } = schedule;
  if (!Number.isInteger(workingDays) || workingDays <= 0 || workingDays > EVERY_WEEKDAY) {
    return null;
  }
  if (!isScheduleTime(shiftStart) || !isScheduleTime(shiftTicks)) return null;
  const start = formatTimeOfDay(shiftStart % dayTicks, dayTicks);
  const end = formatTimeOfDay((shiftStart + shiftTicks) % dayTicks, dayTicks);
  return `${formatWorkingDays(workingDays)}, ${start} to ${end}`;
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
    const tick = source.clockTick();
    const season = source.seasonIndex();
    const tuning = source.weatherTuning();
    const condition = tuning && Number.isFinite(tick) && tick >= 0 && dayTicks > 0
      && Number.isFinite(dayTicks) && Number.isInteger(season) && season >= 0 && season <= 3
      ? weatherAt(tick, dayTicks, season, tuning).condition : 'mild';
    setTextIfChanged(this.roots.clock, formatSimTime(
      tick,
      dayTicks,
      source.weekdayIndex(),
      season,
      condition,
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
    const chain = selected === null ? null : source.readingStatusOf?.(selected) ?? source.chainStatusOf(selected);
    const stalled = selected === null ? null : source.stallReasonOf(selected);
    const status = selected === null ? null : source.activityStatusOf?.(selected);
    const partner = status?.partner == null ? '' : source.simName?.(status.partner) ?? '';
    const contextual = status ? activityStatusLabel(status, partner, source.needNames?.()) : null;
    setTextIfChanged(this.roots.activity, contextual ?? chain ?? formatActivity(activity, chain, stalled));

    const queued = selected === null ? 0 : source.queuedOrdersOf(selected);
    this.roots.ordersRow.hidden = queued === 0;
    setTextIfChanged(this.roots.orders, String(queued));
    return true;
  }
}
