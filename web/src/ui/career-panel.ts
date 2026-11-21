import { setActionIntent } from './action-intent.js';
import type {
  CareerFactors, CareerInputWeek, CareerReport, CareerResult, CareerShift, CareerShiftInputs, CareerWeek, GoToWorkState,
  GoToWorkStatus,
} from '../bridge.js';
import { CareerGraph } from './career-graph.js';
import {
  signedTwoDecimals, withEventTitles, type CareerGraphThresholds, type CareerGraphWeek,
} from './career-graph-words.js';
import {
  WEEKDAY_NAMES, formatShiftHours, formatTimeOfDay, shiftName, type CareerSchedule,
} from './game-hud.js';
import { setTextIfChanged } from './set-text-if-changed.js';

// The Career section of Sim details - rule 18 of
// docs/specs/2026-10-17-careers.md. It reads the selected person's job,
// the week so far, the last review, the factors behind the score, the
// counters and the graph of reviewed weeks, and offers the paths to
// assign and a Quit control: the same commands the simulation defines,
// nothing else. One pending command at a time; the simulation stays the
// authority on what a command does. A box sets whether the person looks
// for work on their own while unemployed - their own setting
// (docs/specs/2026-10-18-job-search-per-person.md). Shift selectors pick
// the shift an assignment holds and change an employed person's shift
// (docs/specs/2026-10-18-shifts-and-careers.md, [WS-shell]).

export interface CareerPanelSource {
  selectedIndex(): number | null;
  dayTicks(): number;
  careerOf(entity: number): string | null;
  careerScheduleOf(entity: number): CareerSchedule | null;
  careerReport(entity: number): CareerReport | null;
  careerHistory(entity: number): readonly CareerWeek[];
  careerFactors(entity: number): CareerFactors | null;
  /** The weekly score inputs, which say what level each reviewed week was worked at. */
  careerInputHistory(entity: number): readonly CareerInputWeek[];
  /** The titles of a path's levels, in level order. */
  careerLevelTitles(path: number): readonly string[];
  /** The inputs of the last scored shift, which the mood row reads. */
  careerLastShift(entity: number): CareerShiftInputs | null;
  /** What the Go to work box shows, or null when it cannot be read. */
  goToWorkStatus(entity: number): GoToWorkStatus | null;
  goToWork(entity: number): boolean;
  /** The simulation clock in ticks and the weekday it falls on, 0 for Monday. */
  clockTick(): number;
  weekdayIndex(): number;
  careerAttendanceOf?(entity: number): readonly number[];
  careerPathLabels(): readonly string[];
  assignCareer(entity: number, path: number): boolean;
  quitCareer(entity: number): boolean;
  careerPathShifts(path: number): readonly CareerShift[];
  careerShiftsOf(entity: number): readonly CareerShift[];
  assignCareerShift(entity: number, path: number, shift: number): boolean;
  changeShift(entity: number, shift: number): boolean;
  lastCareerResult(): CareerResult | null;
  jobSearchOf(entity: number): boolean | null;
  setJobSearch(entity: number, search: boolean): boolean;
  /** One night shift's pay in cents while `entity` holds a night shift, else null ([WB-panel]). */
  nightPayCentsOf?(entity: number): number | null;
  nightShiftPremiumPercent?(): number;
}

/** A night worker's premium: the percentage and one shift's pay with it, in cents. */
export interface NightPay {
  readonly percent: number;
  readonly cents: number;
}

/** `Night shifts pay 15% more: $207.00 per shift.`, functional text proposed for the owner's review. */
export function nightPayLine(night: NightPay): string {
  return `Night shifts pay ${night.percent}% more: $${(night.cents / 100).toFixed(2)} per shift.`;
}

/** One row of the facts grid; a wide row spans both columns. */
export interface CareerFact {
  readonly label: string;
  readonly value: string;
  readonly wide?: boolean;
}

/** One row of Score inputs: the name, a muted hint, the value and whether it helps the score. */
export interface CareerInputRow {
  readonly name: string;
  readonly hint: string;
  readonly value: string;
  /** Null for a row with nothing to judge yet. */
  readonly effect: 'help' | 'hurt' | 'none' | null;
}

/** What the Go to work box shows, every line already worded ([CT-work-state]). */
export interface CareerWorkView {
  readonly state: GoToWorkState;
  readonly enabled: boolean;
  /** The shift has started: the line reads in the warning style. */
  readonly late: boolean;
  readonly text: string;
  readonly note: string;
}

/** What the section says about a held job, every line already worded. */
export interface CareerJobView {
  readonly title: string;
  readonly pathLabel: string;
  /** `{path} path, level {n} of {m}`. */
  readonly subtitle: string;
  /** The held shift's name, days and hours, or the job title when they cannot be read. */
  readonly schedule: string;
  readonly facts: readonly CareerFact[];
  /** A night worker's premium sentence, shown under the facts. */
  readonly nightNote: string | null;
  readonly attendance?: string | null;
  readonly inputs: readonly CareerInputRow[];
  /** The Go to work box, or null when there is nothing to show. */
  readonly work?: CareerWorkView | null;
  readonly streaks: string;
  readonly warning: string | null;
  readonly weeks: readonly CareerGraphWeek[];
  readonly thresholds: CareerGraphThresholds;
  /** 1 after three good reviews in a row, -1 after three poor, else 0. */
  readonly trend: -1 | 0 | 1;
}

export interface CareerPanelState {
  readonly agent: number | null;
  /** The held job, or null for the unemployed and when nothing can be read. */
  readonly job: CareerJobView | null;
  readonly unavailable: boolean;
  readonly paths: readonly string[];
  readonly choice: number | null;
  readonly pending: boolean;
  readonly status: string;
  /** The person's job search setting, or null when it cannot be read. */
  readonly jobSearch: boolean | null;
  /** The chosen path's first-level shifts, most likely first. */
  readonly assignShifts?: readonly CareerShiftOption[];
  /** The shift the assignment holds, or null for By chance. */
  readonly shiftChoice?: number | null;
  /** The shifts the held level offers, most likely first. */
  readonly heldShifts?: readonly CareerShiftOption[];
  /** The index of the shift held, or null without a job. */
  readonly heldShift?: number | null;
  /** The shift selected to change to. */
  readonly changeChoice?: number | null;
}

/** One shift as a selector offers it: its index at the level and its wording. */
export interface CareerShiftOption {
  readonly index: number;
  readonly text: string;
}

// [WS-shell] items 3 to 5. Functional text, for the owner's review.
export const BY_CHANCE = 'By chance';
export const SHIFT_LABEL = 'Shift';
export const SHIFT_SCHEDULE = 'Shift schedule';
export const CHANGE_SHIFT = 'Change shift';
export const SHIFT_CHANGE_NOTE = 'Changing shift resets the good weeks counted toward the next promotion.';

/**
 * Words each offered shift as `{shift}, {working days}, {start} to {end}`,
 * most likely first with ties in authored order. For an assignment, which
 * draws By chance, each line ends `, {n}% chance`, where `n` is its chance
 * of being drawn rounded to a whole percent; a shift change is chosen, not
 * drawn, so its lines carry no chance. A shift whose hours cannot be read is
 * left out; one whose kind cannot be named loses the name.
 */
export function careerShiftOptions(
  shifts: readonly CareerShift[],
  dayTicks: number,
  use: 'assign' | 'change' = 'assign',
): CareerShiftOption[] {
  const total = shifts.reduce((sum, shift) => sum + shift.weight, 0);
  if (total <= 0) return [];
  return shifts
    .map((shift, order) => ({ shift, order, hours: formatShiftHours(shift, dayTicks) }))
    .filter(row => row.hours !== null)
    .sort((a, b) => b.shift.weight - a.shift.weight || a.order - b.order)
    .map(({ shift, hours }) => {
      const words = shiftWords(shift.kind, hours!);
      if (use === 'change') return { index: shift.index, text: words };
      return { index: shift.index, text: `${words}, ${Math.round((shift.weight / total) * 100)}% chance` };
    });
}

/** `{shift}, {hours}`, or the hours alone when the kind cannot be named. */
function shiftWords(kind: number | null | undefined, hours: string): string {
  const name = shiftName(kind);
  return name === null ? hours : `${name}, ${hours}`;
}

/**
 * The Change shift list: the shifts the level offers, as
 * `careerShiftOptions` words them for a change, with the held shift first
 * when the level no longer offers it (a retired shift, weight zero), so the
 * selector always shows what the person works.
 */
export function heldShiftOptions(
  offered: readonly CareerShift[],
  held: CareerSchedule | null,
  dayTicks: number,
): CareerShiftOption[] {
  const rows = careerShiftOptions(offered, dayTicks, 'change');
  const index = held?.index;
  if (held === null || index === null || index === undefined || rows.some(row => row.index === index)) return rows;
  const hours = formatShiftHours(held, dayTicks);
  return hours === null ? rows : [{ index, text: shiftWords(held.kind, hours) }, ...rows];
}

/** The job search box's label. Functional text, for the owner's review. */
export const JOB_SEARCH_LABEL = 'Look for work automatically when unemployed';

export const CAREER_WARNING = 'Warned at work: dismissal becomes possible from the third poor week in a row.';

export function careerAttendanceLine(values: readonly number[]): string | null {
  if (values.length !== 8 || !values.every(Number.isFinite)) return null;
  const [scheduled, worked, missed, base, deduction, score, payCents, settled] = values;
  const number = (value: number): string => Number(value.toFixed(2)).toString();
  const minutes = `${number(worked)} of ${number(scheduled)} scheduled minutes worked; ${number(missed)} missed.`;
  return settled === 1
    ? `Last shift: ${minutes} Base performance ${number(base)}, missed-work deduction ${number(deduction)}, final score ${number(score)}. Earned $${(payCents / 100).toFixed(2)}.`
    : `Current shift: ${minutes} Pay and performance settle when the scheduled shift ends.`;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

const signed = signedTwoDecimals;

/** Helps above zero, Hurts below it, No effect at zero, judged after rounding to two decimals. */
function effectOf(value: number): 'help' | 'hurt' | 'none' {
  const rounded = Math.round(value * 100) / 100;
  return rounded > 0 ? 'help' : rounded < 0 ? 'hurt' : 'none';
}

/**
 * The Score inputs rows: fit, trait fit, social capacity, skill mastery and
 * the mood of the last shift. Fit, trait fit and mastery read the person now;
 * mood reads the last scored shift, and says so until there is one.
 */
export function careerInputRows(factors: CareerFactors, last: CareerShiftInputs | null): CareerInputRow[] {
  const mastery = Math.round(factors.mastery * 100);
  return [
    { name: 'Fit', hint: '(from -1 to 1)', value: signed(factors.fit), effect: effectOf(factors.fit) },
    { name: 'Trait fit', hint: '(part of fit)', value: signed(factors.traitFit), effect: effectOf(factors.traitFit) },
    { name: 'Social capacity', hint: `(job needs ${percent(factors.socialDemand)})`,
      value: percent(factors.socialCapacity), effect: factors.socialCapacity >= factors.socialDemand ? 'none' : 'hurt' },
    { name: 'Skill mastery', hint: '(50% is neutral)', value: `${mastery}%`,
      effect: mastery > 50 ? 'help' : mastery < 50 ? 'hurt' : 'none' },
    last === null
      ? { name: 'Mood on the last shift', hint: '', value: 'No shift yet', effect: null }
      : { name: 'Mood on the last shift', hint: '', value: signed(last.mood), effect: effectOf(last.mood) },
  ];
}

/** `1 hour 20 minutes`, `35 minutes`, `2 hours`. A tick is a minute at the shipped day length. */
export function careerDurationWords(minutes: number): string {
  const total = Math.round(minutes);
  if (total < 1) return 'less than a minute';
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(hours === 1 ? '1 hour' : `${hours} hours`);
  if (rest > 0) parts.push(rest === 1 ? '1 minute' : `${rest} minutes`);
  return parts.join(' ');
}

/** The Go to work window in words: `two hours` at the shipped 120, otherwise whole hours or minutes. */
export function careerWindowWords(minutes: number): string {
  if (minutes === 120) return 'two hours';
  if (minutes % 60 === 0) return minutes === 60 ? '1 hour' : `${minutes / 60} hours`;
  return `${minutes} minutes`;
}

/** What `careerWorkView` needs to word the box besides the status. */
export interface CareerWorkContext {
  readonly now: number;
  readonly dayTicks: number;
  /** The weekday the clock is on, 0 for Monday. */
  readonly weekday: number;
  readonly shiftKind: number | null | undefined;
  /** The held shift's schedule line, which the box repeats while the command does not apply. */
  readonly schedule: string;
}

// [CT-strings] S-note and the box's other lines. Functional text, for the owner's review.
export const GO_TO_WORK_NOTE = 'Stops what they are doing and leaves now, even with low needs.';

/**
 * Words the Go to work box from the simulation's status ([CT-work-state]).
 * Null hides it: no job, or a status the shell cannot read. A tick is a
 * minute at the shipped day length; `dayTicks` scales it to the clock.
 */
export function careerWorkView(status: GoToWorkStatus | null, context: CareerWorkContext): CareerWorkView | null {
  if (status === null || status.state === 'none') return null;
  const { now, dayTicks, weekday, shiftKind, schedule } = context;
  if (!Number.isFinite(dayTicks) || dayTicks <= 0) return null;
  const minutes = (ticks: number) => (ticks * 1440) / dayTicks;
  const clock = (tick: number) => formatTimeOfDay(tick % dayTicks, dayTicks);
  const view = (enabled: boolean, text: string, note: string, late = false): CareerWorkView =>
    ({ state: status.state, enabled, late, text, note });
  const { startTick, endTick, opensTick } = status;
  switch (status.state) {
    case 'due':
      if (startTick === null) return null;
      return view(true, `${shiftName(shiftKind) ?? 'Shift'} starts at ${clock(startTick)}, in ${careerDurationWords(minutes(startTick - now))}.`,
        GO_TO_WORK_NOTE);
    case 'late':
      if (startTick === null) return null;
      return view(true, `Started at ${clock(startTick)}, ${careerDurationWords(minutes(now - startTick))} ago. `
        + 'Time before they arrive counts as missed work.', GO_TO_WORK_NOTE, true);
    case 'early': {
      if (startTick === null || endTick === null || opensTick === null) {
        return view(false, 'No shift in the next seven days.', schedule);
      }
      const count = WEEKDAY_NAMES.length;
      const day = ((weekday + Math.floor(startTick / dayTicks) - Math.floor(now / dayTicks)) % count + count) % count;
      return view(false, `Next shift: ${WEEKDAY_NAMES[day]}, ${clock(startTick)} to ${clock(endTick)}.`,
        `Go to work becomes available at ${clock(opensTick)}, `
        + `${careerWindowWords(Math.round(minutes(startTick - opensTick)))} before the shift.`);
    }
    case 'atWork':
      return endTick === null ? null : view(false, `At work until ${clock(endTick)}.`, schedule);
    case 'outbound':
      return view(false, 'On the way to work.', schedule);
    case 'inbound':
      return view(false, 'On the way home.', schedule);
    default:
      return null;
  }
}

/**
 * Words one job. `title`, `pathLabel` and `schedule` come from the row the
 * Overview already shows; the rest from the report, the factors and the
 * reviewed weeks. A night worker gains the premium's sentence as a note.
 */
export function careerJobView(
  title: string,
  pathLabel: string,
  schedule: string,
  report: CareerReport,
  factors: CareerFactors | null,
  weeks: readonly CareerGraphWeek[],
  night: NightPay | null = null,
  lastShift: CareerShiftInputs | null = null,
): CareerJobView {
  const count = report.shifts;
  const thisWeek = count === 0 || report.mean === null
    ? 'No shifts yet'
    : `${count} ${count === 1 ? 'shift' : 'shifts'}, scoring ${Math.round(report.mean)}`;
  const streaks = report.good > 0
    ? `Good weeks in a row: ${report.good}.`
    : report.poor > 0
      ? `Poor weeks in a row: ${report.poor}.`
      : 'No streak running.';
  const promotion = report.level + 1 >= report.levels
    ? 'At the top of this path'
    : `${Math.min(report.good, report.advanceWeeks)} of ${report.advanceWeeks} good ${report.advanceWeeks === 1 ? 'week' : 'weeks'} in a row`;
  return {
    title,
    pathLabel,
    subtitle: `${pathLabel} path, level ${report.level + 1} of ${report.levels}`,
    schedule,
    facts: [
      { label: 'Shift', value: schedule, wide: true },
      { label: 'Pay', value: `$${report.pay} per shift` },
      { label: 'Pay range at this level', value: `$${report.payMin} to $${report.payMax}` },
      { label: 'This week', value: thisWeek },
      { label: 'Last review', value: report.last === null ? 'None yet' : `${Math.round(report.last)} of 100` },
      { label: 'Promotion', value: promotion, wide: true },
    ],
    nightNote: night === null ? null : nightPayLine(night),
    inputs: factors === null ? [] : careerInputRows(factors, lastShift),
    streaks,
    warning: report.warned ? CAREER_WARNING : null,
    weeks,
    thresholds: { poor: report.poorThreshold, good: report.goodThreshold },
    trend: report.trend,
  };
}

const RESULT_TEXT: Readonly<Record<string, string>> = {
  assign: 'Career assigned.',
  quit: 'Job left.',
  shift: 'Shift changed.',
  work: 'Left for work.',
};

const SENT_TEXT: Readonly<Record<string, string>> = {
  assign: 'Assigning the career…',
  quit: 'Leaving the job…',
  shift: 'Changing the shift…',
  work: 'Sending them to work…',
};

type CareerCommand = 'assign' | 'quit' | 'shift' | 'work';

/** One pending UI command; `afterCommands` reads what the drain did with it. */
export class CareerPanel {
  private agent: number | null = null;
  private job: CareerJobView | null = null;
  private unavailable = false;
  private paths: readonly string[] = [];
  private choice: number | null = null;
  private status = '';
  private pending: { agent: number; command: CareerCommand; after: bigint } | null = null;
  private assignShifts: readonly CareerShiftOption[] = [];
  private shiftChoice: number | null = null;
  private heldShifts: readonly CareerShiftOption[] = [];
  private heldShift: number | null = null;
  /** Whose job, which job and which shift the last read saw; a change resets the change choice. */
  private heldKey: string | null = null;
  private changeChoice: number | null = null;
  private lastRead: number | null = null;
  private jobSearch: boolean | null = null;
  /** A setting sent and not yet applied: reads keep the sent value. */
  private searchSent = false;

  constructor(
    private readonly source: CareerPanelSource,
    private readonly render: (state: CareerPanelState) => void,
    private readonly refreshMs: number,
    private readonly active: () => boolean,
  ) {
    if (!Number.isFinite(refreshMs) || refreshMs <= 0) throw new Error('Career panel refresh interval must be positive and finite');
  }

  private show(): void {
    this.render({ agent: this.agent, job: this.job, unavailable: this.unavailable, paths: this.paths,
      choice: this.choice, pending: this.pending !== null, status: this.status, jobSearch: this.jobSearch,
      assignShifts: this.assignShifts, shiftChoice: this.shiftChoice, heldShifts: this.heldShifts,
      heldShift: this.heldShift, changeChoice: this.changeChoice });
  }

  private syncSelection(): boolean {
    const agent = this.source.selectedIndex();
    if (agent === this.agent) return false;
    this.agent = agent;
    this.job = null;
    this.unavailable = false;
    this.choice = null;
    this.pending = null;
    this.status = '';
    this.lastRead = null;
    this.jobSearch = null;
    this.searchSent = false;
    this.clearShifts();
    this.show();
    return true;
  }

  private clearShifts(): void {
    this.assignShifts = [];
    this.shiftChoice = null;
    this.heldShifts = [];
    this.heldShift = null;
    this.changeChoice = null;
    this.heldKey = null;
  }

  /** The chosen path's shifts; a choice the path no longer offers returns to By chance. */
  private readAssignShifts(): void {
    this.assignShifts = this.choice === null ? []
      : careerShiftOptions(this.source.careerPathShifts(this.choice), this.source.dayTicks());
    if (this.shiftChoice !== null && !this.assignShifts.some(option => option.index === this.shiftChoice)) {
      this.shiftChoice = null;
    }
  }

  update(nowMs: number, force = false): void {
    const changed = this.syncSelection();
    if (!force && (!this.active() || (!changed && this.lastRead !== null && nowMs - this.lastRead < this.refreshMs))) return;
    this.read();
    this.lastRead = nowMs;
    this.show();
  }

  private read(): void {
    this.paths = this.source.careerPathLabels();
    if (this.choice !== null && this.choice >= this.paths.length) this.choice = null;
    this.readAssignShifts();
    this.heldShifts = [];
    this.heldShift = null;
    if (!this.searchSent) this.jobSearch = this.agent === null ? null : this.source.jobSearchOf(this.agent);
    if (this.agent === null) {
      this.job = null;
      this.unavailable = false;
      return;
    }
    const title = this.source.careerOf(this.agent);
    if (title === null) {
      this.job = null;
      this.unavailable = false;
      this.changeChoice = null;
      return;
    }
    const report = this.source.careerReport(this.agent);
    if (report === null || report.path >= this.paths.length) {
      this.job = null;
      this.unavailable = true;
      return;
    }
    this.unavailable = false;
    const held = this.source.careerScheduleOf(this.agent);
    this.heldShift = held?.index ?? null;
    this.heldShifts = heldShiftOptions(this.source.careerShiftsOf(this.agent), held, this.source.dayTicks());
    // A new job, a promotion, a review or a drawn shift can move the held
    // shift without the player choosing one; the selector then follows it,
    // so Change shift stays disabled until the player picks another.
    const heldKey = `${this.agent}:${report.path}:${report.level}:${title}:${this.heldShift}`;
    if (heldKey !== this.heldKey || this.changeChoice === null
      || !this.heldShifts.some(option => option.index === this.changeChoice)) {
      this.changeChoice = this.heldShift;
    }
    this.heldKey = heldKey;
    const hours = held === null ? null : formatShiftHours(held, this.source.dayTicks());
    const schedule = held === null || hours === null ? title : shiftWords(held.kind, hours);
    const nightCents = this.source.nightPayCentsOf?.(this.agent) ?? null;
    const percent = this.source.nightShiftPremiumPercent?.();
    const night = nightCents === null || percent === undefined ? null : { percent, cents: nightCents };
    this.job = careerJobView(title, this.paths[report.path], schedule, report,
      this.source.careerFactors(this.agent), this.readWeeks(this.agent, title), night,
      this.source.careerLastShift(this.agent));
    const work = careerWorkView(this.source.goToWorkStatus(this.agent), {
      now: this.source.clockTick(), dayTicks: this.source.dayTicks(), weekday: this.source.weekdayIndex(),
      shiftKind: held?.kind, schedule,
    });
    this.job = {...this.job, work,
      attendance: careerAttendanceLine(this.source.careerAttendanceOf?.(this.agent) ?? [])};
  }

  /** The reviewed weeks, each event carrying the title it led to when that can be told. */
  private readWeeks(agent: number, currentTitle: string): readonly CareerGraphWeek[] {
    const weeks = this.source.careerHistory(agent);
    if (!weeks.some(week => week.event !== 0)) return weeks;
    const cache = new Map<number, readonly string[]>();
    const titleOf = (path: number, level: number): string | null => {
      let titles = cache.get(path);
      if (titles === undefined) {
        titles = this.source.careerLevelTitles(path);
        cache.set(path, titles);
      }
      return titles[level] ?? null;
    };
    return withEventTitles(weeks, this.source.careerInputHistory(agent), titleOf, currentTitle);
  }

  choose(path: number | null): void {
    if (this.syncSelection() || this.pending) return;
    this.choice = path !== null && Number.isInteger(path) && path >= 0 && path < this.paths.length ? path : null;
    // A new path's shifts start at By chance ([WS-shell] item 3).
    this.shiftChoice = null;
    this.readAssignShifts();
    this.status = '';
    this.show();
  }

  /** The shift an assignment holds; null is By chance. */
  chooseShift(shift: number | null): void {
    if (this.syncSelection() || this.pending) return;
    this.shiftChoice = shift !== null && this.assignShifts.some(option => option.index === shift) ? shift : null;
    this.status = '';
    this.show();
  }

  /** The shift Change shift moves an employed person to. */
  chooseChange(shift: number | null): void {
    if (this.syncSelection() || this.pending) return;
    this.changeChoice = shift !== null && this.heldShifts.some(option => option.index === shift) ? shift : this.heldShift;
    this.status = '';
    this.show();
  }

  assign(): void {
    if (this.choice !== null) this.stage('assign');
  }

  quit(): void { this.stage('quit'); }

  /** Sends the person to work now ([CT-work-effect]); the drain decides whether it applies. */
  goToWork(): void { this.stage('work'); }

  /** Sends the selected shift for the employed person ([WS-shell] item 4). */
  changeShift(): void {
    if (this.changeChoice !== null && this.changeChoice !== this.heldShift) this.stage('shift');
  }

  /** Sends the person's job search setting; shown as sent until applied. */
  setJobSearch(search: boolean): void {
    if (this.syncSelection() || this.agent === null) return;
    if (this.source.setJobSearch(this.agent, search)) {
      this.jobSearch = search;
      this.searchSent = true;
    } else {
      this.status = 'The setting could not be sent.';
    }
    this.show();
  }

  private stage(command: CareerCommand): void {
    if (this.syncSelection() || this.pending || this.agent === null) return;
    const path = this.choice;
    const shift = this.shiftChoice;
    const change = this.changeChoice;
    this.read();
    if (command !== 'assign' && this.job === null) {
      this.status = command === 'quit' ? 'This person has no job to leave.' : 'This person has no job.';
      this.show();
      return;
    }
    const after = this.source.lastCareerResult()?.sequence ?? 0n;
    let sent = false;
    if (command === 'quit') sent = this.source.quitCareer(this.agent);
    else if (command === 'shift') sent = change !== null && this.source.changeShift(this.agent, change);
    else if (command === 'work') sent = this.source.goToWork(this.agent);
    else if (path !== null) {
      sent = shift === null ? this.source.assignCareer(this.agent, path)
        : this.source.assignCareerShift(this.agent, path, shift);
    }
    if (sent) {
      this.pending = { agent: this.agent, command, after };
      this.status = SENT_TEXT[command];
    } else {
      this.status = 'The career change could not be sent.';
    }
    this.show();
  }

  afterCommands(): void {
    if (this.syncSelection()) return;
    if (this.searchSent) {
      this.searchSent = false;
      this.read();
      this.show();
    }
    if (!this.pending) return;
    const result = this.source.lastCareerResult();
    if (!result || result.sequence <= this.pending.after) return;
    const matches = result.agent === this.pending.agent;
    const command = this.pending.command;
    this.pending = null;
    this.status = !matches
      ? 'Another career change was handled. Check the current job.'
      : result.reason ?? RESULT_TEXT[command];
    this.read();
    this.show();
  }

  resetAfterLoad(): void {
    this.agent = this.source.selectedIndex();
    this.job = null;
    this.unavailable = false;
    this.choice = null;
    this.pending = null;
    this.status = '';
    this.lastRead = null;
    this.jobSearch = null;
    this.searchSent = false;
    this.clearShifts();
    this.show();
  }
}

export interface CareerPanelRoots {
  readonly section: HTMLElement;
  readonly empty: HTMLElement;
  readonly content: HTMLElement;
  /** The Overview's Career row title and its information control, which opens the same window as the tab's i. */
  readonly rowTitle?: HTMLElement;
  readonly rowInfo?: HTMLButtonElement;
}

/** What the surface asks of the panel; every action but the first four is optional for a surface built without it. */
export interface CareerPanelActions {
  choose(path: number | null): void;
  assign(): void;
  quit(): void;
  setJobSearch(search: boolean): void;
  chooseShift?(shift: number | null): void;
  chooseChange?(shift: number | null): void;
  changeShift?(): void;
  /** Sends the person to work now. */
  goToWork?(): void;
  /** Opens the review window; `opener` takes focus back when it closes. */
  openReviewGraph?(opener: HTMLButtonElement): void;
}

// [CT-strings] S-info, S-btn, S-inputs and S-eff. Functional text, for the owner's review.
export const REVIEW_GRAPH_LABEL = 'Open the review graph. Pauses the game.';
export const REVIEW_WINDOW_ID = 'career-graph-dialog';
export const GO_TO_WORK_LABEL = 'Go to work';
export const SCORE_INPUTS_HEADING = 'Score inputs';
const EFFECT_TEXT = { help: 'Helps', hurt: 'Hurts', none: 'No effect' } as const;

function line(doc: Document, className: string): HTMLParagraphElement {
  const node = doc.createElement('p');
  node.className = className;
  return node;
}

function span(doc: Document, className: string): HTMLSpanElement {
  const node = doc.createElement('span');
  node.className = className;
  return node;
}

/**
 * Builds the section's markup once and keeps it current from each state.
 * The graph is redrawn only when its weeks or thresholds change. The
 * title takes the trend as `data-trend`, here and on the Overview row, and
 * the i beside it opens the review window.
 */
export function createCareerPanelSurface(
  doc: Document,
  roots: CareerPanelRoots,
  actions: CareerPanelActions,
): (state: CareerPanelState) => void {
  const { section, empty, content } = roots;
  const heading = doc.createElement('div');
  heading.className = 'career-heading';
  const title = doc.createElement('span');
  title.className = 'career-title';
  const info = doc.createElement('button');
  info.type = 'button';
  info.className = 'career-info';
  info.textContent = 'i';
  // The window is a dialog, not a disclosure: the i has no expanded state.
  info.setAttribute('aria-label', REVIEW_GRAPH_LABEL);
  info.setAttribute('aria-haspopup', 'dialog');
  info.setAttribute('aria-controls', REVIEW_WINDOW_ID);
  // Shown by hover and keyboard focus through CSS; the button's own name
  // already says it, so assistive technology skips the visible copy.
  const infoTip = span(doc, 'career-info-tip');
  infoTip.setAttribute('role', 'tooltip');
  infoTip.setAttribute('aria-hidden', 'true');
  infoTip.textContent = REVIEW_GRAPH_LABEL;
  heading.append(title, info, infoTip);
  const subtitle = line(doc, 'career-sub');
  // The Go to work box: the command beside what it is about to do.
  const work = doc.createElement('div');
  work.className = 'career-work';
  work.setAttribute('tabindex', '-1');
  const workButton = doc.createElement('button');
  workButton.type = 'button';
  workButton.className = 'career-work-button';
  workButton.textContent = GO_TO_WORK_LABEL;
  setActionIntent(workButton, 'affirmative');
  const workText = line(doc, 'career-work-text');
  const workNote = line(doc, 'career-work-note');
  work.append(workButton, workText, workNote);
  const facts = doc.createElement('div');
  facts.className = 'career-facts';
  const nightNote = line(doc, 'career-night');
  const attendance = line(doc, 'career-attendance');
  const inputsHeading = line(doc, 'career-inputs-heading');
  inputsHeading.textContent = SCORE_INPUTS_HEADING;
  const inputs = doc.createElement('div');
  inputs.className = 'career-inputs';
  const streaks = line(doc, 'career-streaks');
  const warning = line(doc, 'career-warning');
  const graphHeading = line(doc, 'career-graph-heading');
  graphHeading.textContent = 'Reviews';
  // One group a keyboard can enter, named Reviewed weeks; hover, focus and
  // taps show what each week was, and a polite line repeats it.
  const graph = new CareerGraph(doc);
  const noReviews = line(doc, 'career-no-reviews');
  noReviews.textContent = 'No reviews yet.';
  const fieldset = doc.createElement('fieldset');
  fieldset.className = 'career-controls';
  const legend = doc.createElement('legend');
  legend.textContent = 'Assign a career';
  const label = doc.createElement('label');
  label.textContent = 'Career path';
  const select = doc.createElement('select');
  select.setAttribute('aria-label', 'Choose a career path');
  const placeholder = doc.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Choose a path';
  select.append(placeholder);
  label.append(select);
  // [WS-shell] item 3: the shift the assignment holds, By chance first.
  const shiftLabel = doc.createElement('label');
  shiftLabel.className = 'career-shift-assign';
  shiftLabel.textContent = SHIFT_LABEL;
  const shiftSelect = doc.createElement('select');
  shiftSelect.setAttribute('aria-label', 'Choose the shift for the new job');
  const byChance = doc.createElement('option');
  byChance.value = '';
  byChance.textContent = BY_CHANCE;
  shiftSelect.append(byChance);
  shiftLabel.append(shiftSelect);
  // A closed selector cuts a long line at narrow widths, hiding the chance
  // or the end time, so the chosen shift's whole line is repeated beneath
  // it. Assistive technology already reads the selector's value.
  const shiftLine = line(doc, 'career-shift-line');
  shiftLine.setAttribute('aria-hidden', 'true');
  const buttons = doc.createElement('div');
  buttons.className = 'career-actions';
  const assign = doc.createElement('button');
  assign.type = 'button';
  assign.textContent = 'Assign';
  setActionIntent(assign, 'affirmative');
  const quit = doc.createElement('button');
  quit.type = 'button';
  quit.textContent = 'Quit';
  setActionIntent(quit, 'destructive');
  buttons.append(assign, quit);
  fieldset.append(legend, label, shiftLabel, shiftLine, buttons);
  // [WS-shell] item 4: an employed person's shift, below the schedule line
  // and after the assignment controls, which keep the first path list.
  const change = doc.createElement('fieldset');
  change.className = 'career-shift-change';
  const changeLegend = doc.createElement('legend');
  changeLegend.textContent = SHIFT_SCHEDULE;
  const changeLabel = doc.createElement('label');
  changeLabel.textContent = SHIFT_LABEL;
  const changeSelect = doc.createElement('select');
  changeSelect.setAttribute('aria-label', 'Choose a shift to change to');
  changeLabel.append(changeSelect);
  const changeLine = line(doc, 'career-shift-line');
  changeLine.setAttribute('aria-hidden', 'true');
  const changeButton = doc.createElement('button');
  changeButton.type = 'button';
  changeButton.className = 'career-change-shift';
  changeButton.textContent = CHANGE_SHIFT;
  setActionIntent(changeButton, 'affirmative');
  const changeNote = line(doc, 'career-shift-note');
  changeNote.textContent = SHIFT_CHANGE_NOTE;
  // One Career panel exists, so the note's id is unique; the button names
  // the note as its description, which screen readers read with it.
  changeNote.id = 'career-shift-note';
  changeButton.setAttribute('aria-describedby', changeNote.id);
  change.append(changeLegend, changeLabel, changeLine, changeButton, changeNote);
  // The person's own setting, outside the assignment controls: it stays
  // usable while an assignment is pending and for the employed, for when
  // they are next out of work.
  const searchLabel = doc.createElement('label');
  searchLabel.className = 'career-search';
  const searchBox = doc.createElement('input');
  searchBox.type = 'checkbox';
  const searchText = doc.createElement('span');
  searchText.textContent = JOB_SEARCH_LABEL;
  searchLabel.append(searchBox, searchText);
  const status = doc.createElement('p');
  status.setAttribute('role', 'status');
  content.append(heading, subtitle, work, facts, nightNote, attendance, inputsHeading, inputs, graphHeading, graph.element,
    noReviews, streaks, warning, fieldset, change, searchLabel, status);

  const options: HTMLOptionElement[] = [];
  const shiftOptions: HTMLOptionElement[] = [];
  const changeOptions: HTMLOptionElement[] = [];
  /** Keeps `target` holding one option per row in `held`, after any options it was built with. */
  const fill = (target: HTMLSelectElement, held: HTMLOptionElement[], rows: readonly CareerShiftOption[]) => {
    while (held.length > rows.length) held.pop()!.remove();
    for (const [at, row] of rows.entries()) {
      let option = held[at];
      if (!option) {
        option = doc.createElement('option');
        held.push(option);
        target.append(option);
      }
      option.value = String(row.index);
      setTextIfChanged(option, row.text);
    }
  };
  /** Keeps `host` holding one element per entry, built by `make` and refreshed by `update`. */
  const keep = <T>(host: HTMLElement, rows: readonly T[], make: () => HTMLElement, update: (node: HTMLElement, row: T) => void) => {
    while (host.children.length > rows.length) host.lastElementChild!.remove();
    for (const [index, row] of rows.entries()) {
      let node = host.children.item(index) as HTMLElement | null;
      if (!node) {
        node = make();
        host.append(node);
      }
      update(node, row);
    }
  };
  let wasPending = false;
  // The control that sent the pending command, which takes focus back once
  // the command settles ([WS-shell]); null when the command came from
  // somewhere else, such as the keyboard on the path list.
  let sender: HTMLButtonElement | null = null;
  // Both i controls name themselves, say they open a dialog, and open the same window.
  const rowInfo = roots.rowInfo;
  if (rowInfo) {
    rowInfo.setAttribute('aria-label', REVIEW_GRAPH_LABEL);
    rowInfo.setAttribute('aria-haspopup', 'dialog');
    rowInfo.setAttribute('aria-controls', REVIEW_WINDOW_ID);
    rowInfo.removeAttribute('aria-expanded');
    rowInfo.addEventListener('click', () => actions.openReviewGraph?.(rowInfo));
  }
  info.addEventListener('click', () => actions.openReviewGraph?.(info));
  select.addEventListener('change', () => actions.choose(select.value === '' ? null : Number(select.value)));
  assign.addEventListener('click', () => { sender = assign; actions.assign(); });
  quit.addEventListener('click', () => { sender = quit; actions.quit(); });
  workButton.addEventListener('click', () => { sender = workButton; actions.goToWork?.(); });
  searchBox.addEventListener('change', () => actions.setJobSearch(searchBox.checked));
  shiftSelect.addEventListener('change', () =>
    actions.chooseShift?.(shiftSelect.value === '' ? null : Number(shiftSelect.value)));
  changeSelect.addEventListener('change', () =>
    actions.chooseChange?.(changeSelect.value === '' ? null : Number(changeSelect.value)));
  changeButton.addEventListener('click', () => { sender = changeButton; actions.changeShift?.(); });

  /**
   * Returns focus to the control that sent the settled command. A sender the
   * result disabled or hid hands focus to its nearest usable neighbor: Change
   * shift to its selector, Go to work to its box, Assign and Quit to the path
   * list.
   */
  const settleFocus = () => {
    const usable = (node: HTMLElement) =>
      !(node as HTMLButtonElement).disabled && !node.hidden && (!change.contains(node) || !change.hidden)
      && (node !== select || select.options.length > 1);
    const candidates: HTMLElement[] = sender === changeButton
      ? [changeButton, changeSelect, select]
      : sender === workButton ? [workButton, work]
        : sender === assign || sender === quit ? [sender, select] : [select];
    candidates.find(usable)?.focus();
  };

  return state => {
    const focusedHere = fieldset.contains(doc.activeElement) || change.contains(doc.activeElement)
      || work.contains(doc.activeElement);
    const workWasFocused = doc.activeElement === workButton;
    const job = state.job;
    section.dataset.state = state.agent === null ? 'unselected' : state.unavailable ? 'unavailable' : job ? 'employed' : 'unemployed';
    setTextIfChanged(empty, state.agent === null ? 'Select a person to see their career.'
      : state.unavailable ? 'Career unavailable.' : job ? '' : 'Unemployed. Choose a path below to assign one.');
    empty.hidden = state.agent !== null && !state.unavailable && job !== null;
    const detail = job !== null;
    attendance.hidden = !job?.attendance;
    setTextIfChanged(attendance, job?.attendance ?? '');
    for (const node of [heading, subtitle, facts, inputsHeading, inputs, streaks, graphHeading]) {
      node.hidden = !detail;
    }
    const view = job?.work ?? null;
    work.hidden = view === null;
    if (job) {
      setTextIfChanged(title, job.title);
      title.dataset.trend = job.trend === 1 ? 'up' : job.trend === -1 ? 'down' : 'level';
      setTextIfChanged(subtitle, job.subtitle);
      keep(facts, job.facts, () => {
        const row = doc.createElement('div');
        row.append(span(doc, 'career-fact-label'), span(doc, 'career-fact-value'));
        return row;
      }, (node, fact) => {
        node.className = fact.wide ? 'career-fact-wide' : '';
        setTextIfChanged(node.children.item(0) as HTMLElement, fact.label);
        setTextIfChanged(node.children.item(1) as HTMLElement, fact.value);
      });
      setTextIfChanged(nightNote, job.nightNote ?? '');
      nightNote.hidden = job.nightNote === null;
      keep(inputs, job.inputs, () => {
        const row = doc.createElement('div');
        const name = span(doc, 'career-input-label');
        name.append(span(doc, 'career-input-name'), span(doc, 'career-hint'));
        row.append(name, span(doc, 'career-input-value'), span(doc, 'career-effect'));
        return row;
      }, (node, input) => {
        const name = node.children.item(0) as HTMLElement;
        // A trailing space keeps the name and its hint apart for a reader.
        setTextIfChanged(name.children.item(0) as HTMLElement, input.hint === '' ? input.name : `${input.name} `);
        setTextIfChanged(name.children.item(1) as HTMLElement, input.hint);
        setTextIfChanged(node.children.item(1) as HTMLElement, input.value);
        const effect = node.children.item(2) as HTMLElement;
        setTextIfChanged(effect, input.effect === null ? '' : EFFECT_TEXT[input.effect]);
        if (input.effect === null) delete effect.dataset.effect;
        else effect.dataset.effect = input.effect;
      });
      if (view) {
        setTextIfChanged(workText, view.text);
        workText.className = view.late ? 'career-work-text career-work-late' : 'career-work-text';
        setTextIfChanged(workNote, view.note);
      }
      setTextIfChanged(streaks, job.streaks);
      setTextIfChanged(warning, job.warning ?? '');
      warning.hidden = job.warning === null;
      graph.update(job.weeks, job.thresholds);
      const reviewed = job.weeks.length > 0;
      graph.element.hidden = !reviewed;
      noReviews.hidden = !reviewed ? false : true;
      info.hidden = !reviewed;
      infoTip.hidden = !reviewed;
    } else {
      nightNote.hidden = true;
      warning.hidden = true;
      graph.element.hidden = true;
      noReviews.hidden = true;
      info.hidden = true;
      infoTip.hidden = true;
    }
    if (roots.rowTitle) {
      roots.rowTitle.dataset.trend = job ? (job.trend === 1 ? 'up' : job.trend === -1 ? 'down' : 'level') : 'level';
    }
    if (rowInfo) rowInfo.hidden = !(job !== null && job.weeks.length > 0);
    while (options.length > state.paths.length) options.pop()!.remove();
    for (const [index, name] of state.paths.entries()) {
      let option = options[index];
      if (!option) {
        option = doc.createElement('option');
        option.value = String(index);
        options.push(option);
        select.append(option);
      }
      setTextIfChanged(option, name);
    }
    select.value = state.choice === null ? '' : String(state.choice);
    const disabled = state.agent === null || state.unavailable || state.pending;
    // Disabling a focused native control otherwise sends keyboard users
    // back to the page; the controls take focus back once the command
    // settles, as the sleeping place controls do.
    if (focusedHere && disabled && doc.activeElement !== section) section.focus();
    workButton.disabled = disabled || !(view?.enabled ?? false);
    // A button disabled by a state change, not by a pending command, hands
    // its focus to the box that still says what is happening.
    if (workWasFocused && workButton.disabled && !state.pending && doc.activeElement === workButton) work.focus();
    fieldset.disabled = disabled;
    select.disabled = state.paths.length === 0;
    const assignShifts = state.assignShifts ?? [];
    fill(shiftSelect, shiftOptions, assignShifts);
    shiftSelect.value = state.shiftChoice === null || state.shiftChoice === undefined ? '' : String(state.shiftChoice);
    shiftSelect.disabled = state.choice === null || assignShifts.length === 0;
    const chosen = assignShifts.find(option => option.index === state.shiftChoice);
    setTextIfChanged(shiftLine, chosen?.text ?? '');
    shiftLine.hidden = chosen === undefined;
    const heldShifts = state.heldShifts ?? [];
    // A level that offers one shift has nothing to change to.
    change.hidden = job === null || heldShifts.length < 2;
    fill(changeSelect, changeOptions, heldShifts);
    const changeChoice = state.changeChoice ?? state.heldShift ?? null;
    changeSelect.value = changeChoice === null ? '' : String(changeChoice);
    const changeTo = heldShifts.find(option => option.index === changeChoice);
    setTextIfChanged(changeLine, changeTo?.text ?? '');
    changeLine.hidden = changeTo === undefined;
    change.disabled = disabled || job === null;
    changeButton.disabled = changeChoice === null || changeChoice === (state.heldShift ?? null);
    assign.disabled = state.choice === null;
    quit.disabled = job === null;
    searchLabel.hidden = state.jobSearch === null;
    searchBox.disabled = state.jobSearch === null;
    searchBox.checked = state.jobSearch === true;
    setTextIfChanged(status, state.status);
    status.hidden = state.status === '';
    if (wasPending && !state.pending && doc.activeElement === section && !disabled) {
      settleFocus();
    }
    if (!state.pending) sender = null;
    wasPending = state.pending;
  };
}
