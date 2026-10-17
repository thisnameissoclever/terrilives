import type { CareerWeek } from '../bridge.js';

// The graph of reviewed weeks in the Career section - rule 18 of
// docs/specs/2026-10-17-careers.md. One SVG, rebuilt whenever the weeks
// change: a line of each week's performance, the two thresholds as dashed
// rules, and a marker at each event: a green upward arrow at a promotion,
// a red downward arrow at a demotion, a green money mark at a raise, and a
// gray diamond at a change of path. Each marker carries a title that shows
// on hover with the week and the event, since the shapes alone do not say;
// the graph is one picture to assistive technology, and the text lines
// above it carry the numbers. The plot keeps a margin above and below the
// 0 to 100 band so a marker at either extreme stays inside the drawing.

export const CAREER_EVENT_NONE = 0;
export const CAREER_EVENT_PROMOTION = 1;
export const CAREER_EVENT_RAISE = 2;
export const CAREER_EVENT_DEMOTION = 3;
export const CAREER_EVENT_FIRED = 4;
export const CAREER_EVENT_CHANGED_PATH = 5;

const SVG = 'http://www.w3.org/2000/svg';
const WIDTH = 300;
const HEIGHT = 110;
const LEFT = 26;
const RIGHT = 8;
const TOP = 14;
const BOTTOM = 26;

export interface CareerGraphThresholds {
  readonly poor: number;
  readonly good: number;
}

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

/** The key that decides whether the drawing must change. */
export function careerGraphKey(weeks: readonly CareerWeek[], thresholds: CareerGraphThresholds): string {
  return `${thresholds.poor}/${thresholds.good}:` + weeks.map(week => `${week.week},${week.performance},${week.event}`).join(';');
}

function x(index: number, count: number): number {
  const span = WIDTH - LEFT - RIGHT;
  return count <= 1 ? LEFT + span / 2 : LEFT + (span * index) / (count - 1);
}

function y(performance: number): number {
  const span = HEIGHT - TOP - BOTTOM;
  return TOP + span * (1 - Math.min(100, Math.max(0, performance)) / 100);
}

function element<K extends keyof SVGElementTagNameMap>(doc: Document, name: K, attributes: Record<string, string>): SVGElementTagNameMap[K] {
  const node = doc.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}

function marker(doc: Document, week: CareerWeek, cx: number, cy: number): SVGElement | null {
  const title = careerEventTitle(week.event);
  if (title === null) return null;
  let shape: SVGElement;
  switch (week.event) {
    case CAREER_EVENT_PROMOTION:
      shape = element(doc, 'polygon', { points: `${cx},${cy - 9} ${cx - 5},${cy - 1} ${cx + 5},${cy - 1}`, class: 'career-mark career-mark-up' });
      break;
    case CAREER_EVENT_DEMOTION:
      shape = element(doc, 'polygon', { points: `${cx},${cy + 9} ${cx - 5},${cy + 1} ${cx + 5},${cy + 1}`, class: 'career-mark career-mark-down' });
      break;
    case CAREER_EVENT_RAISE: {
      shape = element(doc, 'text', { x: String(cx), y: String(cy - 4), class: 'career-mark career-mark-raise', 'text-anchor': 'middle' });
      shape.textContent = '$';
      break;
    }
    default:
      shape = element(doc, 'rect', { x: String(cx - 4), y: String(cy - 4), width: '8', height: '8', transform: `rotate(45 ${cx} ${cy})`, class: 'career-mark career-mark-change' });
  }
  shape.dataset.event = String(week.event);
  const label = element(doc, 'title', {});
  label.textContent = `Week ${week.week + 1}: ${title}`;
  shape.append(label);
  return shape;
}

/**
 * Draws `weeks` into `svg`, replacing whatever it held. The weeks are the
 * reviewed weeks in week order; their performance is 0 to 100.
 */
export function renderCareerGraph(doc: Document, svg: SVGSVGElement, weeks: readonly CareerWeek[], thresholds: CareerGraphThresholds): void {
  svg.setAttribute('viewBox', `0 0 ${WIDTH} ${HEIGHT}`);
  svg.replaceChildren();
  const count = weeks.length;
  for (const [value, cls] of [[thresholds.good, 'career-rule-good'], [thresholds.poor, 'career-rule-poor']] as const) {
    const line = element(doc, 'line', { x1: String(LEFT), x2: String(WIDTH - RIGHT), y1: String(y(value)), y2: String(y(value)), class: `career-rule ${cls}` });
    svg.append(line);
    const label = element(doc, 'text', { x: String(LEFT - 3), y: String(y(value) + 3), class: 'career-axis', 'text-anchor': 'end' });
    label.textContent = String(Math.round(value));
    svg.append(label);
  }
  const axis = element(doc, 'line', { x1: String(LEFT), x2: String(LEFT), y1: String(TOP), y2: String(HEIGHT - BOTTOM), class: 'career-axis-line' });
  svg.append(axis);
  if (count > 0) {
    const points = weeks.map((week, index) => `${x(index, count).toFixed(1)},${y(week.performance).toFixed(1)}`).join(' ');
    svg.append(element(doc, 'polyline', { points, class: 'career-line', fill: 'none' }));
    for (const [index, week] of weeks.entries()) {
      const cx = x(index, count);
      const cy = y(week.performance);
      svg.append(element(doc, 'circle', { cx: cx.toFixed(1), cy: cy.toFixed(1), r: '2', class: 'career-point' }));
      const mark = marker(doc, week, cx, cy);
      if (mark) svg.append(mark);
    }
    const first = element(doc, 'text', { x: String(LEFT), y: String(HEIGHT - 4), class: 'career-axis' });
    first.textContent = `Week ${weeks[0].week + 1}`;
    svg.append(first);
    if (count > 1) {
      const last = element(doc, 'text', { x: String(WIDTH - RIGHT), y: String(HEIGHT - 4), class: 'career-axis', 'text-anchor': 'end' });
      last.textContent = `Week ${weeks[count - 1].week + 1}`;
      svg.append(last);
    }
  }
}
