import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CareerInputWeek } from '../src/bridge.js';
import { CareerGraph, careerEventTitle, careerGraphKey, renderCareerGraph } from '../src/ui/career-graph.js';
import {
  careerEventSentence,
  careerKindSentence,
  careerLegendItems,
  careerTipText,
  careerWeekKind,
  withEventTitles,
  type CareerGraphWeek,
} from '../src/ui/career-graph-words.js';
import { FakeNode, fakeDocument } from './helpers/fake-dom.js';

const THRESHOLDS = { poor: 40, good: 65 };

const WEEKS: CareerGraphWeek[] = [
  { week: 0, performance: 52, event: 0 },
  { week: 1, performance: 82, event: 2 },
  { week: 2, performance: 90, event: 1, after: 'Senior clerk' },
  { week: 3, performance: 20, event: 3, after: 'Office clerk' },
  { week: 4, performance: 55, event: 5 },
  { week: 5, performance: 40, event: 0 },
];

describe('the words of the graph', () => {
  it('names every event and keys the drawing by its weeks, titles and thresholds', () => {
    expect([0, 1, 2, 3, 4, 5].map(careerEventTitle)).toEqual([null, 'Promoted', 'Got a raise', 'Demoted', 'Fired', 'Changed path']);
    expect(careerGraphKey(WEEKS, THRESHOLDS)).not.toBe(careerGraphKey(WEEKS.slice(1), THRESHOLDS));
    expect(careerGraphKey(WEEKS, THRESHOLDS)).not.toBe(careerGraphKey(WEEKS, { poor: 30, good: 65 }));
    const retitled = WEEKS.map(week => (week.after === 'Senior clerk' ? { ...week, after: 'Head clerk' } : week));
    expect(careerGraphKey(retitled, THRESHOLDS), 'a new title changes the tooltip text').not.toBe(careerGraphKey(WEEKS, THRESHOLDS));
  });

  it('calls a week good at the good threshold, poor under the poor threshold and steady between', () => {
    expect([65, 65.01, 64.99, 40, 39.99, 0, 100].map(value => careerWeekKind(value, THRESHOLDS)))
      .toEqual(['good', 'good', 'steady', 'steady', 'poor', 'poor', 'good']);
  });

  it('words each kind of week with the thresholds', () => {
    expect(careerKindSentence('good', THRESHOLDS)).toEqual({ label: 'Good week:', rest: '65 or more counts toward promotion.' });
    expect(careerKindSentence('steady', THRESHOLDS)).toEqual({ label: 'Steady week:', rest: 'between 40 and 65 counts toward neither.' });
    expect(careerKindSentence('poor', THRESHOLDS)).toEqual({ label: 'Poor week:', rest: 'under 40. Poor weeks in a row bring a warning.' });
    expect(careerKindSentence('good', { poor: 39.6, good: 64.5 }).rest, 'thresholds read as whole numbers').toBe('65 or more counts toward promotion.');
  });

  it('words each event with the title it led to when that is known', () => {
    expect(WEEKS.map(careerEventSentence)).toEqual([
      null, 'Got a raise.', 'Promoted to Senior clerk.', 'Demoted to Office clerk.', 'Changed path.', null]);
    expect(careerEventSentence({ week: 1, performance: 50, event: 1 }), 'no title known').toBe('Promoted.');
    expect(careerEventSentence({ week: 1, performance: 50, event: 5, after: 'Barista' })).toBe('Changed path to Barista.');
    expect(careerEventSentence({ week: 1, performance: 50, event: 4 })).toBe('Fired.');
  });

  it('reads one week as a sentence for the live region', () => {
    expect(careerTipText(WEEKS[2], THRESHOLDS)).toBe(
      'Week 3 review: 90 of 100. Good week: 65 or more counts toward promotion. Promoted to Senior clerk.');
    expect(careerTipText(WEEKS[0], THRESHOLDS)).toBe(
      'Week 1 review: 52 of 100. Steady week: between 40 and 65 counts toward neither.');
    expect(careerTipText({ week: 7, performance: 38.4, event: 0 }, THRESHOLDS)).toBe(
      'Week 8 review: 38 of 100. Poor week: under 40. Poor weeks in a row bring a warning.');
  });

  it('lists only the markers that the shown weeks hold', () => {
    const texts = (weeks: readonly CareerGraphWeek[]) => careerLegendItems(weeks, THRESHOLDS).map(item => item.text);
    expect(texts([WEEKS[0]])).toEqual(['Weekly review score', 'Good, 65', 'Poor, 40']);
    expect(texts(WEEKS)).toEqual(['Weekly review score', 'Good, 65', 'Poor, 40', 'Promoted', 'Demoted', 'Raise', 'Changed path']);
    expect(texts([WEEKS[1]])).toEqual(['Weekly review score', 'Good, 65', 'Poor, 40', 'Raise']);
    expect(careerLegendItems(WEEKS, THRESHOLDS).map(item => item.kind)).toEqual(
      ['line', 'good', 'poor', 'promotion', 'demotion', 'raise', 'change']);
  });
});

describe('the titles an event led to', () => {
  const input = (week: number, path: number, level: number): CareerInputWeek => ({
    week, career: 0, path, level, shifts: 5, attended: 5, fit: 0, traitFit: 0, socialCapacity: 0.5, socialDemand: 0.3,
    mastery: 0.5, mood: 0, missedMinutes: 0, pay: 160 });
  const titles = (path: number, level: number) => (path === 0 ? ['Office clerk', 'Senior clerk', 'Office manager'][level] ?? null : ['Barista'][level] ?? null);
  const event = (week: number, kind: number): CareerGraphWeek => ({ week, performance: 70, event: kind });

  it('takes the title the person held in the next reviewed week', () => {
    const weeks = [event(0, 1), event(1, 0)];
    const result = withEventTitles(weeks, [input(0, 0, 0), input(1, 0, 1)], titles, 'Senior clerk');
    expect(result[0].after).toBe('Senior clerk');
    expect(result[1].after, 'a week with no event gets no title').toBeUndefined();
  });

  it('takes the current job title after the last reviewed week', () => {
    const result = withEventTitles([event(0, 5)], [input(0, 0, 1)], titles, 'Barista');
    expect(result[0].after).toBe('Barista');
  });

  it('falls back to one level up or down when the next week has no inputs', () => {
    const up = withEventTitles([event(0, 1), event(1, 0)], [input(0, 0, 0)], titles, 'Senior clerk');
    expect(up[0].after).toBe('Senior clerk');
    const down = withEventTitles([event(0, 3), event(1, 0)], [input(0, 0, 2)], titles, 'Senior clerk');
    expect(down[0].after).toBe('Senior clerk');
  });

  it('leaves the title out when nothing says it', () => {
    const result = withEventTitles([event(0, 1), event(1, 0)], [], titles, 'Senior clerk');
    expect(result[0].after).toBeUndefined();
    expect(withEventTitles([event(0, 5), event(1, 0)], [input(0, 0, 1)], titles, null)[0].after, 'a path change names no title it cannot know').toBeUndefined();
  });

  it('never invents a title for a dismissal or a raise', () => {
    const result = withEventTitles([event(0, 4), event(1, 2)], [input(0, 0, 0), input(1, 0, 0)], titles, 'Office clerk');
    expect(result.map(week => week.after)).toEqual([undefined, undefined]);
  });
});

const W = 530;
const L = 30;
const R = 10;

function build(weeks: readonly CareerGraphWeek[] = WEEKS) {
  const { fake, doc } = fakeDocument();
  const graph = new CareerGraph(doc);
  const svg = graph.svg as unknown as FakeNode;
  svg.rect = { left: 100, top: 0, width: W, height: 200 };
  graph.update(weeks, THRESHOLDS);
  const element = graph.element as unknown as FakeNode;
  const x = (index: number, count = weeks.length) => 100 + L + ((W - L - R) * index) / (count - 1);
  const find = (selector: string) => element.querySelector(selector)!;
  return { fake, graph, svg, element, x, find };
}

describe('the drawn graph', () => {
  it('draws the bands, the labelled threshold rules, the axis labels and the line', () => {
    const { svg } = build();
    expect(svg.querySelectorAll('.career-band-good')).toHaveLength(1);
    expect(svg.querySelectorAll('.career-band-poor')).toHaveLength(1);
    expect(svg.querySelectorAll('.career-rule').map(rule => rule.classes()[1])).toEqual(['career-rule-good', 'career-rule-poor']);
    expect(svg.querySelectorAll('.career-axis').map(axis => axis.textContent)).toEqual(
      expect.arrayContaining(['100', '65', '40', '0', 'Week 1', 'Week 6']));
    expect(svg.querySelectorAll('polyline')).toHaveLength(1);
    expect(svg.getAttribute('viewBox')).toBe('0 0 530 162');
  });

  it('colors each point by its kind and marks each event once', () => {
    const { svg } = build();
    expect(svg.querySelectorAll('.career-point').map(point => point.classes().pop())).toEqual([
      'career-point-steady', 'career-point-good', 'career-point-good', 'career-point-poor', 'career-point-steady', 'career-point-steady']);
    expect(svg.querySelectorAll('.career-mark').map(mark => mark.dataset.event)).toEqual(['2', '1', '3', '5']);
    expect(svg.querySelector('.career-mark-up')).not.toBeNull();
    expect(svg.querySelector('.career-mark-down')).not.toBeNull();
    expect(svg.querySelector('.career-mark-raise')?.textContent).toBe('$');
    expect(svg.querySelector('title'), 'the tooltip replaces the native one').toBeNull();
  });

  it('draws only the rules for no weeks', () => {
    const { svg, graph } = build([]);
    graph.update([], THRESHOLDS);
    expect(svg.querySelectorAll('polyline')).toHaveLength(0);
    expect(svg.querySelectorAll('.career-rule')).toHaveLength(2);
    expect(svg.querySelectorAll('.career-point')).toHaveLength(0);
  });

  it('draws the graph into any svg', () => {
    const { doc } = fakeDocument();
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg') as unknown as SVGSVGElement;
    renderCareerGraph(doc, svg, WEEKS, THRESHOLDS);
    expect((svg as unknown as FakeNode).querySelectorAll('.career-point')).toHaveLength(6);
  });
});

describe('the graph as one focusable group', () => {
  it('is a labelled group in the tab order with a hidden polite line that repeats the tooltip', () => {
    const { svg, find } = build();
    expect(svg.getAttribute('role')).toBe('group');
    expect(svg.getAttribute('aria-label')).toBe('Reviewed weeks');
    expect(svg.tabIndex).toBe(0);
    const live = find('.career-live');
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.textContent).toBe('');
    expect(find('.career-tip').getAttribute('aria-hidden')).toBe('true');
    expect(find('.career-tip').hidden).toBe(true);
  });
});

describe('choosing a week by pointer', () => {
  it('shows the nearest week under the pointer, with a ring, a guide, the tooltip and the live text', () => {
    const { svg, graph, find, x } = build();
    svg.dispatch('pointermove', { clientX: x(2) + 3, pointerType: 'mouse' });
    expect(graph.selected).toBe(2);
    expect(find('.career-tip').hidden).toBe(false);
    expect(find('.career-tip-title').textContent).toBe('Week 3 review: 90 of 100');
    expect(find('.career-tip-kind').textContent).toBe('Good week:');
    expect(find('.career-tip-kind').dataset.kind).toBe('good');
    expect(find('.career-tip-rest').textContent).toBe('65 or more counts toward promotion.');
    expect(find('.career-tip-event').textContent).toBe('Promoted to Senior clerk.');
    expect(find('.career-live').textContent).toBe(
      'Week 3 review: 90 of 100. Good week: 65 or more counts toward promotion. Promoted to Senior clerk.');
    expect(find('.career-ring').hidden).toBe(false);
    expect(find('.career-ring').getAttribute('cx')).toBe(String(Number(find('.career-guide').getAttribute('x1'))));
    expect(find('.career-tip').style.getPropertyValue('--tip-x')).toMatch(/^\d+(\.\d+)?%$/);
  });

  it('chooses the week within half a column of its point and none beyond the ends', () => {
    const { svg, graph, x } = build();
    const column = (W - L - R) / (WEEKS.length - 1);
    svg.dispatch('pointermove', { clientX: x(3) + column * 0.49, pointerType: 'mouse' });
    expect(graph.selected).toBe(3);
    svg.dispatch('pointermove', { clientX: x(3) + column * 0.51, pointerType: 'mouse' });
    expect(graph.selected).toBe(4);
    svg.dispatch('pointermove', { clientX: x(0) - column * 0.6, pointerType: 'mouse' });
    expect(graph.selected, 'left of the first column').toBeNull();
    svg.dispatch('pointermove', { clientX: x(5) + column * 0.6, pointerType: 'mouse' });
    expect(graph.selected, 'right of the last column').toBeNull();
  });

  it('hides the tooltip when a mouse leaves and omits the event line for a week without one', () => {
    const { svg, graph, find, x } = build();
    svg.dispatch('pointermove', { clientX: x(0), pointerType: 'mouse' });
    expect(find('.career-tip-event').hidden).toBe(true);
    expect(find('.career-tip-kind').dataset.kind).toBe('steady');
    svg.dispatch('pointerleave', { pointerType: 'mouse' });
    expect(graph.selected).toBeNull();
    expect(find('.career-tip').hidden).toBe(true);
    expect(find('.career-ring').hidden).toBe(true);
    expect(find('.career-live').textContent, 'the live line is cleared').toBe('');
  });

  it('keeps a tapped week after the touch ends and replaces it with the next tap', () => {
    const { svg, graph, x } = build();
    svg.dispatch('pointerleave', { pointerType: 'touch' });
    svg.dispatch('click', { clientX: x(1), pointerType: 'touch' });
    expect(graph.selected).toBe(1);
    svg.dispatch('pointerleave', { pointerType: 'touch' });
    expect(graph.selected, 'a touch leaving is not a mouse leaving').toBe(1);
    svg.dispatch('click', { clientX: x(4), pointerType: 'touch' });
    expect(graph.selected).toBe(4);
  });

  it('shows the single week of a one-week history', () => {
    const { svg, graph } = build([WEEKS[0]]);
    svg.rect = { left: 0, top: 0, width: W, height: 200 };
    svg.dispatch('pointermove', { clientX: 280, pointerType: 'mouse' });
    expect(graph.selected).toBe(0);
  });
});

describe('choosing a week by keyboard', () => {
  it('starts at the latest week on focus and moves with Left, Right, Home and End', () => {
    const { svg, graph, find } = build();
    svg.focus();
    expect(graph.selected).toBe(5);
    const press = (key: string) => svg.dispatch('keydown', { key });
    expect(press('ArrowLeft').defaultPrevented).toBe(true);
    expect(graph.selected).toBe(4);
    press('ArrowLeft'); press('ArrowLeft');
    expect(graph.selected).toBe(2);
    press('ArrowRight');
    expect(graph.selected).toBe(3);
    press('Home');
    expect(graph.selected).toBe(0);
    press('ArrowLeft');
    expect(graph.selected, 'stops at the first week').toBe(0);
    press('End');
    expect(graph.selected).toBe(5);
    press('ArrowRight');
    expect(graph.selected, 'stops at the last week').toBe(5);
    expect(find('.career-live').textContent).toContain('Week 6 review: 40 of 100.');
    expect(svg.dispatch('keydown', { key: 'a' }).defaultPrevented, 'other keys are left alone').toBe(false);
  });

  it('hides the tooltip on Escape without letting the sheet close, and on blur', () => {
    const { svg, graph, find, fake } = build();
    svg.focus();
    const escape = svg.dispatch('keydown', { key: 'Escape' });
    expect(graph.selected).toBeNull();
    expect(find('.career-tip').hidden).toBe(true);
    expect(escape.propagationStopped, 'Escape that dismissed the tooltip stops here').toBe(true);
    expect(svg.dispatch('keydown', { key: 'Escape' }).propagationStopped, 'with nothing shown it passes on').toBe(false);
    svg.dispatch('keydown', { key: 'Home' });
    expect(graph.selected).toBe(0);
    fake.body.append();
    svg.blur();
    expect(graph.selected).toBeNull();
  });

  it('does nothing for a graph without weeks', () => {
    const { svg, graph } = build([]);
    svg.focus();
    svg.dispatch('keydown', { key: 'End' });
    expect(graph.selected).toBeNull();
  });
});

describe('updating a drawn graph', () => {
  it('keeps the chosen week while the weeks stay the same and clears it when they shrink', () => {
    const { svg, graph, find, x } = build();
    svg.dispatch('pointermove', { clientX: x(2), pointerType: 'mouse' });
    graph.update(WEEKS, THRESHOLDS);
    expect(graph.selected).toBe(2);
    expect(find('.career-tip').hidden).toBe(false);
    graph.update(WEEKS.slice(0, 2), THRESHOLDS);
    expect(graph.selected).toBeNull();
    expect(find('.career-tip').hidden).toBe(true);
  });

  it('keeps the tooltip text current when only a title changes', () => {
    const { svg, graph, find, x } = build();
    svg.dispatch('pointermove', { clientX: x(2), pointerType: 'mouse' });
    graph.update(WEEKS.map(week => (week.week === 2 ? { ...week, after: 'Head clerk' } : week)), THRESHOLDS);
    expect(find('.career-tip-event').textContent).toBe('Promoted to Head clerk.');
  });

  it('draws the legend with the markers the weeks hold, and nothing without weeks', () => {
    const { graph, find } = build();
    const legend = () => find('.career-legend').querySelectorAll('.career-legend-text').map(node => node.textContent);
    expect(legend()).toEqual(['Weekly review score', 'Good, 65', 'Poor, 40', 'Promoted', 'Demoted', 'Raise', 'Changed path']);
    graph.update([WEEKS[0]], THRESHOLDS);
    expect(legend()).toEqual(['Weekly review score', 'Good, 65', 'Poor, 40']);
    graph.update([], THRESHOLDS);
    expect(find('.career-legend').hidden).toBe(true);
  });
});

describe('the tooltip on the Career tab graph', () => {
  it('D4 and item 9: floats over the plot away from the line and clear of the axis labels', () => {
    const { svg, graph, find, x } = build();
    svg.dispatch('click', { clientX: x(3), pointerType: 'mouse' });
    expect(graph.selected).toBe(3);
    const tip = find('.career-tip');
    expect(tip.getAttribute('data-place'), 'a week scored under 50 puts the tooltip in the top of the plot').toBe('high');
    svg.dispatch('click', { clientX: x(2), pointerType: 'mouse' });
    expect(tip.getAttribute('data-place'), 'a higher score puts it in the bottom').toBe('low');
    const css = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    expect(/\.career-tip \{[^}]*\}/.exec(css)![0]).toContain('max(8%,');
  });

  it('draws the plot with only the room the marks need above it', () => {
    const { svg } = build();
    const tops = [Number(svg.querySelector('.career-axis-line')!.getAttribute('y1'))];
    expect(Math.min(...tops)).toBeLessThanOrEqual(24);
  });
});
