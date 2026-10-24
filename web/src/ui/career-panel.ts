import { setActionIntent } from './action-intent.js';
import type { CareerFactors, CareerReport, CareerResult, CareerShift, CareerWeek } from '../bridge.js';
import { careerGraphKey, renderCareerGraph, type CareerGraphThresholds } from './career-graph.js';
import { formatCareerSchedule, formatShiftHours, shiftName, type CareerSchedule } from './game-hud.js';
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
}

/** What the section says about a held job, every line already worded. */
export interface CareerJobView {
  readonly title: string;
  readonly pathLabel: string;
  readonly level: string;
  readonly pay: string;
  readonly schedule: string;
  readonly weekSoFar: string;
  readonly lastReview: string;
  readonly attendance?: string | null;
  readonly factors: readonly string[];
  readonly streaks: string;
  readonly nextPromotion: string;
  readonly warning: string | null;
  readonly weeks: readonly CareerWeek[];
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
export const CURRENT_SHIFT = 'Current shift';
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

function signed(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

/** The factor lines, each naming what it measures. */
export function careerFactorLines(factors: CareerFactors): string[] {
  return [
    `Fit ${signed(factors.fit)} (from -1 to 1)`,
    `Trait fit ${signed(factors.traitFit)}`,
    `Social capacity ${percent(factors.socialCapacity)} against the job's ${percent(factors.socialDemand)}`,
    `Skill mastery ${percent(factors.mastery)}`,
    `Mood on the last shift ${signed(factors.mood)}`,
  ];
}

/**
 * Words one job. `title`, `pathLabel` and `schedule` come from the row the
 * Overview already shows; the rest from the report, the factors and the
 * reviewed weeks.
 */
export function careerJobView(
  title: string,
  pathLabel: string,
  schedule: string,
  report: CareerReport,
  factors: CareerFactors | null,
  weeks: readonly CareerWeek[],
): CareerJobView {
  const weekSoFar = report.shifts === 0 || report.mean === null
    ? 'No shifts completed this week.'
    : `${report.shifts} ${report.shifts === 1 ? 'shift' : 'shifts'} this week, scoring ${Math.round(report.mean)} on average.`;
  const lastReview = report.last === null
    ? 'No review yet.'
    : `Last review: ${Math.round(report.last)} of 100.`;
  const streaks = report.good > 0
    ? `Good weeks in a row: ${report.good}.`
    : report.poor > 0
      ? `Poor weeks in a row: ${report.poor}.`
      : 'No streak running.';
  const nextPromotion = report.level + 1 >= report.levels
    ? 'At the top of this path.'
    : `The next promotion needs ${report.advanceWeeks} good ${report.advanceWeeks === 1 ? 'week' : 'weeks'} in a row.`;
  return {
    title,
    pathLabel,
    level: `Level ${report.level + 1} of ${report.levels}`,
    pay: `$${report.pay} per shift, from $${report.payMin} to $${report.payMax} at this level`,
    schedule,
    weekSoFar,
    lastReview,
    factors: factors === null ? [] : careerFactorLines(factors),
    streaks,
    nextPromotion,
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
};

const SENT_TEXT: Readonly<Record<string, string>> = {
  assign: 'Assigning the career…',
  quit: 'Leaving the job…',
  shift: 'Changing the shift…',
};

type CareerCommand = 'assign' | 'quit' | 'shift';

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
    const schedule = formatCareerSchedule(title, held, this.source.dayTicks());
    this.job = careerJobView(title, this.paths[report.path], schedule, report,
      this.source.careerFactors(this.agent), this.source.careerHistory(this.agent));
    this.job = {...this.job, attendance: careerAttendanceLine(this.source.careerAttendanceOf?.(this.agent) ?? [])};
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
  /** The Overview's Career row title and its information control. */
  readonly rowTitle?: HTMLElement;
  readonly rowInfo?: HTMLButtonElement;
  readonly rowGraph?: HTMLElement;
}

function line(doc: Document, className: string): HTMLParagraphElement {
  const node = doc.createElement('p');
  node.className = className;
  return node;
}

/**
 * Builds the section's markup once and keeps it current from each state.
 * The graph is redrawn only when its weeks or thresholds change. The
 * Overview row's title takes the trend as `data-trend`, and its
 * information control shows a miniature of the same graph beneath the
 * row.
 */
export function createCareerPanelSurface(
  doc: Document,
  roots: CareerPanelRoots,
  actions: {
    choose(path: number | null): void; assign(): void; quit(): void; setJobSearch(search: boolean): void;
    chooseShift?(shift: number | null): void; chooseChange?(shift: number | null): void; changeShift?(): void;
  },
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
  info.setAttribute('aria-label', 'Show the review graph');
  info.setAttribute('aria-expanded', 'false');
  info.setAttribute('aria-controls', 'career-tab-mini-graph');
  heading.append(title, info);
  const path = line(doc, 'career-path');
  const level = line(doc, 'career-level');
  const pay = line(doc, 'career-pay');
  const schedule = line(doc, 'career-schedule');
  const week = line(doc, 'career-week');
  const lastReview = line(doc, 'career-last-review');
  const attendance = line(doc, 'career-attendance');
  const factorsHeading = doc.createElement('p');
  factorsHeading.className = 'career-factors-heading';
  factorsHeading.textContent = 'What the score reads';
  const factors = doc.createElement('ul');
  factors.className = 'career-factors';
  const streaks = line(doc, 'career-streaks');
  const nextPromotion = line(doc, 'career-next');
  const warning = line(doc, 'career-warning');
  const graphHeading = doc.createElement('p');
  graphHeading.className = 'career-graph-heading';
  graphHeading.textContent = 'Reviews';
  // Each graph is one picture to assistive technology (`role="img"`), named
  // Reviewed weeks; the markers' titles are hover tooltips, and the lines
  // of text above say what the graph shows.
  const graph = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  graph.setAttribute('class', 'career-graph');
  graph.setAttribute('role', 'img');
  graph.setAttribute('aria-label', 'Reviewed weeks');
  const noReviews = line(doc, 'career-no-reviews');
  noReviews.textContent = 'No reviews yet.';
  const miniGraph = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  miniGraph.setAttribute('class', 'career-graph career-graph-mini');
  miniGraph.setAttribute('id', 'career-tab-mini-graph');
  miniGraph.setAttribute('role', 'img');
  miniGraph.setAttribute('aria-label', 'Reviewed weeks');
  miniGraph.setAttribute('hidden', '');
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
  fieldset.append(legend, label, shiftLabel, buttons);
  // [WS-shell] item 4: an employed person's shift, below the schedule line
  // and after the assignment controls, which keep the first path list.
  const change = doc.createElement('fieldset');
  change.className = 'career-shift-change';
  const changeLegend = doc.createElement('legend');
  changeLegend.textContent = CURRENT_SHIFT;
  const changeLabel = doc.createElement('label');
  changeLabel.textContent = SHIFT_LABEL;
  const changeSelect = doc.createElement('select');
  changeSelect.setAttribute('aria-label', 'Choose a shift to change to');
  changeLabel.append(changeSelect);
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
  change.append(changeLegend, changeLabel, changeButton, changeNote);
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
  // The miniature sits under the heading its control belongs to, so
  // pressing i changes what is on screen wherever the tab is scrolled.
  content.append(heading, miniGraph, path, level, pay, schedule, week, lastReview, attendance, factorsHeading, factors,
    streaks, nextPromotion, warning, graphHeading, graph, noReviews, fieldset, change, searchLabel, status);

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
  let drawn = '';
  let miniOpen = false;
  let rowMiniOpen = false;
  let wasPending = false;
  // The control that sent the pending command, which takes focus back once
  // the command settles ([WS-shell]); null when the command came from
  // somewhere else, such as the keyboard on the path list.
  let sender: HTMLButtonElement | null = null;
  const rowGraphSvg = roots.rowGraph ? doc.createElementNS('http://www.w3.org/2000/svg', 'svg') : null;
  if (rowGraphSvg && roots.rowGraph) {
    rowGraphSvg.setAttribute('class', 'career-graph career-graph-mini');
    rowGraphSvg.setAttribute('role', 'img');
    rowGraphSvg.setAttribute('aria-label', 'Reviewed weeks');
    roots.rowGraph.append(rowGraphSvg);
    roots.rowGraph.hidden = true;
    if (!roots.rowGraph.id) roots.rowGraph.id = 'career-row-graph';
    roots.rowInfo?.setAttribute('aria-controls', roots.rowGraph.id);
  }
  info.addEventListener('click', () => {
    miniOpen = !miniOpen;
    info.setAttribute('aria-expanded', String(miniOpen));
    if (miniOpen) miniGraph.removeAttribute('hidden');
    else miniGraph.setAttribute('hidden', '');
  });
  roots.rowInfo?.addEventListener('click', () => {
    rowMiniOpen = !rowMiniOpen;
    roots.rowInfo?.setAttribute('aria-expanded', String(rowMiniOpen));
    if (roots.rowGraph) roots.rowGraph.hidden = !rowMiniOpen;
  });
  select.addEventListener('change', () => actions.choose(select.value === '' ? null : Number(select.value)));
  assign.addEventListener('click', () => { sender = assign; actions.assign(); });
  quit.addEventListener('click', () => { sender = quit; actions.quit(); });
  searchBox.addEventListener('change', () => actions.setJobSearch(searchBox.checked));
  shiftSelect.addEventListener('change', () =>
    actions.chooseShift?.(shiftSelect.value === '' ? null : Number(shiftSelect.value)));
  changeSelect.addEventListener('change', () =>
    actions.chooseChange?.(changeSelect.value === '' ? null : Number(changeSelect.value)));
  changeButton.addEventListener('click', () => { sender = changeButton; actions.changeShift?.(); });

  /**
   * Returns focus to the control that sent the settled command. A sender the
   * result disabled or hid hands focus to its nearest usable neighbor: Change
   * shift to its selector, Assign and Quit to the path list.
   */
  const settleFocus = () => {
    const usable = (node: HTMLSelectElement | HTMLButtonElement) =>
      !node.disabled && !node.hidden && (!change.contains(node) || !change.hidden)
      && (node !== select || select.options.length > 1);
    const candidates: (HTMLSelectElement | HTMLButtonElement)[] = sender === changeButton
      ? [changeButton, changeSelect, select]
      : sender === assign || sender === quit ? [sender, select] : [select];
    candidates.find(usable)?.focus();
  };

  return state => {
    const focusedHere = fieldset.contains(doc.activeElement) || change.contains(doc.activeElement);
    const job = state.job;
    section.dataset.state = state.agent === null ? 'unselected' : state.unavailable ? 'unavailable' : job ? 'employed' : 'unemployed';
    setTextIfChanged(empty, state.agent === null ? 'Select a person to see their career.'
      : state.unavailable ? 'Career unavailable.' : job ? '' : 'Unemployed. Choose a path below to assign one.');
    empty.hidden = state.agent !== null && !state.unavailable && job !== null;
    const detail = job !== null;
    attendance.hidden = !job?.attendance;
    setTextIfChanged(attendance, job?.attendance ?? '');
    for (const node of [heading, path, level, pay, schedule, week, lastReview, factorsHeading, factors, streaks, nextPromotion, graphHeading]) {
      node.hidden = !detail;
    }
    if (job) {
      setTextIfChanged(title, job.title);
      title.dataset.trend = job.trend === 1 ? 'up' : job.trend === -1 ? 'down' : 'level';
      setTextIfChanged(path, `Path: ${job.pathLabel}`);
      setTextIfChanged(level, job.level);
      setTextIfChanged(pay, job.pay);
      setTextIfChanged(schedule, job.schedule);
      setTextIfChanged(week, job.weekSoFar);
      setTextIfChanged(lastReview, job.lastReview);
      while (factors.children.length > job.factors.length) factors.lastElementChild!.remove();
      for (const [index, text] of job.factors.entries()) {
        let item = factors.children.item(index) as HTMLElement | null;
        if (!item) {
          item = doc.createElement('li');
          factors.append(item);
        }
        setTextIfChanged(item, text);
      }
      setTextIfChanged(streaks, job.streaks);
      setTextIfChanged(nextPromotion, job.nextPromotion);
      setTextIfChanged(warning, job.warning ?? '');
      warning.hidden = job.warning === null;
      const key = careerGraphKey(job.weeks, job.thresholds);
      if (key !== drawn) {
        renderCareerGraph(doc, graph, job.weeks, job.thresholds);
        renderCareerGraph(doc, miniGraph, job.weeks, job.thresholds);
        if (rowGraphSvg) renderCareerGraph(doc, rowGraphSvg, job.weeks, job.thresholds);
        drawn = key;
      }
      const reviewed = job.weeks.length > 0;
      graph.toggleAttribute('hidden', !reviewed);
      noReviews.hidden = !reviewed ? false : true;
      info.hidden = !reviewed;
      if (!reviewed) {
        miniOpen = false;
        info.setAttribute('aria-expanded', 'false');
        miniGraph.setAttribute('hidden', '');
      }
    } else {
      warning.hidden = true;
      graph.setAttribute('hidden', '');
      noReviews.hidden = true;
      miniGraph.setAttribute('hidden', '');
      info.hidden = true;
      miniOpen = false;
      info.setAttribute('aria-expanded', 'false');
      drawn = '';
    }
    if (roots.rowTitle) {
      roots.rowTitle.dataset.trend = job ? (job.trend === 1 ? 'up' : job.trend === -1 ? 'down' : 'level') : 'level';
    }
    if (roots.rowInfo) {
      const reviewed = job !== null && job.weeks.length > 0;
      roots.rowInfo.hidden = !reviewed;
      if (!reviewed) {
        rowMiniOpen = false;
        roots.rowInfo.setAttribute('aria-expanded', 'false');
        if (roots.rowGraph) roots.rowGraph.hidden = true;
      }
    }
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
    fieldset.disabled = disabled;
    select.disabled = state.paths.length === 0;
    const assignShifts = state.assignShifts ?? [];
    fill(shiftSelect, shiftOptions, assignShifts);
    shiftSelect.value = state.shiftChoice === null || state.shiftChoice === undefined ? '' : String(state.shiftChoice);
    shiftSelect.disabled = state.choice === null || assignShifts.length === 0;
    const heldShifts = state.heldShifts ?? [];
    // A level that offers one shift has nothing to change to.
    change.hidden = job === null || heldShifts.length < 2;
    fill(changeSelect, changeOptions, heldShifts);
    const changeChoice = state.changeChoice ?? state.heldShift ?? null;
    changeSelect.value = changeChoice === null ? '' : String(changeChoice);
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
