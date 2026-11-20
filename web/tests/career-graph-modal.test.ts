import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CareerInputWeek, CareerReport, CareerWeek } from '../src/bridge.js';
import {
  CAREER_LONGER_WEEKS,
  CAREER_PHONE_QUERY,
  CAREER_RECENT_WEEKS,
  CareerReviewWindow,
  type CareerReviewPause,
  type CareerReviewSource,
} from '../src/ui/career-graph-modal.js';
import { REVIEW_WINDOW_ID } from '../src/ui/career-panel.js';
import { FakeNode, fakeDocument } from './helpers/fake-dom.js';

const SCORES = [52, 58, 61, 68, 74, 63, 45, 38, 55, 67, 70, 59, 61, 72];
const MASTERY = [18, 20, 22, 24, 26, 27, 28, 29, 31, 33, 36, 37, 39, 41];
const MOOD = [0.05, 0.12, 0.1, 0.22, 0.3, 0.15, -0.2, -0.35, 0.02, 0.18, 0.21, 0.04, 0.08, 0.18];
const MISSED = [0, 0, 30, 0, 0, 0, 95, 180, 20, 0, 0, 45, 10, 0];
const PAY = [140, 140, 140, 140, 140, 160, 160, 160, 160, 160, 160, 175, 175, 175];
const TITLES = ['Office clerk', 'Senior clerk', 'Office manager', 'Director of paperwork'];

const WEEKS: CareerWeek[] = SCORES.map((performance, week) => ({ week, performance, event: week === 4 ? 1 : week === 10 ? 2 : 0 }));

function inputRow(week: number): CareerInputWeek {
  return { week, career: week < 5 ? 0 : 1, path: 0, level: week < 5 ? 0 : 1, shifts: 5, attended: week === 6 ? 4 : 5,
    fit: 0.4, traitFit: 0.4, socialCapacity: 0.62, socialDemand: 0.3, mastery: MASTERY[week] / 100, mood: MOOD[week],
    missedMinutes: MISSED[week], pay: PAY[week] };
}

const REPORT: CareerReport = { path: 0, level: 1, levels: 4, pay: 175, payMin: 160, payMax: 200, shifts: 0, mean: null, last: 72,
  poor: 0, good: 2, advanceWeeks: 3, jobSatisfaction: 58, warned: false, trend: 1, poorThreshold: 40, goodThreshold: 65 };

class Source implements CareerReviewSource {
  weeks: CareerWeek[] = WEEKS;
  inputs: CareerInputWeek[] = WEEKS.map(week => inputRow(week.week));
  report: CareerReport | null = REPORT;
  title: string | null = 'Senior clerk';
  shiftTicks = 480;
  simName(): string { return 'Tim'; }
  careerOf(): string | null { return this.title; }
  careerReport(): CareerReport | null { return this.report; }
  careerHistory(): readonly CareerWeek[] { return this.weeks; }
  careerInputHistory(): readonly CareerInputWeek[] { return this.inputs; }
  careerLevelTitles(): readonly string[] { return TITLES; }
  careerPathLabels(): readonly string[] { return ['Office', 'Cafe']; }
  careerScheduleOf() { return { workingDays: 31, shiftStart: 360, shiftTicks: this.shiftTicks, kind: 0, index: 0 }; }
  dayTicks(): number { return 1440; }
}

class Pause implements CareerReviewPause {
  readonly log: string[] = [];
  selectedSpeed = 1;
  suspend(owner: string): void { this.log.push(`suspend ${owner}`); }
  resume(owner: string): void { this.log.push(`resume ${owner}`); }
}

function build(options: { source?: Source; pause?: Pause; phone?: boolean; fallbacks?: () => (FakeNode | null)[] } = {}) {
  const { fake, doc } = fakeDocument();
  if (options.phone) fake.media.add(CAREER_PHONE_QUERY);
  const source = options.source ?? new Source();
  const pause = options.pause ?? new Pause();
  const win = new CareerReviewWindow(doc, source, pause, options.fallbacks as never);
  const dialog = win.element as unknown as FakeNode;
  const opener = fake.createElement('button');
  fake.body.append(opener);
  const q = (selector: string): FakeNode => {
    const node = dialog.querySelector(selector);
    if (!node) throw new Error(`no ${selector}`);
    return node;
  };
  const all = (selector: string) => dialog.querySelectorAll(selector);
  const chart = (id: string) => q(`.career-chart[data-chart="${id}"]`);
  const names = () => all('.career-chart').map(node => node.getAttribute('data-chart'));
  const scoreSvg = () => chart('score').querySelector('.career-chart-svg')!;
  const open = () => win.open(7, opener as unknown as HTMLElement);
  return { fake, win, dialog, opener, pause, source, q, all, chart, names, scoreSvg, open };
}

/** Puts a pointer over week `index` of the score graph, whose columns the test measures. */
function over(h: ReturnType<typeof build>, index: number, pointerType = 'mouse', event: 'pointermove' | 'click' = 'pointermove') {
  const svg = h.scoreSvg();
  const width = Number(svg.getAttribute('width'));
  const shown = h.all('.career-chart[data-chart="score"] .career-win-point').length;
  svg.rect = { left: 40, top: 0, width, height: 200 };
  const column = width / shown;
  svg.dispatch(event, { clientX: 40 + column * index + column / 2, pointerType });
}

describe('opening the review window', () => {
  it('pauses the game before it shows the window and names the person and the job', () => {
    const h = build();
    expect(h.open()).toBe(true);
    expect(h.pause.log).toEqual(['suspend career-graph']);
    expect(h.dialog.open).toBe(true);
    expect(h.dialog.id).toBe('career-graph-dialog');
    expect(h.dialog.getAttribute('aria-labelledby')).toBe('career-graph-title');
    expect(h.q('#career-graph-title').textContent).toBe("Tim's reviews");
    expect(h.q('.career-win-who').textContent).toBe('Senior clerk, Office path, level 2 of 4');
    expect(h.win.isOpen).toBe(true);
  });

  it('says what closing does, at the speed the player had chosen', () => {
    const pause = new Pause();
    pause.selectedSpeed = 2;
    const h = build({ pause });
    h.open();
    expect(h.q('.career-win-paused').getAttribute('role')).toBe('status');
    expect(h.q('.career-win-paused-label').textContent).toBe('Game paused');
    expect(h.q('.career-win-paused-note').textContent).toBe('Closing this window resumes the game at 2x.');
  });

  it('says the game stays paused when the player had already paused it', () => {
    const pause = new Pause();
    pause.selectedSpeed = 0;
    const h = build({ pause });
    h.open();
    expect(h.q('.career-win-paused-note').textContent).toBe('The game stays paused after you close this window.');
    h.win.close();
    expect(pause.log, 'the pause is released and the controller restores the paused speed').toEqual(['suspend career-graph', 'resume career-graph']);
  });

  it('puts focus on the heading so a screen reader announces the window', () => {
    const h = build();
    h.open();
    expect(h.q('#career-graph-title').getAttribute('tabindex')).toBe('-1');
    expect(h.fake.activeElement).toBe(h.q('#career-graph-title'));
  });

  it('does not open, or pause, for a person with no job or no reviewed week', () => {
    const noJob = new Source();
    noJob.title = null;
    const first = build({ source: noJob });
    expect(first.open()).toBe(false);
    expect(first.pause.log).toEqual([]);
    const noWeeks = new Source();
    noWeeks.weeks = [];
    const second = build({ source: noWeeks });
    expect(second.open()).toBe(false);
    expect(second.dialog.open).toBe(false);
    const noReport = new Source();
    noReport.report = null;
    expect(build({ source: noReport }).open()).toBe(false);
  });

  it('ignores a second open while the window is up', () => {
    const h = build();
    h.open();
    expect(h.open()).toBe(false);
    expect(h.pause.log).toEqual(['suspend career-graph']);
  });
});

describe('closing the review window', () => {
  it('resumes the game once however it closes: Close, Escape or the backdrop', () => {
    for (const how of ['button', 'escape', 'backdrop'] as const) {
      const h = build();
      h.open();
      if (how === 'button') h.q('.career-win-close').click();
      // The browser closes a dialog on Escape after its cancel event.
      else if (how === 'escape') { h.dialog.dispatch('cancel'); h.dialog.close(); }
      else h.dialog.dispatch('click', { target: h.dialog });
      expect(h.dialog.open, how).toBe(false);
      expect(h.pause.log, how).toEqual(['suspend career-graph', 'resume career-graph']);
      h.win.close();
      expect(h.pause.log, `${how}: a second close does nothing`).toHaveLength(2);
    }
  });

  it('stays open for a click inside the window', () => {
    const h = build();
    h.open();
    h.q('.career-win-header').dispatch('click', { target: h.q('.career-win-header') });
    expect(h.dialog.open).toBe(true);
  });

  it('gives focus back to the opener when it is still visible and enabled', () => {
    const h = build();
    h.open();
    h.win.close();
    expect(h.fake.activeElement).toBe(h.opener);
  });

  it('falls back to the Career tab heading, then to Sim details, when the opener is gone', () => {
    let heading!: FakeNode;
    let details!: FakeNode;
    const h = build({ fallbacks: () => [heading, details] });
    heading = h.fake.createElement('div');
    details = h.fake.createElement('section');
    h.open();
    h.opener.hidden = true;
    h.win.close();
    expect(h.fake.activeElement).toBe(heading);
    expect(heading.getAttribute('tabindex'), 'a heading takes focus only because it is made focusable').toBe('-1');
    const again = build({ fallbacks: () => [null, again.fake.createElement('section')] });
    again.open();
    again.opener.rendered = false;
    again.win.close();
    expect(again.fake.activeElement?.tagName, 'a missing heading hands focus on').toBe('section');
    const none = build();
    none.open();
    none.opener.disabled = true;
    none.win.close();
    expect(none.fake.activeElement, 'nothing to focus leaves it to the browser').not.toBe(none.opener);
  });

  it('does nothing when asked to close a window that is not open', () => {
    const h = build();
    h.win.close();
    expect(h.pause.log).toEqual([]);
    h.open();
    h.win.close();
    h.win.close();
    expect(h.pause.log).toEqual(['suspend career-graph', 'resume career-graph']);
  });
});

describe('the filters', () => {
  const checked = (h: ReturnType<typeof build>, id: string) => h.q(`input[data-filter="${id}"]`).checked;

  it('starts with mastery, mood, missed work and fit on, and trait fit, social capacity and pay off', () => {
    const h = build();
    h.open();
    expect(['mastery', 'mood', 'missed', 'fit', 'trait', 'social', 'pay'].map(id => checked(h, id))).toEqual(
      [true, true, true, true, false, false, false]);
    expect(checked(h, 'bands')).toBe(true);
    expect(checked(h, 'events')).toBe(true);
    expect(h.names()).toEqual(['score', 'mastery', 'mood', 'missed', 'fit']);
    expect(h.q('.career-win-filter-count').textContent).toBe('4 of 7 lines shown');
  });

  it('lists the six score inputs under Score inputs and pay under its own label, below them', () => {
    const h = build();
    h.open();
    const groups = h.all('fieldset');
    expect(groups[0].querySelector('legend')?.textContent).toBe('Score inputs');
    expect(groups[0].querySelectorAll('.career-check-text').map(node => node.textContent)).toEqual(
      ['Skill mastery', 'Mood on shifts', 'Missed work', 'Fit', 'Trait fit', 'Social capacity']);
    expect(groups[0].querySelector('input[data-filter="pay"]'), 'pay is not a score input').toBeNull();
    expect(groups[1].classes()).toContain('career-win-also');
    expect(groups[1].querySelector('.career-check-text')?.textContent).toBe('Also show: Pay per shift');
    expect(groups[1].querySelector('input[data-filter="pay"]')).not.toBeNull();
    expect(groups[2].querySelector('legend')?.textContent).toBe('On the score graph');
    expect(groups[2].querySelectorAll('.career-check-text').map(node => node.textContent)).toEqual(
      ['Good and poor lines', 'Promotions and other events']);
    const order = groups.map(group => (group.classes().includes('career-win-also') ? 'also' : group.querySelector('legend')?.textContent));
    expect(order, 'the pay checkbox sits below the score inputs').toEqual(['Score inputs', 'also', 'On the score graph']);
    expect(h.all('.career-swatch'), 'a swatch beside each of the seven lines').toHaveLength(7);
  });

  it('shows and hides a row as its checkbox changes, with pay last', () => {
    const h = build();
    h.open();
    const toggle = (id: string, value: boolean) => { const box = h.q(`input[data-filter="${id}"]`); box.checked = value; box.dispatch('change'); };
    toggle('mastery', false);
    expect(h.names()).toEqual(['score', 'mood', 'missed', 'fit']);
    toggle('social', true);
    toggle('trait', true);
    toggle('pay', true);
    expect(h.names(), 'filter order, pay after the score inputs').toEqual(['score', 'mood', 'missed', 'fit', 'trait', 'social', 'pay']);
    expect(h.q('.career-win-filter-count').textContent).toBe('6 of 7 lines shown');
    toggle('mood', false); toggle('missed', false); toggle('fit', false); toggle('trait', false); toggle('social', false); toggle('pay', false);
    expect(h.names()).toEqual(['score']);
  });

  it('hides the threshold lines and the event marks and labels on request', () => {
    const h = build();
    h.open();
    expect(h.all('.career-chart[data-chart="score"] .career-win-rule')).toHaveLength(2);
    expect(h.all('.career-chart[data-chart="score"] .career-mark')).toHaveLength(2);
    expect(h.all('.career-chart[data-chart="score"] .career-level').length).toBeGreaterThan(0);
    const bands = h.q('input[data-filter="bands"]');
    bands.checked = false; bands.dispatch('change');
    expect(h.all('.career-chart[data-chart="score"] .career-win-rule')).toHaveLength(0);
    expect(h.all('.career-chart[data-chart="score"] .career-band')).toHaveLength(0);
    const events = h.q('input[data-filter="events"]');
    events.checked = false; events.dispatch('change');
    expect(h.all('.career-chart[data-chart="score"] .career-mark')).toHaveLength(0);
    expect(h.all('.career-chart[data-chart="score"] .career-level')).toHaveLength(0);
    expect(h.all('.career-win-key-side .career-key-events').every(node => node.hidden)).toBe(true);
    expect(h.all('.career-win-key-side .career-key-bands').every(node => node.hidden)).toBe(true);
  });

  it('keeps the choices when the window is closed and opened again', () => {
    const h = build();
    h.open();
    const box = h.q('input[data-filter="fit"]');
    box.checked = false; box.dispatch('change');
    h.win.close();
    h.open();
    expect(h.names()).toEqual(['score', 'mastery', 'mood', 'missed']);
    expect(h.q('input[data-filter="fit"]').checked).toBe(false);
  });
});

describe('the weeks shown', () => {
  const pointCount = (h: ReturnType<typeof build>) => h.all('.career-chart[data-chart="score"] .career-win-point').length;
  const pressed = (h: ReturnType<typeof build>) => h.all('.career-win-range button').map(node => node.getAttribute('aria-pressed'));
  const summary = (h: ReturnType<typeof build>) => h.q('.career-win-summary').textContent;

  it('offers the presets as named constants, all weeks selected at open', () => {
    expect([CAREER_RECENT_WEEKS, CAREER_LONGER_WEEKS]).toEqual([4, 12]);
    const h = build();
    h.open();
    const group = h.q('.career-win-range');
    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-label')).toBe('Weeks shown');
    expect(h.all('.career-win-range button').map(node => node.textContent)).toEqual(['Last 4 weeks', 'Last 12 weeks', 'All weeks']);
    expect(pressed(h)).toEqual(['false', 'false', 'true']);
    expect(pointCount(h)).toBe(14);
  });

  it('shows the last four or twelve weeks and counts only those in the summary', () => {
    const h = build();
    h.open();
    expect(summary(h)).toBe('14 reviewed weeks. Average 60. Good weeks 5, poor weeks 1.');
    h.all('.career-win-range button')[0].click();
    expect(pressed(h)).toEqual(['true', 'false', 'false']);
    expect(pointCount(h)).toBe(4);
    expect(summary(h)).toBe('4 reviewed weeks. Average 66. Good weeks 2, poor weeks 0.');
    h.all('.career-win-range button')[1].click();
    expect(pointCount(h)).toBe(12);
    expect(summary(h)).toBe('12 reviewed weeks. Average 61. Good weeks 5, poor weeks 1.');
    h.all('.career-win-range button')[2].click();
    expect(pointCount(h)).toBe(14);
  });

  it('shows every week when there are fewer than the preset, and says one week in the singular', () => {
    const source = new Source();
    source.weeks = WEEKS.slice(0, 3);
    const h = build({ source });
    h.open();
    h.all('.career-win-range button')[0].click();
    expect(pointCount(h)).toBe(3);
    source.weeks = WEEKS.slice(0, 1);
    h.win.close();
    h.open();
    expect(summary(h)).toBe('1 reviewed week. Average 52. Good weeks 0, poor weeks 0.');
  });

  it('starts at All weeks at each open', () => {
    const h = build();
    h.open();
    h.all('.career-win-range button')[0].click();
    h.win.close();
    h.open();
    expect(pressed(h)).toEqual(['false', 'false', 'true']);
  });

  it('drops a chosen week that the new range no longer shows', () => {
    const h = build();
    h.open();
    over(h, 0);
    expect(h.q('.career-win-tip').hidden).toBe(false);
    h.all('.career-win-range button')[0].click();
    expect(h.q('.career-win-tip').hidden).toBe(true);
    h.all('.career-win-range button')[2].click();
    expect(h.q('.career-win-tip').hidden, 'the week does not come back when all weeks return').toBe(true);
  });
});

describe('the score graph and the input rows', () => {
  it('draws one colored point per week, the two threshold lines and a week number under every column', () => {
    const h = build();
    h.open();
    const points = h.all('.career-chart[data-chart="score"] .career-win-point');
    expect(points.map(point => point.classes().pop())).toEqual(SCORES.map(score => (score >= 65 ? 'career-point-good' : score < 40 ? 'career-point-poor' : 'career-point-steady')));
    expect(h.all('.career-chart[data-chart="score"] .career-win-rule').map(rule => rule.getAttribute('data-kind'))).toEqual(['good', 'poor']);
    expect(h.all('.career-chart[data-chart="score"] .career-win-rule-label').map(label => label.textContent)).toEqual(['Good, 65', 'Poor, 40']);
    expect(h.all('.career-chart[data-chart="score"] .career-week-number').map(node => node.textContent)).toEqual(
      SCORES.map((_, index) => String(index + 1)));
    expect(h.q('.career-chart[data-chart="score"] .career-chart-name').textContent).toBe('Review score');
    expect(h.scoreSvg().getAttribute('role')).toBe('img');
    expect(h.scoreSvg().getAttribute('aria-label')).toBe('Review score by week');
  });

  it('labels each run of weeks at one title and draws a dotted rule where the level changes', () => {
    const h = build();
    h.open();
    expect(h.all('.career-chart[data-chart="score"] .career-level').map(node => node.textContent)).toEqual(['Office clerk', 'Senior clerk']);
    expect(h.all('.career-chart[data-chart="score"] .career-level-rule')).toHaveLength(1);
    const labels = h.all('.career-chart[data-chart="score"] .career-level');
    const x = (node: FakeNode) => Number(node.getAttribute('x'));
    const width = Number(h.scoreSvg().getAttribute('width'));
    expect(x(labels[0]), 'the first run is centered over weeks 1 to 5').toBeCloseTo((width / 14) * 2.5, 0);
    expect(x(labels[1]), 'the second over weeks 6 to 14').toBeCloseTo((width / 14) * 9.5, 0);
  });

  it('puts a marker at each event', () => {
    const h = build();
    h.open();
    expect(h.all('.career-chart[data-chart="score"] .career-mark').map(mark => mark.dataset.event)).toEqual(['1', '2']);
  });

  it('draws each input on its own scale, labelled and sharing the week columns', () => {
    const h = build();
    h.open();
    const label = (id: string) => h.chart(id).querySelector('.career-chart-name')!.textContent;
    expect(['mastery', 'mood', 'missed', 'fit'].map(label)).toEqual(['Skill mastery', 'Mood on shifts', 'Missed work', 'Fit']);
    const ticks = (id: string) => h.chart(id).querySelectorAll('.career-tick').map(node => node.textContent);
    expect(ticks('mastery')).toEqual(['100%', '0%']);
    expect(ticks('mood')).toEqual(['+1', '-1']);
    expect(ticks('fit')).toEqual(['+1', '-1']);
    expect(ticks('missed'), 'the longest shift is 8 hours').toEqual(['8 h', '0 min']);
    expect(h.chart('mood').querySelectorAll('.career-zero')).toHaveLength(1);
    expect(h.chart('mastery').querySelectorAll('.career-zero')).toHaveLength(0);
    expect(h.chart('mastery').querySelectorAll('polyline')).toHaveLength(1);
    expect(h.chart('missed').querySelectorAll('.career-bar'), 'a bar for each week with missed minutes').toHaveLength(6);
    const widths = ['score', 'mastery', 'mood', 'missed', 'fit'].map(id => h.chart(id).querySelector('.career-chart-svg')!.getAttribute('width'));
    expect(new Set(widths).size, 'every chart shares one column width').toBe(1);
  });

  it('scales missed work to the larger of the longest shift and the largest weekly total, in hours', () => {
    const source = new Source();
    source.inputs = source.inputs.map(row => (row.week === 7 ? { ...row, missedMinutes: 600 } : row));
    const h = build({ source });
    h.open();
    expect(h.chart('missed').querySelectorAll('.career-tick').map(node => node.textContent)).toEqual(['10 h', '0 min']);
    const short = new Source();
    short.shiftTicks = 90;
    short.inputs = short.inputs.map(row => ({ ...row, missedMinutes: 30 }));
    const second = build({ source: short });
    second.open();
    expect(second.chart('missed').querySelectorAll('.career-tick').map(node => node.textContent)).toEqual(['1.5 h', '0 min']);
  });

  it('draws trait fit, social capacity with the job demand, and pay with its own dollar scale', () => {
    const h = build();
    h.open();
    for (const id of ['trait', 'social', 'pay']) { const box = h.q(`input[data-filter="${id}"]`); box.checked = true; box.dispatch('change'); }
    expect(h.chart('trait').querySelectorAll('.career-tick').map(node => node.textContent)).toEqual(['+1', '-1']);
    expect(h.chart('social').querySelectorAll('.career-tick').map(node => node.textContent)).toEqual(['100%', '0%']);
    expect(h.chart('social').querySelectorAll('.career-demand'), 'the job needs a share of social capacity').toHaveLength(1);
    expect(h.chart('pay').querySelectorAll('.career-tick').map(node => node.textContent)).toEqual(['$175', '$140']);
    expect(h.chart('pay').querySelector('.career-chart-name')?.textContent).toBe('Pay per shift');
  });

  it('shows a week with no recorded inputs as not recorded and draws no mark for it', () => {
    const source = new Source();
    source.inputs = source.inputs.filter(row => row.week >= 6);
    const h = build({ source });
    h.open();
    expect(h.chart('mastery').querySelector('.career-chart-value')?.textContent, 'the latest week has inputs').toBe('Week 14: 41%');
    over(h, 2);
    expect(h.chart('mastery').querySelector('.career-chart-value')?.textContent).toBe('Week 3: not recorded');
    expect(h.chart('missed').querySelector('.career-chart-value')?.textContent).toBe('Week 3: not recorded');
    expect(h.chart('mastery').querySelectorAll('polyline')[0].getAttribute('points')!.split(' '), 'only recorded weeks are on the line').toHaveLength(8);
    expect(h.all('.career-chart[data-chart="score"] .career-level').map(node => node.textContent), 'no label for weeks without a title').toEqual(['Senior clerk']);
    expect(h.all('.career-chart[data-chart="score"] .career-level-rule')).toHaveLength(0);
  });
});

describe('choosing a week in the window', () => {
  it('shows a tooltip with the week, what kind it was and what the inputs were', () => {
    const h = build();
    h.open();
    over(h, 7);
    const tip = h.q('.career-win-tip');
    expect(tip.hidden).toBe(false);
    expect(h.q('.career-win-tip .career-tip-title').textContent).toBe('Week 8 review: 38 of 100');
    expect(h.q('.career-win-tip .career-tip-kind').textContent).toBe('Poor week:');
    expect(h.q('.career-win-tip .career-tip-rest').textContent).toBe('under 40. Poor weeks in a row bring a warning.');
    expect(h.q('.career-win-tip .career-tip-event').hidden).toBe(true);
    const cells = tip.querySelectorAll('dl dt, dl dd').map(node => node.textContent);
    expect(cells).toEqual(['Shifts worked', '5 of 5', 'Missed work', '180 minutes', 'Skill mastery', '29%', 'Mood on shifts', '-0.35',
      'Fit', '+0.40', 'Pay per shift', '$160']);
  });

  it('names the event and the title it led to', () => {
    const h = build();
    h.open();
    over(h, 4);
    expect(h.q('.career-win-tip .career-tip-event').hidden).toBe(false);
    expect(h.q('.career-win-tip .career-tip-event').textContent).toBe('Promoted to Senior clerk.');
    over(h, 10);
    expect(h.q('.career-win-tip .career-tip-event').textContent).toBe('Got a raise.');
  });

  it('updates the rows to the chosen week and puts a ring on its point', () => {
    const h = build();
    h.open();
    expect(h.chart('mastery').querySelector('.career-chart-value')?.textContent, 'the latest week until one is chosen').toBe('Week 14: 41%');
    over(h, 7);
    expect(h.chart('score').querySelector('.career-chart-value')?.textContent).toBe('Week 8: 38 of 100');
    expect(h.chart('mastery').querySelector('.career-chart-value')?.textContent).toBe('Week 8: 29%');
    expect(h.chart('mood').querySelector('.career-chart-value')?.textContent).toBe('Week 8: -0.35');
    expect(h.chart('missed').querySelector('.career-chart-value')?.textContent).toBe('Week 8: 180 minutes');
    expect(h.chart('fit').querySelector('.career-chart-value')?.textContent).toBe('Week 8: +0.40');
    expect(h.all('.career-chart .career-win-ring')).toHaveLength(1);
    expect(h.all('.career-chart .career-win-guide'), 'a guide line through every chart').toHaveLength(5);
    expect(h.all('.career-week-number').filter(node => node.classes().includes('career-week-selected')).map(node => node.textContent)).toEqual(['8']);
  });

  it('shows social capacity with the job demand in its label', () => {
    const h = build();
    h.open();
    const box = h.q('input[data-filter="social"]');
    box.checked = true; box.dispatch('change');
    over(h, 7);
    expect(h.chart('social').querySelector('.career-chart-value')?.textContent).toBe('Week 8: 62% (job needs 30%)');
  });

  it('keeps the tooltip while a touch is held away and toggles it on a repeated tap', () => {
    const h = build({ phone: true });
    h.open();
    over(h, 3, 'touch', 'click');
    expect(h.q('.career-win-tip').hidden).toBe(false);
    h.scoreSvg().dispatch('pointerleave', { pointerType: 'touch' });
    expect(h.q('.career-win-tip').hidden, 'a finger leaving does not close the details').toBe(false);
    over(h, 3, 'touch', 'click');
    expect(h.q('.career-win-tip').hidden, 'tapping the same week again closes them').toBe(true);
  });

  it('hides the tooltip when a mouse leaves the graph', () => {
    const h = build();
    h.open();
    over(h, 5);
    h.scoreSvg().dispatch('pointerleave', { pointerType: 'mouse' });
    expect(h.q('.career-win-tip').hidden).toBe(true);
  });

  it('chooses a week by keyboard on the score graph with Left, Right, Home and End', () => {
    const h = build();
    h.open();
    const scroller = h.q('.career-win-score-scroll');
    expect(scroller.getAttribute('role')).toBe('group');
    expect(scroller.getAttribute('aria-label')).toBe('Reviewed weeks');
    expect(scroller.tabIndex).toBe(0);
    const title = () => h.q('.career-win-tip .career-tip-title').textContent;
    scroller.focus();
    expect(title()).toBe('Week 14 review: 72 of 100');
    scroller.dispatch('keydown', { key: 'ArrowLeft' });
    expect(title()).toBe('Week 13 review: 61 of 100');
    scroller.dispatch('keydown', { key: 'Home' });
    expect(title()).toBe('Week 1 review: 52 of 100');
    scroller.dispatch('keydown', { key: 'ArrowLeft' });
    expect(title(), 'stops at the first week').toBe('Week 1 review: 52 of 100');
    scroller.dispatch('keydown', { key: 'End' });
    scroller.dispatch('keydown', { key: 'ArrowRight' });
    expect(title(), 'stops at the last week').toBe('Week 14 review: 72 of 100');
    expect(scroller.dispatch('keydown', { key: 'a' }).defaultPrevented).toBe(false);
    expect(h.q('.career-live').getAttribute('aria-live')).toBe('polite');
    expect(h.q('.career-live').textContent).toBe(
      'Week 14 review: 72 of 100. Good week: 65 or more counts toward promotion.');
  });

  it('keeps the keyboard on the score graph while weeks change', () => {
    const h = build();
    h.open();
    const scroller = h.q('.career-win-score-scroll');
    scroller.focus();
    scroller.dispatch('keydown', { key: 'Home' });
    expect(h.fake.activeElement, 'the graph is not rebuilt under the keyboard').toBe(scroller);
    expect(h.q('.career-win-score-scroll')).toBe(scroller);
  });

  it('says a week without inputs has none recorded instead of listing them', () => {
    const source = new Source();
    source.inputs = source.inputs.filter(row => row.week >= 6);
    const h = build({ source });
    h.open();
    over(h, 1);
    expect(h.q('.career-win-tip .career-tip-missing').hidden).toBe(false);
    expect(h.q('.career-win-tip .career-tip-missing').textContent).toBe('No score inputs were recorded for this week.');
    expect(h.q('.career-win-tip dl').hidden).toBe(true);
    over(h, 9);
    expect(h.q('.career-win-tip .career-tip-missing').hidden).toBe(true);
    expect(h.q('.career-win-tip dl').hidden).toBe(false);
  });
});

describe('the phone layout', () => {
  it('opens the Filters disclosure closed on a phone and open beside the graphs on a desktop', () => {
    const phone = build({ phone: true });
    phone.open();
    expect(phone.q('details.career-win-filters').open).toBe(false);
    expect(phone.q('details.career-win-filters summary').textContent).toContain('Filters');
    expect(phone.q('.career-win-filter-count').textContent).toBe('4 of 7 lines shown');
    const desktop = build();
    desktop.open();
    expect(desktop.q('details.career-win-filters').open).toBe(true);
  });

  it('keeps a column at least 40px wide on a phone and scrolls the plot when the weeks do not fit', () => {
    const phone = build({ phone: true });
    phone.open();
    const plot = Number(phone.scoreSvg().getAttribute('width'));
    expect(plot).toBeGreaterThanOrEqual(14 * 40);
    const axis = phone.chart('score').querySelector('.career-axis-svg')!;
    expect(Number(axis.getAttribute('width')), 'a narrow axis column on a phone').toBe(40);
    const wide = build();
    wide.open();
    expect(Number(wide.chart('score').querySelector('.career-axis-svg')!.getAttribute('width'))).toBe(64);
  });

  it('shows the step buttons and a hint that hides once a week is chosen', () => {
    const h = build({ phone: true });
    h.open();
    expect(h.q('.career-win-hint').textContent).toBe('Tap a week for details.');
    expect(h.q('.career-win-hint').hidden).toBe(false);
    over(h, 7, 'touch', 'click');
    expect(h.q('.career-win-hint').hidden, 'the hint goes while details are open').toBe(true);
    const steps = h.all('.career-win-steps button');
    expect(steps.map(node => node.textContent)).toEqual(['Previous week', 'Next week', 'Hide details']);
    steps[1].click();
    expect(h.q('.career-win-tip .career-tip-title').textContent).toBe('Week 9 review: 55 of 100');
    steps[0].click(); steps[0].click();
    expect(h.q('.career-win-tip .career-tip-title').textContent).toBe('Week 7 review: 45 of 100');
    steps[2].click();
    expect(h.q('.career-win-tip').hidden).toBe(true);
    expect(h.q('.career-win-hint').hidden).toBe(false);
  });

  it('disables Previous at the first shown week and Next at the last', () => {
    const h = build({ phone: true });
    h.open();
    over(h, 0, 'touch', 'click');
    const [previous, next] = h.all('.career-win-steps button');
    expect([previous.disabled, next.disabled]).toEqual([true, false]);
    over(h, 13, 'touch', 'click');
    expect([previous.disabled, next.disabled]).toEqual([false, true]);
  });

  it('words the tapped week with the pay row as just Pay per shift', () => {
    const h = build({ phone: true });
    h.open();
    over(h, 7, 'touch', 'click');
    const labels = h.q('.career-win-tip').querySelectorAll('dl dt').map(node => node.textContent);
    expect(labels).toContain('Pay per shift');
    expect(labels.some(text => text.includes('Also shown'))).toBe(false);
  });

  it('draws the key in the flow of the graphs for a phone and in the filter column for a desktop', () => {
    const h = build();
    h.open();
    expect(h.all('.career-win-key-side')).toHaveLength(1);
    expect(h.all('.career-win-key-flow')).toHaveLength(1);
    const text = h.q('.career-win-key-side').textContent;
    expect(text).toContain('Green: good. White: steady. Red: poor.');
    expect(text).toContain('Promoted, demoted');
    expect(text).toContain('Got a raise, changed path');
  });
});

describe('the window in the page', () => {
  const INDEX_HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const MAIN_TS = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

  it('is the dialog the i controls, created once and attached to the page', () => {
    expect(REVIEW_WINDOW_ID).toBe('career-graph-dialog');
    expect(MAIN_TS).toContain('new CareerReviewWindow(document, sim, overlayPause');
    expect(MAIN_TS).toContain('document.body.append(careerReviewWindow.element)');
    expect(MAIN_TS).toContain('careerReview.open = opener =>');
  });

  it('closes, and so resumes the game, when a load, new game or import replaces the world', () => {
    const reset = MAIN_TS.indexOf('careerPanel.resetAfterLoad()');
    expect(MAIN_TS.lastIndexOf('careerReviewWindow.close()', reset)).toBeGreaterThan(reset - 400);
  });

  it('is styled at 1160 by 800 with the seven series colors, and fills a phone screen', () => {
    for (const color of ['#4aa3ef', '#f59a2f', '#ef4f4f', '#b07cf5', '#3fcf7f', '#ec5fb8', '#f2e64a']) expect(INDEX_HTML).toContain(color);
    expect(INDEX_HTML).toContain('width: min(1160px, calc(100vw - 48px))');
    expect(INDEX_HTML).toContain('height: min(800px, calc(100dvh - 48px))');
    expect(INDEX_HTML).toContain('#career-graph-dialog::backdrop { background: rgba(0, 0, 0, .62); }');
    const phone = INDEX_HTML.indexOf('@media (width <= 600px), (height <= 480px)');
    expect(phone).toBeGreaterThan(0);
    expect(INDEX_HTML.slice(phone, phone + 400)).toContain('#career-graph-dialog { width: 100vw; height: 100dvh;');
    expect(CAREER_PHONE_QUERY).toBe('(max-width: 600px), (max-height: 480px)');
  });

  it('positions the floating tooltip from the chosen week on a desktop', () => {
    const h = build();
    h.open();
    over(h, 3);
    expect(h.q('.career-win-tip').style.getPropertyValue('--tip-x')).toMatch(/^\d+(\.\d+)?px$/);
    over(h, 4);
    const first = Number.parseFloat(h.q('.career-win-tip').style.getPropertyValue('--tip-x'));
    over(h, 5);
    expect(Number.parseFloat(h.q('.career-win-tip').style.getPropertyValue('--tip-x'))).toBeGreaterThan(first);
  });
});

describe('review defects found in the played pass', () => {
  const INDEX_HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  it('D2: keeps the chosen week and the keyboard on the new graph when a range change rebuilds it', () => {
    for (const phone of [true, false]) {
      const h = build({ phone });
      h.open();
      const scroller = h.q('.career-win-score-scroll');
      scroller.focus();
      scroller.dispatch('keydown', { key: 'ArrowLeft' });
      expect(h.q('.career-win-tip .career-tip-title').textContent).toBe('Week 13 review: 61 of 100');
      h.all('.career-win-range button')[1].click();
      const rebuilt = h.q('.career-win-score-scroll');
      expect(rebuilt, 'the graph was rebuilt').not.toBe(scroller);
      expect(h.fake.activeElement, 'the keyboard stays on the graph').toBe(rebuilt);
      expect(h.q('.career-win-tip').hidden, 'the details stay open').toBe(false);
      rebuilt.dispatch('keydown', { key: 'ArrowLeft' });
      expect(h.q('.career-win-tip .career-tip-title').textContent).toBe('Week 12 review: 59 of 100');
    }
  });

  it('D2: a late blur from the graph that was replaced does not close the details', () => {
    const h = build({ phone: true });
    h.open();
    over(h, 5, 'touch', 'click');
    const old = h.q('.career-win-score-scroll');
    old.focus();
    h.all('.career-win-range button')[1].click();
    old.isConnected = false;
    old.dispatch('blur');
    expect(h.q('.career-win-tip').hidden).toBe(false);
  });

  it('D3: puts no Good or Poor label in the plot on a phone, and keeps them in the key', () => {
    const phone = build({ phone: true });
    phone.open();
    expect(phone.all('.career-win-rule-label')).toHaveLength(0);
    expect(phone.all('.career-win-rule')).toHaveLength(2);
    expect(phone.q('.career-win-key-flow .career-key-poor').textContent).toBe('Poor, 40');
    const desktop = build();
    desktop.open();
    expect(desktop.all('.career-win-rule-label')).toHaveLength(2);
  });

  it('O2: lists Trait fit and Social capacity in the tooltip when their rows are switched on', () => {
    const h = build();
    h.open();
    over(h, 7);
    const labels = () => h.q('.career-win-tip').querySelectorAll('dl dt').map(node => node.textContent);
    expect(labels()).not.toContain('Trait fit');
    for (const id of ['trait', 'social']) { const box = h.q(`input[data-filter="${id}"]`); box.checked = true; box.dispatch('change'); }
    over(h, 6);
    over(h, 7);
    expect(labels()).toEqual(expect.arrayContaining(['Trait fit', 'Social capacity']));
    const values = h.q('.career-win-tip').querySelectorAll('dl dd').map(node => node.textContent);
    expect(values).toContain('+0.40');
    expect(values).toContain('62% (job needs 30%)');
  });

  it('item 9: leaves no blank band above the score plot on either layout', () => {
    for (const phone of [true, false]) {
      const h = build({ phone });
      h.open();
      const rows = h.chart('score').querySelectorAll('.career-grid').map(line => Number(line.getAttribute('y1')));
      expect(Math.min(...rows), phone ? 'phone' : 'desktop').toBeLessThanOrEqual(36);
    }
  });

  it('item 9: keeps the desktop tooltip off the plot line and clear of the axis labels', () => {
    const h = build();
    h.open();
    over(h, 7);
    expect(h.q('.career-win-tip').getAttribute('data-place'), 'a low score sits in the top of the plot').toBe('high');
    over(h, 13);
    expect(h.q('.career-win-tip').getAttribute('data-place'), 'a high score sits in the bottom of the plot').toBe('low');
    const tip = /\.career-win-tip \{[^}]*\}/.exec(INDEX_HTML)![0];
    expect(tip).toContain('clamp(64px,');
  });

  it('D1: the info tooltip cannot grow the heading row, and the focus ring clears the title', () => {
    const tip = /\.career-info-tip \{[^}]*\}/.exec(INDEX_HTML)![0];
    expect(tip).toContain('padding: 2px 8px');
    expect(tip).toMatch(/line-height: 1\.3/);
    expect(INDEX_HTML).toMatch(/\.career-heading \.career-info \{[^}]*margin-left: 4px/);
  });

  it('keeps the phone window from changing width when the details dock appears', () => {
    expect(INDEX_HTML).toMatch(/\.career-win-body \{[^}]*scrollbar-gutter: stable/);
  });
});
