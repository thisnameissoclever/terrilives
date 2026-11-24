import type { CareerInputWeek, CareerReport, CareerWeek } from '../bridge.js';
import { setActionIntent } from './action-intent.js';
import {
  CAREER_EVENT_CHANGED_PATH,
  CAREER_EVENT_DEMOTION,
  CAREER_EVENT_PROMOTION,
  CAREER_EVENT_RAISE,
  careerEventSentence,
  careerKindSentence,
  careerThresholdText,
  careerTipHeading,
  careerTipText,
  careerWeekKind,
  signedTwoDecimals,
  withEventTitles,
  type CareerGraphThresholds,
  type CareerGraphWeek,
} from './career-graph-words.js';
import type { CareerSchedule } from './game-hud.js';

// The review window: every reviewed week's score and the inputs behind it,
// in one modal dialog opened from the i beside the job title
// ([CT-web] of docs/specs/2026-11-19-career-tab.md). Opening pauses the game
// through the shared overlay pause, which is shell time and never a command;
// closing by any route restores exactly the speed the player had chosen. The
// data is read once at open: the game is paused, so it cannot change. One DOM
// serves a desktop, where hovering shows a floating tooltip, and a phone,
// where a tap shows week details docked at the bottom and the plot scrolls
// sideways. Functional text, for the owner's review ([CT-strings] S-win,
// S-filters, S-scale, S-rowlabels and S-tipfacts).

/** The two presets besides All weeks: labels of a view, not simulation tuning ([CT-q-presets]). */
export const CAREER_RECENT_WEEKS = 4;
export const CAREER_LONGER_WEEKS = 12;
/** The window fills the screen under this query: a phone, or a phone turned sideways. */
export const CAREER_PHONE_QUERY = '(max-width: 600px), (max-height: 480px)';
const PAUSE_OWNER = 'career-graph';
const DIALOG_ID = 'career-graph-dialog';
const TITLE_ID = 'career-graph-title';
const SVG = 'http://www.w3.org/2000/svg';
/** The desktop tooltip's width, which holds its longest label without wrapping, and its gap from the point. */
const TIP_WIDTH = 420;
const TIP_GAP = 16;
/** The chart area's width when the layout cannot be measured. */
const DEFAULT_WIDTH = 780;

export interface CareerReviewSource {
  simName(entity: number): string;
  careerOf(entity: number): string | null;
  careerReport(entity: number): CareerReport | null;
  careerHistory(entity: number): readonly CareerWeek[];
  careerInputHistory(entity: number): readonly CareerInputWeek[];
  careerLevelTitles(path: number): readonly string[];
  careerPathLabels(): readonly string[];
  careerScheduleOf(entity: number): CareerSchedule | null;
  dayTicks(): number;
}

/** The part of the overlay pause the window uses. */
export interface CareerReviewPause {
  suspend(owner: string): void;
  resume(owner: string): void;
  /** The speed the player chose, 0 when paused. */
  readonly selectedSpeed: number;
}

type SeriesId = 'mastery' | 'mood' | 'missed' | 'fit' | 'trait' | 'social' | 'pay';
type FilterId = SeriesId | 'bands' | 'events';
type Range = 'recent' | 'longer' | 'all';

interface Scale {
  readonly min: number;
  readonly max: number;
  /** The labels at the top and the bottom of the row. */
  readonly top: string;
  readonly bottom: string;
}

interface Series {
  readonly id: SeriesId;
  readonly name: string;
  readonly bars?: boolean;
  readonly zero?: boolean;
  pick(row: CareerInputWeek): number;
  text(row: CareerInputWeek): string;
  scale(rows: readonly CareerInputWeek[], shiftMinutes: number): Scale;
}

const unit = (value: number): string => String(Number(value.toFixed(1)));
const percent = (value: number): string => `${Math.round(value * 100)}%`;
const plural = (count: number, one: string, many: string): string => (count === 1 ? one : many);

/** A symmetric scale of at least -1 to +1, wider when a value needs it. */
function symmetric(values: readonly number[]): Scale {
  const widest = Math.max(1, Math.ceil(Math.max(0, ...values.map(Math.abs)) * 2) / 2);
  return { min: -widest, max: widest, top: `+${unit(widest)}`, bottom: `-${unit(widest)}` };
}

function knownPay(row: CareerInputWeek): number[] {
  return row.sources === undefined ? [row.pay] : row.sources.flatMap(source => source.basePay === null ? [] : [source.basePay]);
}

function payText(row: CareerInputWeek): string {
  if (row.sources === undefined) return `$${row.pay}`;
  const values = knownPay(row);
  const unknown = values.length !== row.sources.length;
  if (values.length === 0) return `Shift base pay unrecorded (pay at review: $${row.pay})`;
  const low = Math.min(...values);
  const high = Math.max(...values);
  const range = low === high ? `$${low}` : `$${low} - $${high}`;
  if (unknown) return `Recorded base pay ${range} (some unrecorded; pay at review: $${row.pay})`;
  return low === high && low === row.pay ? range : `${range} (pay at review: $${row.pay})`;
}

function mixedRoles(row: CareerInputWeek): boolean {
  return new Set(row.sources?.map(source => `${source.path}:${source.level}`)).size > 1;
}

const SERIES: readonly Series[] = [
  { id: 'mastery', name: 'Skill mastery', pick: row => row.mastery, text: row => percent(row.mastery),
    scale: () => ({ min: 0, max: 1, top: '100%', bottom: '0%' }) },
  { id: 'mood', name: 'Mood on shifts', zero: true, pick: row => row.mood, text: row => signedTwoDecimals(row.mood),
    scale: () => ({ min: -1, max: 1, top: '+1', bottom: '-1' }) },
  { id: 'missed', name: 'Missed work', bars: true, pick: row => row.missedMinutes,
    text: row => { const minutes = Math.round(row.missedMinutes); return `${minutes} ${plural(minutes, 'minute', 'minutes')}`; },
    scale: (rows, shiftMinutes) => {
      // The larger of the longest shift and the largest weekly total ([CT-q-missed]), labelled in hours.
      const top = Math.max(shiftMinutes, 1, ...rows.map(row => row.missedMinutes));
      return { min: 0, max: top, top: `${unit(top / 60)} h`, bottom: '0 min' };
    } },
  { id: 'fit', name: 'Fit', zero: true, pick: row => row.fit, text: row => signedTwoDecimals(row.fit),
    scale: () => ({ min: -1, max: 1, top: '+1', bottom: '-1' }) },
  { id: 'trait', name: 'Trait fit', zero: true, pick: row => row.traitFit, text: row => signedTwoDecimals(row.traitFit),
    scale: rows => symmetric(rows.map(row => row.traitFit)) },
  { id: 'social', name: 'Social capacity', pick: row => row.socialCapacity,
    text: row => `${percent(row.socialCapacity)} (${mixedRoles(row) ? 'average job demand' : 'job needs'} ${percent(row.socialDemand)})`,
    scale: () => ({ min: 0, max: 1, top: '100%', bottom: '0%' }) },
  { id: 'pay', name: 'Pay per shift', pick: row => row.pay, text: row => row.sources === undefined ? `$${row.pay} per shift` : `${payText(row)} per shift`,
    scale: rows => {
      const values = rows.flatMap(row => [row.pay, ...knownPay(row)]);
      let low = Math.min(...values);
      let high = Math.max(...values);
      if (low === high) { const pad = Math.max(1, Math.round(low * 0.1)); low -= pad; high += pad; }
      return { min: low, max: high, top: `$${Math.round(high)}`, bottom: `$${Math.round(low)}` };
    } },
];

const SCORE_INPUTS: readonly SeriesId[] = ['mastery', 'mood', 'missed', 'fit', 'trait', 'social'];

interface Layout {
  readonly axis: number;
  readonly minColumn: number;
  readonly score: { readonly height: number; readonly top: number; readonly bottom: number };
  readonly row: { readonly height: number; readonly top: number; readonly bottom: number };
  readonly dot: number;
}

const DESKTOP: Layout = { axis: 64, minColumn: 12, score: { height: 284, top: 30, bottom: 30 }, row: { height: 36, top: 3, bottom: 3 }, dot: 5 };
const PHONE: Layout = { axis: 40, minColumn: 40, score: { height: 206, top: 34, bottom: 24 }, row: { height: 44, top: 4, bottom: 4 }, dot: 5.5 };

/** One reviewed week with the inputs behind it, when they were recorded. */
interface Row {
  readonly week: CareerGraphWeek;
  readonly inputs: CareerInputWeek | null;
  /** The job title held that week, when the inputs say. */
  readonly title: string | null;
}

interface Chart {
  readonly id: string;
  readonly svg: SVGSVGElement;
  readonly axis: SVGSVGElement;
  readonly scroller: HTMLElement;
  readonly value: HTMLElement;
  readonly series: Series | null;
}

function html<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (className) node.setAttribute('class', className);
  return node;
}

function svgNode<K extends keyof SVGElementTagNameMap>(
  doc: Document, tag: K, attributes: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const node = doc.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

function text(doc: Document, className: string, content: string): HTMLSpanElement {
  const node = html(doc, 'span', className);
  node.textContent = content;
  return node;
}

/** A coordinate with one decimal at most. */
const c = (value: number): string => String(Number(value.toFixed(1)));

/** Visible and enabled: able to take focus back. */
function usable(node: HTMLElement | null): node is HTMLElement {
  if (node === null || node.hidden || (node as HTMLButtonElement).disabled || node.isConnected === false) return false;
  const boxes = node.getClientRects?.();
  return boxes === undefined || boxes.length > 0;
}

export class CareerReviewWindow {
  readonly element: HTMLDialogElement;
  private readonly heading: HTMLElement;
  private readonly who: HTMLElement;
  private readonly pausedNote: HTMLElement;
  private readonly details: HTMLDetailsElement;
  private readonly filterCount: HTMLElement;
  private readonly boxes = new Map<FilterId, HTMLInputElement>();
  private readonly rangeButtons = new Map<Range, HTMLButtonElement>();
  private readonly summary: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly charts: HTMLElement;
  private readonly tip: HTMLElement;
  private readonly tipTitle: HTMLElement;
  private readonly tipKind: HTMLElement;
  private readonly tipRest: HTMLElement;
  private readonly tipEvent: HTMLElement;
  private readonly tipMissing: HTMLElement;
  private readonly tipFacts: HTMLElement;
  private readonly previous: HTMLButtonElement;
  private readonly next: HTMLButtonElement;
  private readonly live: HTMLElement;
  private readonly keys: HTMLElement[] = [];
  private opener: HTMLElement | null = null;
  private rows: Row[] = [];
  private thresholds: CareerGraphThresholds = { poor: 40, good: 65 };
  private shiftMinutes = 0;
  private range: Range = 'all';
  /** The week picked by a tap, a click or the keyboard: it stays until another pick, Previous or Next week, or Hide details. */
  private chosen: number | null = null;
  /** How the chosen week was picked: only a keyboard pick is dropped when the graph loses focus. */
  private chosenBy: 'keyboard' | 'pointer' = 'pointer';
  /** The week under a mouse on a desktop: a preview that only shows or clears, never touching the chosen week. */
  private hover: number | null = null;
  private handles: Chart[] = [];
  /** True while the charts are replaced, so the old graph losing focus is not a person leaving it. */
  private rebuilding = false;
  private layout: Layout = DESKTOP;
  private column = 0;
  private builtWidth = -1;
  private builtPhone = false;
  private pointerDown = false;
  private readonly filters: Record<FilterId, boolean> = {
    mastery: true, mood: true, missed: true, fit: true, trait: false, social: false, pay: false, bands: true, events: true,
  };

  constructor(
    private readonly doc: Document,
    private readonly source: CareerReviewSource,
    private readonly pause: CareerReviewPause,
    private readonly fallbackFocus: () => readonly (HTMLElement | null)[] = () => [],
  ) {
    const dialog = html(doc, 'dialog', 'career-win');
    dialog.id = DIALOG_ID;
    dialog.setAttribute('aria-labelledby', TITLE_ID);
    this.element = dialog as HTMLDialogElement;
    const frame = html(doc, 'div', 'career-win-frame');

    const header = html(doc, 'header', 'career-win-header');
    this.heading = html(doc, 'h2', 'career-win-title');
    this.heading.id = TITLE_ID;
    this.heading.setAttribute('tabindex', '-1');
    this.who = html(doc, 'p', 'career-win-who');
    const paused = html(doc, 'div', 'career-win-paused');
    paused.setAttribute('role', 'status');
    const pauseIcon = svgNode(doc, 'svg', { width: 12, height: 14, 'aria-hidden': 'true', class: 'career-win-paused-icon' });
    pauseIcon.append(svgNode(doc, 'rect', { x: 0, y: 0, width: 4, height: 14 }), svgNode(doc, 'rect', { x: 8, y: 0, width: 4, height: 14 }));
    this.pausedNote = text(doc, 'career-win-paused-note', '');
    const badge = html(doc, 'span', 'career-win-paused-badge');
    badge.append(pauseIcon, text(doc, 'career-win-paused-label', 'Game paused'));
    paused.append(badge, this.pausedNote);
    const close = html(doc, 'button', 'hud-button career-win-close');
    close.type = 'button';
    close.textContent = 'Close';
    setActionIntent(close, 'negative');
    close.addEventListener('click', () => this.close());
    header.append(this.heading, this.who, paused, close);

    const body = html(doc, 'div', 'career-win-body');
    this.details = html(doc, 'details', 'career-win-filters');
    const summary = html(doc, 'summary');
    this.filterCount = text(doc, 'career-win-filter-count', '');
    summary.append(text(doc, 'career-win-filters-label', 'Filters'), this.filterCount);
    this.details.append(summary, this.buildFilters());
    const sideKey = this.buildKey('career-win-key career-win-key-side');
    const aside = html(doc, 'aside', 'career-win-aside');
    aside.append(this.details, sideKey);

    const main = html(doc, 'main', 'career-win-main');
    const toolbar = html(doc, 'div', 'career-win-toolbar');
    const range = html(doc, 'div', 'career-win-range');
    range.setAttribute('role', 'group');
    range.setAttribute('aria-label', 'Weeks shown');
    for (const [id, label] of [['recent', `Last ${CAREER_RECENT_WEEKS} weeks`], ['longer', `Last ${CAREER_LONGER_WEEKS} weeks`], ['all', 'All weeks']] as const) {
      const button = html(doc, 'button');
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('click', () => this.setRange(id));
      this.rangeButtons.set(id, button);
      range.append(button);
    }
    toolbar.append(text(doc, 'career-win-show', 'Show'), range);
    this.summary = html(doc, 'p', 'career-win-summary');
    this.hint = html(doc, 'p', 'career-win-hint');
    this.hint.textContent = 'Tap a week for details.';
    this.charts = html(doc, 'div', 'career-win-charts');
    const plots = html(doc, 'div', 'career-win-plots');
    this.tip = html(doc, 'div', 'career-win-tip');
    this.tip.hidden = true;
    this.tipTitle = html(doc, 'div', 'career-tip-title');
    const tipBody = html(doc, 'div', 'career-tip-body');
    this.tipKind = html(doc, 'span', 'career-tip-kind');
    this.tipRest = html(doc, 'span', 'career-tip-rest');
    tipBody.append(this.tipKind, this.tipRest);
    this.tipEvent = html(doc, 'div', 'career-tip-event');
    this.tipMissing = html(doc, 'div', 'career-tip-missing');
    this.tipMissing.textContent = 'No score inputs were recorded for this week.';
    this.tipFacts = html(doc, 'dl');
    const steps = html(doc, 'div', 'career-win-steps');
    this.previous = html(doc, 'button', 'hud-button');
    this.previous.type = 'button';
    this.previous.textContent = 'Previous week';
    this.next = html(doc, 'button', 'hud-button');
    this.next.type = 'button';
    this.next.textContent = 'Next week';
    const hide = html(doc, 'button', 'hud-button');
    hide.type = 'button';
    hide.textContent = 'Hide details';
    this.previous.addEventListener('click', () => this.step(-1));
    this.next.addEventListener('click', () => this.step(1));
    hide.addEventListener('click', () => this.choose(null));
    steps.append(this.previous, this.next, hide);
    this.tip.append(this.tipTitle, tipBody, this.tipEvent, this.tipMissing, this.tipFacts, steps);
    plots.append(this.charts, this.tip);
    this.live = html(doc, 'p', 'career-live');
    this.live.setAttribute('aria-live', 'polite');
    const flowKey = this.buildKey('career-win-key career-win-key-flow');
    main.append(toolbar, this.summary, this.hint, plots, flowKey, this.live);
    body.append(aside, main);
    frame.append(header, body);
    dialog.append(frame);

    // A click on the backdrop lands on the dialog itself; the frame fills the rest.
    dialog.addEventListener('click', event => { if (event.target === dialog) this.close(); });
    // Escape, the Close button and the backdrop all end here, so the game resumes exactly once.
    dialog.addEventListener('close', () => this.afterClose());
    const observer = (doc.defaultView as (Window & { ResizeObserver?: typeof ResizeObserver }) | null)?.ResizeObserver;
    if (observer) new observer(() => this.onResize()).observe(this.charts);
  }

  get isOpen(): boolean {
    return this.element.open;
  }

  /**
   * Pauses the game and opens the window for `entity`; false, doing neither,
   * when it is already open or the person has no job or no reviewed week.
   * `opener` takes focus back when the window closes.
   */
  open(entity: number, opener: HTMLElement | null): boolean {
    if (this.element.open) return false;
    const read = this.read(entity);
    if (read === null) return false;
    this.opener = opener;
    this.range = 'all';
    this.chosen = null;
    this.hover = null;
    const speed = this.pause.selectedSpeed;
    this.heading.textContent = `${read.name}'s reviews`;
    this.who.textContent = read.subtitle;
    this.pausedNote.textContent = speed === 0
      ? 'The game stays paused after you close this window.'
      : `Closing this window resumes the game at ${speed}x.`;
    this.pause.suspend(PAUSE_OWNER);
    try {
      this.details.open = !this.isPhone();
      this.rebuild();
      this.element.showModal();
    } catch (error) {
      this.pause.resume(PAUSE_OWNER);
      throw error;
    }
    // The heading, so a screen reader announces whose reviews these are.
    this.heading.focus();
    return true;
  }

  /** Closes the window, resuming the game; nothing happens when it is not open. */
  close(): void {
    if (this.element.open) this.element.close();
  }

  private read(entity: number): { name: string; subtitle: string } | null {
    const report = this.source.careerReport(entity);
    const title = this.source.careerOf(entity);
    const weeks = this.source.careerHistory(entity);
    if (report === null || title === null || weeks.length === 0) return null;
    const cache = new Map<number, readonly string[]>();
    const titleOf = (path: number, level: number): string | null => {
      let titles = cache.get(path);
      if (titles === undefined) { titles = this.source.careerLevelTitles(path); cache.set(path, titles); }
      return titles[level] ?? null;
    };
    const inputs = this.source.careerInputHistory(entity);
    const byWeek = new Map(inputs.map(row => [row.week, row]));
    this.rows = withEventTitles(weeks, inputs, titleOf, title).map(week => {
      const row = byWeek.get(week.week) ?? null;
      const workedTitles = row?.sources?.map(source => titleOf(source.path, source.level)).filter((name): name is string => name !== null);
      const title = workedTitles === undefined ? (row === null ? null : titleOf(row.path, row.level)) : [...new Set(workedTitles)].join(', ');
      return { week, inputs: row, title };
    });
    this.thresholds = { poor: report.poorThreshold, good: report.goodThreshold };
    const dayTicks = this.source.dayTicks();
    const shift = this.source.careerScheduleOf(entity);
    this.shiftMinutes = shift === null || dayTicks <= 0 ? 0 : (shift.shiftTicks * 1440) / dayTicks;
    const path = this.source.careerPathLabels()[report.path];
    const where = path === undefined ? '' : `, ${path} path`;
    return { name: this.source.simName(entity), subtitle: `${title}${where}, level ${report.level + 1} of ${report.levels}` };
  }

  private afterClose(): void {
    this.pause.resume(PAUSE_OWNER);
    this.chosen = null;
    this.hover = null;
    this.pointerDown = false;
    const opener = this.opener;
    this.opener = null;
    for (const target of [opener, ...this.fallbackFocus()]) {
      if (!usable(target)) continue;
      // A heading takes focus only once it is made focusable.
      if (target !== opener && target.getAttribute('tabindex') === null) target.setAttribute('tabindex', '-1');
      target.focus();
      return;
    }
  }

  private isPhone(): boolean {
    return this.doc.defaultView?.matchMedia?.(CAREER_PHONE_QUERY).matches ?? false;
  }

  private onResize(): void {
    if (!this.element.open) return;
    const phone = this.isPhone();
    if (phone === this.builtPhone && Math.abs((this.charts.clientWidth || DEFAULT_WIDTH) - this.builtWidth) < 2) return;
    if (phone !== this.builtPhone) this.details.open = !phone;
    this.rebuild();
  }

  // ---- filters ----------------------------------------------------------

  private check(id: FilterId, label: HTMLElement[] | string, swatch = false): HTMLLabelElement {
    const row = html(this.doc, 'label', 'career-check');
    const box = html(this.doc, 'input');
    box.type = 'checkbox';
    box.setAttribute('data-filter', id);
    box.checked = this.filters[id];
    box.addEventListener('change', () => { this.filters[id] = box.checked; this.rebuild(); });
    this.boxes.set(id, box);
    const words = html(this.doc, 'span', 'career-check-text');
    if (typeof label === 'string') words.textContent = label;
    else words.append(...label);
    row.append(box);
    if (swatch) row.append(html(this.doc, 'span', `career-swatch career-swatch-${id}`));
    row.append(words);
    return row;
  }

  private buildFilters(): HTMLElement {
    const doc = this.doc;
    const body = html(doc, 'div', 'career-win-filter-body');
    const inputs = html(doc, 'fieldset');
    const legend = html(doc, 'legend');
    legend.textContent = 'Score inputs';
    inputs.append(legend);
    for (const id of SCORE_INPUTS) inputs.append(this.check(id, SERIES.find(series => series.id === id)!.name, true));
    // Pay is not a score input, so it sits below them under its own label (owner's ruling of 2026-11-20).
    const also = html(doc, 'fieldset', 'career-win-also');
    also.append(this.check('pay', [text(doc, 'career-muted', 'Also show: '), text(doc, 'career-pay-name', 'Pay per shift')], true));
    const graph = html(doc, 'fieldset');
    const graphLegend = html(doc, 'legend');
    graphLegend.textContent = 'On the score graph';
    graph.append(graphLegend, this.check('bands', 'Good and poor lines'), this.check('events', 'Promotions and other events'));
    body.append(inputs, also, graph);
    return body;
  }

  private buildKey(className: string): HTMLElement {
    const doc = this.doc;
    const key = html(doc, 'div', className);
    const title = html(doc, 'div', 'career-win-key-title');
    title.textContent = 'Key';
    const item = (extra: string, icon: SVGElement, ...words: HTMLElement[]): HTMLElement => {
      const row = html(doc, 'div', `career-key-item ${extra}`);
      const label = html(doc, 'span', 'career-key-words');
      label.append(...words);
      row.append(icon, label);
      return row;
    };
    const dashed = (y: number, color: string) => svgNode(doc, 'line', { x1: 0, x2: 28, y1: y, y2: y, class: `career-key-dash career-key-dash-${color}` });
    const bandsIcon = svgNode(doc, 'svg', { width: 28, height: 14, 'aria-hidden': 'true' });
    bandsIcon.append(dashed(3, 'good'), dashed(11, 'poor'));
    const dots = svgNode(doc, 'svg', { width: 28, height: 12, 'aria-hidden': 'true' });
    dots.append(svgNode(doc, 'circle', { cx: 5, cy: 6, r: 4, class: 'career-point-good' }),
      svgNode(doc, 'circle', { cx: 14, cy: 6, r: 4, class: 'career-point-steady' }),
      svgNode(doc, 'circle', { cx: 23, cy: 6, r: 4, class: 'career-point-poor' }));
    const arrows = svgNode(doc, 'svg', { width: 28, height: 14, 'aria-hidden': 'true' });
    arrows.append(svgNode(doc, 'polygon', { points: '7,1 2,10 12,10', class: 'career-mark-up' }),
      svgNode(doc, 'polygon', { points: '21,13 16,4 26,4', class: 'career-mark-down' }));
    const others = svgNode(doc, 'svg', { width: 28, height: 14, 'aria-hidden': 'true' });
    const dollar = svgNode(doc, 'text', { x: 3, y: 12, class: 'career-mark-raise' });
    dollar.textContent = '$';
    others.append(dollar, svgNode(doc, 'rect', { x: 16, y: 3, width: 7, height: 7, transform: 'rotate(45 19.5 6.5)', class: 'career-mark-change' }));
    const bands = item('career-key-bands', bandsIcon, text(doc, 'career-key-good', ''), text(doc, 'career-key-poor', ''));
    key.append(title, bands,
      item('', dots, text(doc, '', 'One weekly review '), text(doc, 'career-muted', 'Green: good. White: steady. Red: poor.')),
      item('career-key-events', arrows, text(doc, '', 'Promoted, demoted')),
      item('career-key-events', others, text(doc, '', 'Got a raise, changed path')));
    this.keys.push(key);
    return key;
  }

  private updateKeys(): void {
    const goodText = careerThresholdText(this.thresholds.good);
    const poorText = careerThresholdText(this.thresholds.poor);
    for (const key of this.keys) {
      for (const node of key.querySelectorAll<HTMLElement>('.career-key-bands')) {
        node.hidden = !this.filters.bands;
        const good = node.querySelector('.career-key-good');
        const poor = node.querySelector('.career-key-poor');
        if (good) good.textContent = `Good, ${goodText}`;
        if (poor) poor.textContent = `Poor, ${poorText}`;
      }
      for (const node of key.querySelectorAll<HTMLElement>('.career-key-events')) node.hidden = !this.filters.events;
    }
  }

  // ---- weeks shown and chosen -------------------------------------------

  private shownStart(): number {
    const preset = this.range === 'recent' ? CAREER_RECENT_WEEKS : this.range === 'longer' ? CAREER_LONGER_WEEKS : this.rows.length;
    return this.rows.length - Math.min(this.rows.length, preset);
  }

  private shown(): Row[] {
    return this.rows.slice(this.shownStart());
  }

  private setRange(range: Range): void {
    if (range === this.range) return;
    this.range = range;
    this.hover = null;
    if (this.chosen !== null && this.chosen < this.shownStart()) this.chosen = null;
    this.rebuild();
  }

  private valid(index: number | null): number | null {
    return index !== null && index >= this.shownStart() && index < this.rows.length ? index : null;
  }

  /** Picks a week, or none, and keeps it: no pointer move or leave undoes it. */
  private choose(index: number | null, by: 'keyboard' | 'pointer' = 'pointer'): void {
    const valid = this.valid(index);
    const hadHover = this.hover !== null;
    this.hover = null;
    this.chosenBy = by;
    if (valid === this.chosen) {
      if (hadHover) this.paint();
      return;
    }
    this.chosen = valid;
    this.paint();
    if (valid !== null) this.reveal(valid);
  }

  /** Previews the week under a mouse, or clears the preview; a phone has no preview, and the chosen week is never touched. */
  private preview(index: number | null): void {
    if (this.layout === PHONE) return;
    const valid = this.valid(index);
    if (valid === this.hover) return;
    this.hover = valid;
    this.paint();
  }

  /** The week the charts and tooltip show: the preview over the chosen week. */
  private shownWeek(): number | null {
    return this.hover ?? this.chosen;
  }

  private step(direction: -1 | 1): void {
    if (this.chosen === null) return;
    this.choose(this.chosen + direction, this.chosenBy);
  }

  /** The shown week under `clientX` on a chart, or null beyond its columns. */
  private weekAt(svg: SVGSVGElement, clientX: number | undefined): number | null {
    if (clientX === undefined || this.column <= 0) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const shown = this.rows.length - this.shownStart();
    const k = Math.floor((clientX - rect.left) / this.column);
    return k >= 0 && k < shown ? this.shownStart() + k : null;
  }

  private onKey(event: KeyboardEvent): void {
    const first = this.shownStart();
    const last = this.rows.length - 1;
    const at = this.chosen;
    let next: number;
    switch (event.key) {
      case 'ArrowLeft': next = at === null ? last : Math.max(first, at - 1); break;
      case 'ArrowRight': next = at === null ? last : Math.min(last, at + 1); break;
      case 'Home': next = first; break;
      case 'End': next = last; break;
      default: return;
    }
    event.preventDefault();
    this.choose(next, 'keyboard');
  }

  /** Scrolls every chart so the week's column is in view, when the plot scrolls. */
  private reveal(index: number): void {
    const scroller = this.handles[0]?.scroller;
    if (!scroller || !scroller.clientWidth) return;
    const left = (index - this.shownStart()) * this.column;
    if (left < scroller.scrollLeft || left + this.column > scroller.scrollLeft + scroller.clientWidth) {
      const target = Math.max(0, left + this.column / 2 - scroller.clientWidth / 2);
      for (const handle of this.handles) handle.scroller.scrollLeft = target;
      this.placeLevels();
    }
  }

  // ---- drawing ----------------------------------------------------------

  /** Builds the charts for the filters, weeks and width now, then paints them. */
  private rebuild(): void {
    const scoreScroller = this.handles.find(handle => handle.id === 'score')?.scroller;
    const keepFocus = scoreScroller !== undefined && this.doc.activeElement === scoreScroller;
    this.rebuilding = true;
    try {
      this.draw();
      // The keyboard stays on the graph that replaces the one it was on.
      if (keepFocus) this.handles.find(handle => handle.id === 'score')?.scroller.focus();
    } finally {
      this.rebuilding = false;
    }
  }

  private draw(): void {
    const doc = this.doc;
    const phone = this.isPhone();
    this.layout = phone ? PHONE : DESKTOP;
    this.builtPhone = phone;
    const width = this.charts.clientWidth || DEFAULT_WIDTH;
    this.builtWidth = width;
    const shown = this.shown();
    const count = Math.max(1, shown.length);
    this.column = Math.max(this.layout.minColumn, (width - this.layout.axis) / count);
    this.handles = [];
    this.charts.replaceChildren();
    const plotWidth = this.column * shown.length;
    this.charts.append(this.makeChart('score', 'Review score', null, this.layout.score.height, plotWidth));
    const wanted = SERIES.filter(series => SCORE_INPUTS.includes(series.id) && this.filters[series.id]);
    if (wanted.length > 0) {
      const heading = html(doc, 'h3', 'career-win-rows-heading');
      heading.textContent = 'Score inputs';
      this.charts.append(heading);
    }
    for (const series of wanted) this.charts.append(this.makeChart(series.id, series.name, series, this.layout.row.height, plotWidth));
    if (this.filters.pay) this.charts.append(this.makeChart('pay', 'Pay per shift', SERIES.find(series => series.id === 'pay')!, this.layout.row.height, plotWidth));
    this.updateKeys();
    const on = [...SCORE_INPUTS, 'pay' as const].filter(id => this.filters[id]).length;
    this.filterCount.textContent = `${on} of 7 lines shown`;
    for (const [id, button] of this.rangeButtons) button.setAttribute('aria-pressed', String(id === this.range));
    this.paint();
    const scroller = this.handles[0]?.scroller;
    if (scroller) {
      // The newest weeks first: the plot opens at its right end when it scrolls.
      const end = Math.max(0, plotWidth - (scroller.clientWidth || plotWidth));
      for (const handle of this.handles) handle.scroller.scrollLeft = end;
      this.placeLevels();
    }
  }

  private makeChart(id: string, name: string, series: Series | null, height: number, plotWidth: number): HTMLElement {
    const doc = this.doc;
    const block = html(doc, 'div', 'career-chart');
    block.setAttribute('data-chart', id);
    const label = html(doc, 'div', 'career-chart-label');
    const title = text(doc, `career-chart-name career-chart-name-${id}`, name);
    const value = html(doc, 'span', 'career-chart-value');
    label.append(title, value);
    const line = html(doc, 'div', 'career-plotline');
    const axis = svgNode(doc, 'svg', { class: 'career-axis-svg', width: this.layout.axis, height, 'aria-hidden': 'true' });
    const scroller = html(doc, 'div', id === 'score' ? 'career-scroll career-win-score-scroll' : 'career-scroll');
    const svg = svgNode(doc, 'svg', { class: 'career-chart-svg', width: c(plotWidth), height });
    if (id === 'score') {
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', 'Review score by week');
      scroller.setAttribute('role', 'group');
      scroller.setAttribute('aria-label', 'Reviewed weeks');
      scroller.setAttribute('tabindex', '0');
      scroller.addEventListener('keydown', event => this.onKey(event));
      scroller.addEventListener('pointerdown', () => { this.pointerDown = true; });
      scroller.addEventListener('focus', () => {
        // Keyboard focus starts at the newest week; a pointer chooses its own.
        if (!this.rebuilding && !this.pointerDown && this.chosen === null) this.choose(this.rows.length - 1, 'keyboard');
      });
      scroller.addEventListener('blur', event => {
        if (this.rebuilding || !scroller.isConnected) return;
        this.pointerDown = false;
        const to = (event as FocusEvent).relatedTarget as Node | null;
        if (to && this.tip.contains(to)) return;
        this.hover = null;
        if (this.chosenBy === 'keyboard') this.choose(null);
        else this.paint();
      });
    } else {
      svg.setAttribute('aria-hidden', 'true');
    }
    // A move or a leave only shows or clears a hover preview. Choosing a week changes the layout under
    // the pointer, which can make the browser send a leave; that must not undo the choice.
    svg.addEventListener('pointermove', event => {
      if (event.pointerType === 'touch') return;
      this.preview(this.weekAt(svg, event.clientX));
    });
    svg.addEventListener('pointerleave', event => { if (event.pointerType !== 'touch') this.preview(null); });
    svg.addEventListener('click', event => {
      this.pointerDown = false;
      const index = this.weekAt(svg, event.clientX);
      if (index === null) return;
      // Choosing the chosen week again closes its details.
      this.choose(index === this.chosen ? null : index);
    });
    scroller.addEventListener('scroll', () => {
      for (const other of this.handles) if (other.scroller !== scroller && other.scroller.scrollLeft !== scroller.scrollLeft) other.scroller.scrollLeft = scroller.scrollLeft;
      this.placeLevels();
      this.positionTip();
    });
    scroller.append(svg);
    line.append(axis, scroller);
    block.append(label, line);
    this.handles.push({ id, svg, axis, scroller, value, series });
    return block;
  }

  /** Redraws every chart, the summary and the tooltip for the weeks, filters and chosen week. */
  private paint(): void {
    const shown = this.shown();
    const start = this.shownStart();
    const at = this.shownWeek();
    const sel = at === null ? -1 : at - start;
    const good = shown.filter(row => careerWeekKind(row.week.performance, this.thresholds) === 'good').length;
    const poor = shown.filter(row => careerWeekKind(row.week.performance, this.thresholds) === 'poor').length;
    const average = shown.length === 0 ? 0 : Math.round(shown.reduce((sum, row) => sum + row.week.performance, 0) / shown.length);
    const doc = this.doc;
    const parts: HTMLElement[] = [];
    const piece = (words: string) => parts.push(text(doc, '', words));
    const strong = (value: number) => { const node = html(doc, 'b'); node.textContent = String(value); parts.push(node); };
    piece(`${shown.length} ${plural(shown.length, 'reviewed week', 'reviewed weeks')}. Average `);
    strong(average);
    piece('. Good weeks ');
    strong(good);
    piece(', poor weeks ');
    strong(poor);
    piece('.');
    this.summary.replaceChildren(...parts);
    this.hint.hidden = this.chosen !== null;
    const column = this.column;
    for (const handle of this.handles) {
      if (handle.id === 'score') this.paintScore(handle, shown, sel, column);
      else if (handle.series) this.paintRow(handle, handle.series, shown, sel, column);
    }
    this.paintTip(shown, sel);
  }

  private paintScore(handle: Chart, shown: readonly Row[], sel: number, column: number): void {
    const doc = this.doc;
    const { height, top, bottom } = this.layout.score;
    const width = column * shown.length;
    const y = (value: number) => top + (height - top - bottom) * (1 - Math.min(100, Math.max(0, value)) / 100);
    const x = (k: number) => column * k + column / 2;
    const svg = handle.svg;
    svg.replaceChildren();
    const { good, poor } = this.thresholds;
    if (this.filters.bands) {
      svg.append(svgNode(doc, 'rect', { x: 0, y: c(y(100)), width: c(width), height: c(y(good) - y(100)), class: 'career-band career-band-good' }),
        svgNode(doc, 'rect', { x: 0, y: c(y(poor)), width: c(width), height: c(y(0) - y(poor)), class: 'career-band career-band-poor' }));
    }
    for (const value of [0, 20, 40, 60, 80, 100]) svg.append(svgNode(doc, 'line', { x1: 0, x2: c(width), y1: c(y(value)), y2: c(y(value)), class: 'career-grid' }));
    if (this.filters.bands) {
      for (const [kind, value, label, dy] of [['good', good, `Good, ${careerThresholdText(good)}`, -5], ['poor', poor, `Poor, ${careerThresholdText(poor)}`, 15]] as const) {
        const rule = svgNode(doc, 'line', { x1: 0, x2: c(width), y1: c(y(value)), y2: c(y(value)), class: `career-win-rule career-win-rule-${kind}`, 'data-kind': kind });
        svg.append(rule);
        // A phone names the lines in the key instead, so no label sits among the points.
        if (this.layout !== DESKTOP) continue;
        const words = svgNode(doc, 'text', { x: 6, y: c(y(value) + dy), class: `career-win-rule-label career-win-rule-label-${kind}` });
        words.textContent = label;
        svg.append(words);
      }
    }
    if (this.filters.events) this.paintLevels(svg, shown, column, top - 12, height - bottom);
    if (sel >= 0) svg.append(svgNode(doc, 'line', { x1: c(x(sel)), x2: c(x(sel)), y1: c(top - 14), y2: c(height - bottom), class: 'career-win-guide' }));
    svg.append(svgNode(doc, 'polyline', { points: shown.map((row, k) => `${c(x(k))},${c(y(row.week.performance))}`).join(' '), class: 'career-line', fill: 'none' }));
    const dot = this.layout.dot;
    for (const [k, row] of shown.entries()) {
      const cx = x(k);
      const cy = y(row.week.performance);
      if (k === sel) svg.append(svgNode(doc, 'circle', { cx: c(cx), cy: c(cy), r: dot + 4, class: 'career-win-ring' }));
      svg.append(svgNode(doc, 'circle', { cx: c(cx), cy: c(cy), r: dot, class: `career-win-point career-point-${careerWeekKind(row.week.performance, this.thresholds)}` }));
      if (this.filters.events) {
        const mark = this.mark(row.week, cx, cy);
        if (mark) svg.append(mark);
      }
    }
    // A week number under every column, every second or fifth when they crowd.
    const every = column >= 24 ? 1 : column >= 12 ? 2 : 5;
    for (const [k, row] of shown.entries()) {
      const number = row.week.week + 1;
      if (k !== sel && number % every !== 0 && every !== 1) continue;
      const label = svgNode(doc, 'text', { x: c(x(k)), y: height - 10, class: k === sel ? 'career-week-number career-week-selected' : 'career-week-number', 'text-anchor': 'middle' });
      label.textContent = String(number);
      svg.append(label);
    }
    this.paintAxis(handle, [0, 20, 40, 60, 80, 100].map(value => [y(value) + 4, String(value)] as const), height, true);
    handle.value.textContent = shown.length === 0 ? '' : `Week ${shown[sel >= 0 ? sel : shown.length - 1].week.week + 1}: ${Math.round(shown[sel >= 0 ? sel : shown.length - 1].week.performance)} of 100`;
  }

  /** Labels each run of weeks at one title, with a dotted rule where the level changes. */
  private paintLevels(svg: SVGSVGElement, shown: readonly Row[], column: number, labelY: number, bottom: number): void {
    const doc = this.doc;
    let k = 0;
    while (k < shown.length) {
      const title = shown[k].title;
      let end = k;
      while (end + 1 < shown.length && shown[end + 1].title === title) end += 1;
      if (title !== null) {
        const from = column * k;
        const to = column * (end + 1);
        const label = svgNode(doc, 'text', { x: c((from + to) / 2), y: c(labelY), class: 'career-level', 'text-anchor': 'middle', 'data-from': c(from), 'data-to': c(to) });
        label.textContent = title;
        svg.append(label);
        const before = shown[k - 1]?.title ?? null;
        if (k > 0 && before !== null) svg.append(svgNode(doc, 'line', { x1: c(from), x2: c(from), y1: c(labelY - 8), y2: c(bottom), class: 'career-level-rule' }));
      }
      k = end + 1;
    }
  }

  /** Keeps each level label over the part of its run that is in view, hiding it when too little shows. */
  private placeLevels(): void {
    const scroller = this.handles[0]?.scroller;
    if (!scroller || !scroller.clientWidth) return;
    const left = scroller.scrollLeft;
    const right = left + scroller.clientWidth;
    for (const label of this.handles[0].svg.querySelectorAll('.career-level')) {
      const from = Math.max(Number(label.getAttribute('data-from')), left);
      const to = Math.min(Number(label.getAttribute('data-to')), right);
      const need = ((label as unknown as SVGTextContentElement).getComputedTextLength?.() ?? 0) + 12;
      label.setAttribute('x', c((from + to) / 2));
      label.setAttribute('display', to - from < need ? 'none' : 'inline');
    }
  }

  private mark(week: CareerGraphWeek, cx: number, cy: number): SVGElement | null {
    const doc = this.doc;
    let shape: SVGElement;
    switch (week.event) {
      case CAREER_EVENT_PROMOTION:
        shape = svgNode(doc, 'polygon', { points: `${c(cx)},${c(cy - 24)} ${c(cx - 7)},${c(cy - 13)} ${c(cx + 7)},${c(cy - 13)}`, class: 'career-mark career-mark-up' });
        break;
      case CAREER_EVENT_DEMOTION:
        shape = svgNode(doc, 'polygon', { points: `${c(cx)},${c(cy + 24)} ${c(cx - 7)},${c(cy + 13)} ${c(cx + 7)},${c(cy + 13)}`, class: 'career-mark career-mark-down' });
        break;
      case CAREER_EVENT_RAISE:
        shape = svgNode(doc, 'text', { x: c(cx), y: c(cy - 13), class: 'career-mark career-mark-raise', 'text-anchor': 'middle' });
        shape.textContent = '$';
        break;
      case CAREER_EVENT_CHANGED_PATH:
        shape = svgNode(doc, 'rect', { x: c(cx - 5), y: c(cy - 5), width: 10, height: 10, transform: `rotate(45 ${c(cx)} ${c(cy)})`, class: 'career-mark career-mark-change' });
        break;
      default:
        return null;
    }
    shape.dataset.event = String(week.event);
    shape.setAttribute('aria-hidden', 'true');
    return shape;
  }

  private paintAxis(handle: Chart, ticks: readonly (readonly [number, string])[], height: number, score: boolean): void {
    const doc = this.doc;
    const axis = handle.axis;
    axis.replaceChildren();
    for (const [y, label] of ticks) {
      const node = svgNode(doc, 'text', { x: this.layout.axis - 6, y: c(y), class: 'career-tick', 'text-anchor': 'end' });
      node.textContent = label;
      axis.append(node);
    }
    if (score) {
      const week = svgNode(doc, 'text', { x: this.layout.axis - 6, y: height - 10, class: 'career-tick', 'text-anchor': 'end' });
      week.textContent = 'Week';
      axis.append(week);
      if (this.layout === DESKTOP) {
        const mid = this.layout.score.top + (height - this.layout.score.top - this.layout.score.bottom) / 2;
        const rotated = svgNode(doc, 'text', { x: 12, y: c(mid), class: 'career-tick', 'text-anchor': 'middle', transform: `rotate(-90 12 ${c(mid)})` });
        rotated.textContent = 'Review score';
        axis.append(rotated);
      }
    }
  }

  private paintRow(handle: Chart, series: Series, shown: readonly Row[], sel: number, column: number): void {
    const doc = this.doc;
    const { height: h, top: t, bottom: b } = this.layout.row;
    const width = column * shown.length;
    const recorded = shown.map(row => row.inputs).filter((row): row is CareerInputWeek => row !== null);
    const scale = series.scale(recorded, this.shiftMinutes);
    const span = scale.max - scale.min || 1;
    const ry = (value: number) => t + (h - t - b) * (1 - (value - scale.min) / span);
    const x = (k: number) => column * k + column / 2;
    const svg = handle.svg;
    svg.replaceChildren();
    svg.append(svgNode(doc, 'rect', { x: 0, y: t, width: c(width), height: h - t - b, class: 'career-row-bg' }));
    if (series.zero) svg.append(svgNode(doc, 'line', { x1: 0, x2: c(width), y1: c(ry(0)), y2: c(ry(0)), class: 'career-zero' }));
    if (series.id === 'social') {
      const points = shown.flatMap((row, k) => (row.inputs === null ? [] : [`${c(x(k))},${c(ry(row.inputs.socialDemand))}`]));
      if (points.length > 0) svg.append(svgNode(doc, 'polyline', { points: points.join(' '), class: 'career-demand', fill: 'none' }));
    }
    if (sel >= 0) svg.append(svgNode(doc, 'line', { x1: c(x(sel)), x2: c(x(sel)), y1: t, y2: h - b, class: 'career-win-guide' }));
    const color = `career-line career-line-${series.id}`;
    if (series.bars) {
      const barWidth = Math.min(18, column * 0.6);
      for (const [k, row] of shown.entries()) {
        const value = row.inputs === null ? 0 : series.pick(row.inputs);
        if (value > 0) svg.append(svgNode(doc, 'rect', { x: c(x(k) - barWidth / 2), y: c(ry(value)), width: c(barWidth), height: c(ry(0) - ry(value)), class: 'career-bar' }));
      }
    } else {
      // Weeks with no recorded inputs leave a gap: no mark is drawn for them.
      let run: string[] = [];
      const flush = () => {
        if (run.length >= 2) svg.append(svgNode(doc, 'polyline', { points: run.join(' '), class: color, fill: 'none' }));
        else if (run.length === 1) { const [cx, cy] = run[0].split(','); svg.append(svgNode(doc, 'circle', { cx, cy, r: 2.5, class: `career-dot career-dot-${series.id}` })); }
        run = [];
      };
      for (const [k, row] of shown.entries()) {
        if (row.inputs === null) flush();
        else run.push(`${c(x(k))},${c(ry(series.pick(row.inputs)))}`);
      }
      flush();
      const picked = sel >= 0 ? shown[sel].inputs : null;
      if (picked !== null) svg.append(svgNode(doc, 'circle', { cx: c(x(sel)), cy: c(ry(series.pick(picked))), r: 4, class: `career-dot career-dot-selected career-dot-${series.id}` }));
    }
    this.paintAxis(handle, [[t + 9, scale.top], [h - b, scale.bottom]], h, false);
    const showing = shown[sel >= 0 ? sel : shown.length - 1];
    handle.value.textContent = showing === undefined ? '' : `Week ${showing.week.week + 1}: ${showing.inputs === null ? 'not recorded' : series.text(showing.inputs)}`;
  }

  private paintTip(shown: readonly Row[], sel: number): void {
    const row = sel >= 0 ? shown[sel] : null;
    this.tip.hidden = row === null;
    if (row === null) {
      this.live.textContent = '';
      return;
    }
    const kind = careerWeekKind(row.week.performance, this.thresholds);
    const sentence = careerKindSentence(kind, this.thresholds);
    this.tipTitle.textContent = careerTipHeading(row.week);
    this.tipKind.textContent = sentence.label;
    this.tipKind.setAttribute('data-kind', kind);
    this.tipRest.textContent = sentence.rest;
    const event = careerEventSentence(row.week);
    this.tipEvent.textContent = event ?? '';
    this.tipEvent.hidden = event === null;
    const inputs = row.inputs;
    this.tipMissing.hidden = inputs !== null;
    this.tipFacts.hidden = inputs === null;
    this.tipFacts.replaceChildren();
    if (inputs !== null) {
      const missed = Math.round(inputs.missedMinutes);
      const pairs: readonly (readonly [string, string])[] = [
        ...(inputs.sources === undefined || row.title === null ? [] : [[mixedRoles(inputs) ? 'Jobs' : 'Job', row.title] as const]),
        ['Shifts worked', `${inputs.attended} of ${inputs.shifts}`],
        ['Missed work', `${missed} ${plural(missed, 'minute', 'minutes')}`],
        ['Skill mastery', percent(inputs.mastery)],
        ['Mood on shifts', signedTwoDecimals(inputs.mood)],
        ['Fit', signedTwoDecimals(inputs.fit)],
        // Every input whose row is switched on, as its row would say it.
        ...SCORE_INPUTS.filter(id => (id === 'trait' || id === 'social') && this.filters[id])
          .map(id => { const series = SERIES.find(candidate => candidate.id === id)!; return [series.name, series.text(inputs)] as const; }),
        ['Pay per shift', payText(inputs)],
      ];
      for (const [name, value] of pairs) {
        const term = html(this.doc, 'dt');
        term.textContent = name;
        const detail = html(this.doc, 'dd');
        detail.textContent = value;
        this.tipFacts.append(term, detail);
      }
    }
    this.previous.disabled = sel <= 0;
    this.next.disabled = sel >= shown.length - 1;
    this.live.textContent = careerTipText(row.week, this.thresholds);
    this.positionTip(sel);
  }

  /** Puts the floating tooltip beside the week's point, flipping near the right edge, never over the point; a phone docks it instead. */
  private positionTip(sel = this.shownWeek() === null ? -1 : this.shownWeek()! - this.shownStart()): void {
    if (sel < 0) return;
    const scroller = this.handles[0]?.scroller;
    const left = this.layout.axis + this.column * sel + this.column / 2 - (scroller?.scrollLeft ?? 0);
    this.tip.style.setProperty('--tip-x', `${c(left)}px`);
    const edge = this.tip.parentElement?.clientWidth || this.charts.clientWidth || DEFAULT_WIDTH;
    const beside = left + TIP_GAP + TIP_WIDTH <= edge ? left + TIP_GAP : left - TIP_GAP - TIP_WIDTH;
    this.tip.style.setProperty('--tip-left', `${c(Math.max(this.layout.axis, beside))}px`);
    // A week scored under half sits low on the plot, so the tooltip takes the top of it; a better week
    // takes the bottom. Either way the tooltip stays off the line and clear of the axis labels.
    const row = this.rows[this.shownStart() + sel];
    if (row === undefined || this.layout !== DESKTOP) return;
    const high = row.week.performance < 50;
    const { top, bottom, height } = this.layout.score;
    const svg = this.handles[0]?.svg;
    const parent = this.tip.parentElement;
    const offset = svg && parent ? svg.getBoundingClientRect().top - parent.getBoundingClientRect().top : 0;
    this.tip.setAttribute('data-place', high ? 'high' : 'low');
    this.tip.style.setProperty('--tip-top', `${c(offset + (high ? top + 8 : height - bottom - 8))}px`);
  }
}
