import {
  CAREER_EVENT_CHANGED_PATH,
  CAREER_EVENT_DEMOTION,
  CAREER_EVENT_PROMOTION,
  CAREER_EVENT_RAISE,
  careerEventSentence,
  careerEventTitle,
  careerKindSentence,
  careerLegendItems,
  careerThresholdText,
  careerTipHeading,
  careerTipText,
  careerWeekKind,
  type CareerGraphThresholds,
  type CareerGraphWeek,
} from './career-graph-words.js';

// The graph of reviewed weeks in the Career section - rule 18 of
// docs/specs/2026-10-17-careers.md and [CT-web] of the Career tab spec. One
// SVG, rebuilt whenever the weeks change: a line of each week's score, a
// shaded band above the good threshold and below the poor one, the two
// thresholds as labelled dashed rules, points colored by kind, and a marker
// at each event: a green upward arrow at a promotion, a red downward arrow
// at a demotion, a green money mark at a raise, and a gray diamond at a
// change of path. A week is chosen by pointer, by a tap or by the keyboard;
// its ring, guide line and tooltip say what the week was, and a polite line
// repeats the tooltip for a screen reader. The plot keeps a margin above for
// the tooltip so it never covers the line.

export { CAREER_EVENT_CHANGED_PATH, CAREER_EVENT_DEMOTION, CAREER_EVENT_NONE, CAREER_EVENT_FIRED, CAREER_EVENT_PROMOTION,
  CAREER_EVENT_RAISE, careerEventTitle } from './career-graph-words.js';
export type { CareerGraphThresholds, CareerGraphWeek } from './career-graph-words.js';

const SVG = 'http://www.w3.org/2000/svg';
const WIDTH = 530;
const HEIGHT = 200;
const LEFT = 30;
const RIGHT = 10;
const TOP = 58;
const BOTTOM = 22;

/** The key that decides whether the drawing and its tooltip text must change. */
export function careerGraphKey(weeks: readonly CareerGraphWeek[], thresholds: CareerGraphThresholds): string {
  return `${thresholds.poor}/${thresholds.good}:`
    + weeks.map(week => `${week.week},${week.performance},${week.event},${week.after ?? ''}`).join(';');
}

function x(index: number, count: number): number {
  const span = WIDTH - LEFT - RIGHT;
  return count <= 1 ? LEFT + span / 2 : LEFT + (span * index) / (count - 1);
}

function y(performance: number): number {
  const span = HEIGHT - TOP - BOTTOM;
  return TOP + span * (1 - Math.min(100, Math.max(0, performance)) / 100);
}

/** A coordinate as an attribute: one decimal, with no trailing zero. */
function coordinate(value: number): string {
  return String(Number(value.toFixed(1)));
}

function element<K extends keyof SVGElementTagNameMap>(doc: Document, name: K, attributes: Record<string, string>): SVGElementTagNameMap[K] {
  const node = doc.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}

function marker(doc: Document, week: CareerGraphWeek, cx: number, cy: number): SVGElement | null {
  if (careerEventTitle(week.event) === null) return null;
  let shape: SVGElement;
  switch (week.event) {
    case CAREER_EVENT_PROMOTION:
      shape = element(doc, 'polygon', { points: `${coordinate(cx)},${coordinate(cy - 16)} ${coordinate(cx - 5)},${coordinate(cy - 8)} ${coordinate(cx + 5)},${coordinate(cy - 8)}`, class: 'career-mark career-mark-up' });
      break;
    case CAREER_EVENT_DEMOTION:
      shape = element(doc, 'polygon', { points: `${coordinate(cx)},${coordinate(cy + 16)} ${coordinate(cx - 5)},${coordinate(cy + 8)} ${coordinate(cx + 5)},${coordinate(cy + 8)}`, class: 'career-mark career-mark-down' });
      break;
    case CAREER_EVENT_RAISE: {
      shape = element(doc, 'text', { x: coordinate(cx), y: coordinate(cy - 8), class: 'career-mark career-mark-raise', 'text-anchor': 'middle' });
      shape.textContent = '$';
      break;
    }
    default:
      shape = element(doc, 'rect', { x: coordinate(cx - 4), y: coordinate(cy - 4), width: '8', height: '8', transform: `rotate(45 ${coordinate(cx)} ${coordinate(cy)})`, class: 'career-mark career-mark-change' });
  }
  shape.dataset.event = String(week.event);
  // The tooltip says what the marker means, so the shape stays out of the way of a reader.
  shape.setAttribute('aria-hidden', 'true');
  return shape;
}

/**
 * Draws `weeks` into `svg`, replacing whatever it held. The weeks are the
 * reviewed weeks in week order; their performance is 0 to 100. Returns the
 * ring and guide that mark a chosen week, hidden, for the caller to move.
 */
export function renderCareerGraph(
  doc: Document, svg: SVGSVGElement, weeks: readonly CareerGraphWeek[], thresholds: CareerGraphThresholds,
): { ring: SVGElement; guide: SVGElement } {
  svg.setAttribute('viewBox', `0 0 ${WIDTH} ${HEIGHT}`);
  svg.replaceChildren();
  const count = weeks.length;
  const plotWidth = WIDTH - LEFT - RIGHT;
  svg.append(
    element(doc, 'rect', { x: String(LEFT), y: coordinate(y(100)), width: String(plotWidth), height: coordinate(y(thresholds.good) - y(100)), class: 'career-band career-band-good' }),
    element(doc, 'rect', { x: String(LEFT), y: coordinate(y(thresholds.poor)), width: String(plotWidth), height: coordinate(y(0) - y(thresholds.poor)), class: 'career-band career-band-poor' }),
  );
  for (const [value, cls] of [[thresholds.good, 'good'], [thresholds.poor, 'poor']] as const) {
    svg.append(element(doc, 'line', { x1: String(LEFT), x2: String(WIDTH - RIGHT), y1: coordinate(y(value)), y2: coordinate(y(value)), class: `career-rule career-rule-${cls}` }));
    const label = element(doc, 'text', { x: String(LEFT - 4), y: coordinate(y(value) + 3), class: `career-axis career-axis-${cls}`, 'text-anchor': 'end' });
    label.textContent = careerThresholdText(value);
    svg.append(label);
  }
  for (const [value, text] of [[100, '100'], [0, '0']] as const) {
    const label = element(doc, 'text', { x: String(LEFT - 4), y: coordinate(y(value) + 3), class: 'career-axis', 'text-anchor': 'end' });
    label.textContent = text;
    svg.append(label);
  }
  svg.append(element(doc, 'line', { x1: String(LEFT), x2: String(LEFT), y1: String(TOP), y2: String(HEIGHT - BOTTOM), class: 'career-axis-line' }));
  if (count > 0) {
    const points = weeks.map((week, index) => `${coordinate(x(index, count))},${coordinate(y(week.performance))}`).join(' ');
    svg.append(element(doc, 'polyline', { points, class: 'career-line', fill: 'none' }));
    for (const [index, week] of weeks.entries()) {
      const cx = x(index, count);
      const cy = y(week.performance);
      const kind = careerWeekKind(week.performance, thresholds);
      svg.append(element(doc, 'circle', { cx: coordinate(cx), cy: coordinate(cy), r: '3.2', class: `career-point career-point-${kind}` }));
      const mark = marker(doc, week, cx, cy);
      if (mark) svg.append(mark);
    }
    const first = element(doc, 'text', { x: String(LEFT), y: String(HEIGHT - 6), class: 'career-axis' });
    first.textContent = `Week ${weeks[0].week + 1}`;
    svg.append(first);
    if (count > 1) {
      const last = element(doc, 'text', { x: String(WIDTH - RIGHT), y: String(HEIGHT - 6), class: 'career-axis', 'text-anchor': 'end' });
      last.textContent = `Week ${weeks[count - 1].week + 1}`;
      svg.append(last);
    }
  }
  const guide = element(doc, 'line', { class: 'career-guide', x1: '0', x2: '0', y1: '50', y2: String(HEIGHT - BOTTOM) });
  const ring = element(doc, 'circle', { class: 'career-ring', cx: '0', cy: '0', r: '7' });
  guide.setAttribute('hidden', '');
  ring.setAttribute('hidden', '');
  svg.append(guide, ring);
  return { ring, guide };
}

/** The graph with its tooltip, live line and legend, ready to place in the Career tab. */
export class CareerGraph {
  readonly element: HTMLElement;
  readonly svg: SVGSVGElement;
  private readonly tip: HTMLElement;
  private readonly tipTitle: HTMLElement;
  private readonly tipKind: HTMLElement;
  private readonly tipRest: HTMLElement;
  private readonly tipEvent: HTMLElement;
  private readonly live: HTMLElement;
  private readonly legend: HTMLElement;
  private ring: SVGElement | null = null;
  private guide: SVGElement | null = null;
  private weeks: readonly CareerGraphWeek[] = [];
  private thresholds: CareerGraphThresholds = { poor: 0, good: 100 };
  private key = '';
  private legendKey = '';
  private chosen: number | null = null;

  constructor(private readonly doc: Document) {
    this.element = doc.createElement('div');
    this.element.className = 'career-graph-wrap';
    this.svg = doc.createElementNS(SVG, 'svg');
    this.svg.setAttribute('class', 'career-graph');
    // The graph is one group a keyboard can enter; the tooltip is its text.
    this.svg.setAttribute('role', 'group');
    this.svg.setAttribute('aria-label', 'Reviewed weeks');
    this.svg.setAttribute('tabindex', '0');
    this.tip = doc.createElement('div');
    this.tip.className = 'career-tip';
    this.tip.setAttribute('aria-hidden', 'true');
    this.tip.hidden = true;
    this.tipTitle = doc.createElement('div');
    this.tipTitle.className = 'career-tip-title';
    const body = doc.createElement('div');
    body.className = 'career-tip-body';
    this.tipKind = doc.createElement('span');
    this.tipKind.className = 'career-tip-kind';
    this.tipRest = doc.createElement('span');
    this.tipRest.className = 'career-tip-rest';
    body.append(this.tipKind, this.tipRest);
    this.tipEvent = doc.createElement('div');
    this.tipEvent.className = 'career-tip-event';
    this.tip.append(this.tipTitle, body, this.tipEvent);
    this.live = doc.createElement('p');
    this.live.className = 'career-live';
    this.live.setAttribute('aria-live', 'polite');
    this.legend = doc.createElement('div');
    this.legend.className = 'career-legend';
    this.element.append(this.svg, this.tip, this.live, this.legend);
    this.svg.addEventListener('pointermove', event => this.choose(this.indexAt(event.clientX)));
    this.svg.addEventListener('pointerleave', event => {
      // A finger leaving ends the touch, not the reading.
      if (event.pointerType !== 'touch') this.choose(null);
    });
    this.svg.addEventListener('click', event => this.choose(this.indexAt(event.clientX)));
    this.svg.addEventListener('focus', () => { if (this.chosen === null) this.choose(this.weeks.length - 1); });
    this.svg.addEventListener('blur', () => this.choose(null));
    this.svg.addEventListener('keydown', event => this.onKey(event));
  }

  /** The chosen week's index, or null. */
  get selected(): number | null {
    return this.chosen;
  }

  /** Draws when the weeks, titles or thresholds changed; keeps the chosen week while it still exists. */
  update(weeks: readonly CareerGraphWeek[], thresholds: CareerGraphThresholds): void {
    this.weeks = weeks;
    this.thresholds = thresholds;
    const key = careerGraphKey(weeks, thresholds);
    if (key !== this.key) {
      const marks = renderCareerGraph(this.doc, this.svg, weeks, thresholds);
      this.ring = marks.ring;
      this.guide = marks.guide;
      this.key = key;
    }
    this.drawLegend();
    if (this.chosen !== null && this.chosen >= weeks.length) this.chosen = null;
    this.show();
  }

  /** Chooses a week by index, or none; out-of-range values choose none. */
  select(index: number | null): void {
    this.choose(index);
  }

  private indexAt(clientX: number | undefined): number | null {
    const count = this.weeks.length;
    if (clientX === undefined || count === 0) return null;
    const rect = this.svg.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const point = ((clientX - rect.left) / rect.width) * WIDTH;
    if (count === 1) return point >= LEFT && point <= WIDTH - RIGHT ? 0 : null;
    const column = (WIDTH - LEFT - RIGHT) / (count - 1);
    // Within half a column of a point, so the gaps between points choose the nearer week.
    if (point < LEFT - column / 2 || point > WIDTH - RIGHT + column / 2) return null;
    return Math.min(count - 1, Math.max(0, Math.round((point - LEFT) / column)));
  }

  private onKey(event: KeyboardEvent): void {
    const last = this.weeks.length - 1;
    if (event.key === 'Escape') {
      if (this.chosen !== null) {
        this.choose(null);
        event.stopPropagation();
      }
      return;
    }
    if (last < 0) return;
    const at = this.chosen;
    let next: number;
    switch (event.key) {
      case 'ArrowLeft': next = at === null ? last : Math.max(0, at - 1); break;
      case 'ArrowRight': next = at === null ? last : Math.min(last, at + 1); break;
      case 'Home': next = 0; break;
      case 'End': next = last; break;
      default: return;
    }
    event.preventDefault();
    this.choose(next);
  }

  private choose(index: number | null): void {
    const valid = index !== null && index >= 0 && index < this.weeks.length ? index : null;
    if (valid === this.chosen) return;
    this.chosen = valid;
    this.show();
  }

  private show(): void {
    const week = this.chosen === null ? null : this.weeks[this.chosen];
    this.tip.hidden = week === null;
    this.ring?.toggleAttribute('hidden', week === null);
    this.guide?.toggleAttribute('hidden', week === null);
    if (week === null || this.chosen === null) {
      this.live.textContent = '';
      return;
    }
    const count = this.weeks.length;
    const cx = x(this.chosen, count);
    this.ring?.setAttribute('cx', coordinate(cx));
    this.ring?.setAttribute('cy', coordinate(y(week.performance)));
    this.guide?.setAttribute('x1', coordinate(cx));
    this.guide?.setAttribute('x2', coordinate(cx));
    this.guide?.setAttribute('y1', '50');
    this.guide?.setAttribute('y2', String(HEIGHT - BOTTOM));
    this.tip.style.setProperty('--tip-x', `${((cx / WIDTH) * 100).toFixed(2)}%`);
    const kind = careerWeekKind(week.performance, this.thresholds);
    const sentence = careerKindSentence(kind, this.thresholds);
    this.tipTitle.textContent = careerTipHeading(week);
    this.tipKind.textContent = sentence.label;
    this.tipKind.dataset.kind = kind;
    this.tipRest.textContent = sentence.rest;
    const event = careerEventSentence(week);
    this.tipEvent.textContent = event ?? '';
    this.tipEvent.hidden = event === null;
    this.live.textContent = careerTipText(week, this.thresholds);
  }

  private drawLegend(): void {
    const items = careerLegendItems(this.weeks, this.thresholds);
    const key = this.weeks.length === 0 ? '' : items.map(item => `${item.kind}:${item.text}`).join('|');
    this.legend.hidden = this.weeks.length === 0;
    if (key === this.legendKey) return;
    this.legendKey = key;
    this.legend.replaceChildren(...items.map(item => {
      const entry = this.doc.createElement('span');
      entry.className = `career-legend-item career-legend-${item.kind}`;
      const icon = this.doc.createElement('span');
      icon.className = 'career-legend-icon';
      icon.setAttribute('aria-hidden', 'true');
      const text = this.doc.createElement('span');
      text.className = 'career-legend-text';
      text.textContent = item.text;
      entry.append(icon, text);
      return entry;
    }));
  }
}
