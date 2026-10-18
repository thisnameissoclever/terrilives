import { setActionIntent } from './action-intent.js';
import type { CareerFactors, CareerReport, CareerResult, CareerWeek } from '../bridge.js';
import { careerGraphKey, renderCareerGraph, type CareerGraphThresholds } from './career-graph.js';
import { formatCareerSchedule, type CareerSchedule } from './game-hud.js';
import { setTextIfChanged } from './set-text-if-changed.js';

// The Career section of Sim details - rule 18 of
// docs/specs/2026-10-17-careers.md. It reads the selected person's job,
// the week so far, the last review, the factors behind the score, the
// counters and the graph of reviewed weeks, and offers the paths to
// assign and a Quit control: the same commands the simulation defines,
// nothing else. One pending command at a time; the simulation stays the
// authority on what a command does.

export interface CareerPanelSource {
  selectedIndex(): number | null;
  dayTicks(): number;
  careerOf(entity: number): string | null;
  careerScheduleOf(entity: number): CareerSchedule | null;
  careerReport(entity: number): CareerReport | null;
  careerHistory(entity: number): readonly CareerWeek[];
  careerFactors(entity: number): CareerFactors | null;
  careerPathLabels(): readonly string[];
  assignCareer(entity: number, path: number): boolean;
  quitCareer(entity: number): boolean;
  lastCareerResult(): CareerResult | null;
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
}

export const CAREER_WARNING = 'Warned at work: dismissal becomes possible from the third poor week in a row.';

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
  assigned: 'Career assigned.',
  quit: 'Job left.',
};

/** One pending UI command; `afterCommands` reads what the drain did with it. */
export class CareerPanel {
  private agent: number | null = null;
  private job: CareerJobView | null = null;
  private unavailable = false;
  private paths: readonly string[] = [];
  private choice: number | null = null;
  private status = '';
  private pending: { agent: number; path: number | null; after: bigint } | null = null;
  private lastRead: number | null = null;

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
      choice: this.choice, pending: this.pending !== null, status: this.status });
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
    this.show();
    return true;
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
    if (this.agent === null) {
      this.job = null;
      this.unavailable = false;
      return;
    }
    const title = this.source.careerOf(this.agent);
    if (title === null) {
      this.job = null;
      this.unavailable = false;
      return;
    }
    const report = this.source.careerReport(this.agent);
    if (report === null || report.path >= this.paths.length) {
      this.job = null;
      this.unavailable = true;
      return;
    }
    this.unavailable = false;
    const schedule = formatCareerSchedule(title, this.source.careerScheduleOf(this.agent), this.source.dayTicks());
    this.job = careerJobView(title, this.paths[report.path], schedule, report,
      this.source.careerFactors(this.agent), this.source.careerHistory(this.agent));
    if (this.choice !== null && this.choice >= this.paths.length) this.choice = null;
  }

  choose(path: number | null): void {
    if (this.syncSelection() || this.pending) return;
    this.choice = path !== null && Number.isInteger(path) && path >= 0 && path < this.paths.length ? path : null;
    this.status = '';
    this.show();
  }

  assign(): void {
    if (this.choice !== null) this.stage(this.choice);
  }

  quit(): void { this.stage(null); }

  private stage(path: number | null): void {
    if (this.syncSelection() || this.pending || this.agent === null) return;
    this.read();
    if (path === null && this.job === null) {
      this.status = 'This person has no job to leave.';
      this.show();
      return;
    }
    const after = this.source.lastCareerResult()?.sequence ?? 0n;
    const sent = path === null ? this.source.quitCareer(this.agent) : this.source.assignCareer(this.agent, path);
    if (sent) {
      this.pending = { agent: this.agent, path, after };
      this.status = path === null ? 'Leaving the job…' : 'Assigning the career…';
    } else {
      this.status = 'The career change could not be sent.';
    }
    this.show();
  }

  afterCommands(): void {
    if (this.syncSelection() || !this.pending) return;
    const result = this.source.lastCareerResult();
    if (!result || result.sequence <= this.pending.after) return;
    const matches = result.agent === this.pending.agent;
    const wasQuit = this.pending.path === null;
    this.pending = null;
    this.status = !matches
      ? 'Another career change was handled. Check the current job.'
      : result.reason ?? (wasQuit ? RESULT_TEXT.quit : RESULT_TEXT.assigned);
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
  actions: { choose(path: number | null): void; assign(): void; quit(): void },
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
  fieldset.append(legend, label, buttons);
  const status = doc.createElement('p');
  status.setAttribute('role', 'status');
  // The miniature sits under the heading its control belongs to, so
  // pressing i changes what is on screen wherever the tab is scrolled.
  content.append(heading, miniGraph, path, level, pay, schedule, week, lastReview, factorsHeading, factors,
    streaks, nextPromotion, warning, graphHeading, graph, noReviews, fieldset, status);

  const options: HTMLOptionElement[] = [];
  let drawn = '';
  let miniOpen = false;
  let rowMiniOpen = false;
  let wasPending = false;
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
  assign.addEventListener('click', () => actions.assign());
  quit.addEventListener('click', () => actions.quit());

  return state => {
    const focusedHere = content.contains(doc.activeElement);
    const job = state.job;
    section.dataset.state = state.agent === null ? 'unselected' : state.unavailable ? 'unavailable' : job ? 'employed' : 'unemployed';
    setTextIfChanged(empty, state.agent === null ? 'Select a person to see their career.'
      : state.unavailable ? 'Career unavailable.' : job ? '' : 'Unemployed. Choose a path below to assign one.');
    empty.hidden = state.agent !== null && !state.unavailable && job !== null;
    const detail = job !== null;
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
    assign.disabled = state.choice === null;
    quit.disabled = job === null;
    setTextIfChanged(status, state.status);
    status.hidden = state.status === '';
    if (wasPending && !state.pending && doc.activeElement === section && !disabled && state.paths.length > 0) {
      select.focus();
    }
    wasPending = state.pending;
  };
}
