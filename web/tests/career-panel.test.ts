import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type {
  CareerFactors, CareerInputWeek, CareerReport, CareerResult, CareerShift, CareerShiftInputs, CareerWeek, GoToWorkStatus,
} from '../src/bridge.js';
import {
  BY_CHANCE,
  CAREER_WARNING,
  CHANGE_SHIFT,
  SHIFT_SCHEDULE,
  CareerPanel,
  SHIFT_CHANGE_NOTE,
  careerShiftOptions,
  heldShiftOptions,
  careerInputRows,
  careerAttendanceLine,
  careerDurationWords,
  careerJobView,
  careerWindowWords,
  careerWorkView,
  nightPayLine,
  createCareerPanelSurface,
  type CareerPanelActions,
  type CareerPanelSource,
  type CareerPanelState,
  type CareerWorkView,
} from '../src/ui/career-panel.js';

const INDEX_HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const MAIN_TS = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

it('explains worked and missed minutes with the settled pay and performance deduction', () => {
  expect(careerAttendanceLine([480, 300, 180, 72, 10, 62, 10625, 1])).toBe('Last shift: 300 of 480 scheduled minutes worked; 180 missed. Base performance 72, missed-work deduction 10, final score 62. Earned $106.25.');
  expect(careerAttendanceLine([480, 40, 0, 70, 0, 70, 0, 0])).toContain('Current shift: 40');
  expect(careerAttendanceLine([])).toBeNull();
});

function report(overrides: Partial<CareerReport> = {}): CareerReport {
  return { path: 0, level: 1, levels: 4, pay: 170, payMin: 160, payMax: 200, shifts: 2, mean: 71.5, last: 80.2,
    poor: 0, good: 2, advanceWeeks: 3, jobSatisfaction: 58, warned: false, trend: 0, poorThreshold: 40,
    goodThreshold: 65, ...overrides };
}

const FACTORS: CareerFactors = { fit: 0.4, traitFit: 0.4, socialCapacity: 0.7, socialDemand: 0.3, mastery: 0.25, mood: -0.1 };

const WEEKS: CareerWeek[] = [
  { week: 0, performance: 70, event: 0 },
  { week: 1, performance: 82, event: 2 },
  { week: 2, performance: 90, event: 1 },
  { week: 3, performance: 20, event: 3 },
  { week: 4, performance: 55, event: 5 },
];

class Source implements CareerPanelSource {
  selected: number | null = 7;
  title: string | null = 'Senior clerk';
  report_: CareerReport | null = report();
  history: CareerWeek[] = WEEKS;
  factors: CareerFactors | null = FACTORS;
  paths = ['Office', 'Cafe', 'Night watch'];
  result: CareerResult | null = null;
  search: boolean | null = true;
  accept = true;
  heldIndex = 0;
  heldKind = 0;
  pathShifts: Record<number, CareerShift[]> = { 0: OFFICE_SHIFTS, 1: CAFE_SHIFTS, 2: WATCH_SHIFTS };
  readonly sent: unknown[][] = [];
  selectedIndex(): number | null { return this.selected; }
  dayTicks(): number { return 1440; }
  careerOf(): string | null { return this.title; }
  careerScheduleOf() { return { workingDays: 31, shiftStart: 360, shiftTicks: 480, kind: this.heldKind, index: this.heldIndex }; }
  careerReport(): CareerReport | null { return this.report_; }
  careerHistory(): readonly CareerWeek[] { return this.history; }
  careerFactors(): CareerFactors | null { return this.factors; }
  lastShift: CareerShiftInputs | null = null;
  careerLastShift(): CareerShiftInputs | null { return this.lastShift; }
  inputWeeks: CareerInputWeek[] = [];
  careerInputHistory(): readonly CareerInputWeek[] { return this.inputWeeks; }
  careerLevelTitles(): readonly string[] { return ['Office clerk', 'Senior clerk', 'Office manager', 'Director of paperwork']; }
  work: GoToWorkStatus | null = { state: 'none', startTick: null, endTick: null, opensTick: null };
  now = 0;
  weekday = 0;
  clockTick(): number { return this.now; }
  weekdayIndex(): number { return this.weekday; }
  goToWorkStatus(): GoToWorkStatus | null { return this.work; }
  goToWork(entity: number): boolean { this.sent.push(['work', entity]); return this.accept; }
  careerPathLabels(): readonly string[] { return this.paths; }
  assignCareer(entity: number, path: number): boolean { this.sent.push(['assign', entity, path]); return this.accept; }
  quitCareer(entity: number): boolean { this.sent.push(['quit', entity]); return this.accept; }
  lastCareerResult(): CareerResult | null { return this.result; }
  jobSearchOf(): boolean | null { return this.search; }
  setJobSearch(entity: number, search: boolean): boolean { this.sent.push(['search', entity, search]); return this.accept; }
  careerPathShifts(path: number): readonly CareerShift[] { return this.pathShifts[path] ?? []; }
  careerShiftsOf(): readonly CareerShift[] { return this.title === null ? [] : this.pathShifts[0]; }
  assignCareerShift(entity: number, path: number, shift: number): boolean {
    this.sent.push(['assignShift', entity, path, shift]);
    return this.accept;
  }
  changeShift(entity: number, shift: number): boolean { this.sent.push(['change', entity, shift]); return this.accept; }
}

const shift = (index: number, kind: number | null, shiftStart: number, workingDays: number, weight: number): CareerShift =>
  ({ index, kind, shiftStart, shiftTicks: 480, workingDays, weight });
// The office's day shift and rare late one; the cafe's three; the night
// watch's two equally likely nights and an evening.
const OFFICE_SHIFTS = [shift(0, 0, 360, 31, 19), shift(1, 2, 720, 31, 1)];
const CAFE_SHIFTS = [shift(0, 1, 360, 31, 5), shift(1, 0, 540, 0b1111100, 3), shift(2, 2, 780, 0b1110011, 2)];
const WATCH_SHIFTS = [shift(0, 3, 1320, 0b1001111, 2), shift(1, 3, 1320, 0b1111100, 2), shift(2, 2, 840, 31, 1)];

/**
 * A small DOM model, enough for the surface: elements with classes,
 * attributes, a dataset, children, listeners and the selectors the tests
 * use (`tag`, `.class`, `.a:not(.b)`, `tag[attr="v"]`, and one level of
 * descent with a space).
 */
class Node_ {
  id = '';
  textContent = '';
  className = '';
  value = '';
  type = '';
  tabIndex = 0;
  disabled = false;
  checked = false;
  parent: Node_ | null = null;
  nodes: Node_[] = [];
  attributes = new Map<string, string>();
  dataset: Record<string, string> = {};
  listeners = new Map<string, (() => void)[]>();
  constructor(readonly tagName: string, readonly document: Doc) {}
  get hidden(): boolean { return this.attributes.has('hidden'); }
  set hidden(value: boolean) { if (value) this.attributes.set('hidden', ''); else this.attributes.delete('hidden'); }
  get children() { return { item: (index: number) => this.nodes[index] ?? null, length: this.nodes.length }; }
  get lastElementChild() { return this.nodes[this.nodes.length - 1] ?? null; }
  get options() { return this.nodes.filter(node => node.tagName === 'option'); }
  get activeElementIsHere() { return this.contains(this.document.activeElement); }
  append(...nodes: Node_[]) { for (const node of nodes) { node.remove(); node.parent = this; this.nodes.push(node); } }
  replaceChildren() { for (const node of this.nodes) node.parent = null; this.nodes = []; }
  remove() { if (this.parent) this.parent.nodes = this.parent.nodes.filter(node => node !== this); this.parent = null; }
  contains(node: Node_ | null): boolean { return node === this || this.nodes.some(child => child.contains(node)); }
  setAttribute(key: string, value: string) { this.attributes.set(key, value); if (key === 'class') this.className = value; }
  getAttribute(key: string) { return this.attributes.get(key) ?? null; }
  hasAttribute(key: string) { return this.attributes.has(key); }
  removeAttribute(key: string) { this.attributes.delete(key); }
  toggleAttribute(key: string, force: boolean) { if (force) this.attributes.set(key, ''); else this.attributes.delete(key); }
  addEventListener(event: string, listener: () => void) { this.listeners.set(event, [...this.listeners.get(event) ?? [], listener]); }
  dispatch(event: string) { this.listeners.get(event)?.forEach(listener => listener()); }
  click() { this.dispatch('click'); }
  focus() { this.document.activeElement = this; }
  classes(): string[] { return this.className.split(/\s+/).filter(Boolean); }
  matches(simple: string): boolean {
    let selector = simple;
    const nots: string[] = [];
    selector = selector.replace(/:not\(([^)]+)\)/g, (_, inner: string) => { nots.push(inner); return ''; });
    const attr = selector.match(/\[([a-z-]+)="([^"]+)"\]/);
    if (attr) selector = selector.replace(attr[0], '');
    const parts = selector.split('.');
    const tag = parts[0];
    const classes = parts.slice(1);
    if (tag && tag !== this.tagName) return false;
    if (!classes.every(cls => this.classes().includes(cls))) return false;
    if (attr && this.getAttribute(attr[1]) !== attr[2]) return false;
    return nots.every(not => !this.matches(not));
  }
  all(): Node_[] { return [this, ...this.nodes.flatMap(node => node.all())]; }
  querySelectorAll(selector: string): Node_[] {
    const [first, second] = selector.split(' ');
    const heads = this.all().filter(node => node !== this && node.matches(first));
    if (!second) return heads;
    return heads.flatMap(head => head.all().filter(node => node !== head && node.matches(second)));
  }
  querySelector(selector: string): Node_ | null { return this.querySelectorAll(selector)[0] ?? null; }
}

class Doc {
  activeElement: Node_ | null = null;
  readonly body = new Node_('body', this);
  createElement(tag: string) { return new Node_(tag, this); }
  createElementNS(_ns: string, tag: string) { return new Node_(tag, this); }
}

function doc(): Document { return new Doc() as unknown as Document; }

describe('careerJobView', () => {
  it('words the subtitle, the facts grid and the streak line', () => {
    const view = careerJobView('Senior clerk', 'Office', 'Day shift, Monday to Friday, 06:00 to 14:00', report(), FACTORS, WEEKS);
    expect(view.subtitle).toBe('Office path, level 2 of 4');
    expect(view.facts).toEqual([
      { label: 'Shift', value: 'Day shift, Monday to Friday, 06:00 to 14:00', wide: true },
      { label: 'Pay', value: '$170 per shift' },
      { label: 'Pay range at this level', value: '$160 to $200' },
      { label: 'This week', value: '2 shifts, scoring 72' },
      { label: 'Last review', value: '80 of 100' },
      { label: 'Promotion', value: '2 of 3 good weeks in a row', wide: true },
    ]);
    expect(view.streaks).toBe('Good weeks in a row: 2.');
    expect(view.warning).toBeNull();
    expect(view.nightNote).toBeNull();
    expect(view.trend).toBe(0);
    expect(view.thresholds).toEqual({ poor: 40, good: 65 });
    expect(view.weeks.map(week => week.performance)).toEqual(WEEKS.map(week => week.performance));
  });

  it('words a fresh job, a warning, the top of the path and the trends', () => {
    const fresh = careerJobView('Lowly barista', 'Cafe', 'Lowly barista', report({ shifts: 0, mean: null, last: null, good: 0, level: 0 }), null, []);
    const value = (view: typeof fresh, label: string) => view.facts.find(fact => fact.label === label)?.value;
    expect(value(fresh, 'This week')).toBe('No shifts yet');
    expect(value(fresh, 'Last review')).toBe('None yet');
    expect(value(fresh, 'Promotion')).toBe('0 of 3 good weeks in a row');
    expect(fresh.streaks).toBe('No streak running.');
    expect(fresh.inputs).toEqual([]);
    expect(fresh.subtitle).toBe('Cafe path, level 1 of 4');
    const warned = careerJobView('t', 'p', 's', report({ poor: 2, good: 0, warned: true, trend: -1 }), FACTORS, WEEKS);
    expect(warned.warning).toBe(CAREER_WARNING);
    expect(warned.streaks).toBe('Poor weeks in a row: 2.');
    expect(warned.trend).toBe(-1);
    const top = careerJobView('t', 'p', 's', report({ level: 3, trend: 1, advanceWeeks: 1 }), FACTORS, WEEKS);
    expect(value(top, 'Promotion')).toBe('At the top of this path');
    expect(top.trend).toBe(1);
    const one = careerJobView('t', 'p', 's', report({ shifts: 1, mean: 50, advanceWeeks: 1, good: 1 }), FACTORS, WEEKS);
    expect(value(one, 'This week')).toBe('1 shift, scoring 50');
    expect(value(one, 'Promotion')).toBe('1 of 1 good week in a row');
  });
});

describe('Score inputs', () => {
  const rows = (factors: Partial<CareerFactors>, last: Partial<CareerShiftInputs> | null = { mood: 0.18 }) =>
    careerInputRows({ ...FACTORS, ...factors },
      last === null ? null : { fit: 0, traitFit: 0, socialCapacity: 0, mastery: 0, mood: 0, missedMinutes: 0, attended: true, ...last });
  const named = (list: ReturnType<typeof rows>, name: string) => list.find(row => row.name.startsWith(name))!;

  it('lists the five inputs, each with its name, hint, value and effect', () => {
    expect(rows({ fit: 0.4, traitFit: 0.4, socialCapacity: 0.62, socialDemand: 0.3, mastery: 0.41 })).toEqual([
      { name: 'Fit', hint: '(from -1 to 1)', value: '+0.40', effect: 'help' },
      { name: 'Trait fit', hint: '(part of fit)', value: '+0.40', effect: 'help' },
      { name: 'Social capacity 62%', hint: '(job needs 30%)', value: '', effect: 'none' },
      { name: 'Skill mastery', hint: '(50% is neutral)', value: '41%', effect: 'hurt' },
      { name: 'Mood on the last shift', hint: '', value: '+0.18', effect: 'help' },
    ]);
  });

  it('says Helps above zero, Hurts below and No effect at zero after rounding to two decimals', () => {
    for (const key of ['fit', 'traitFit'] as const) {
      const name = key === 'fit' ? 'Fit' : 'Trait fit';
      expect(named(rows({ [key]: 0.01 }), name).effect, `${key} above`).toBe('help');
      expect(named(rows({ [key]: -0.01 }), name).effect, `${key} below`).toBe('hurt');
      expect(named(rows({ [key]: 0 }), name).effect, `${key} at zero`).toBe('none');
      expect(named(rows({ [key]: 0.004 }), name).effect, `${key} rounds to zero`).toBe('none');
      expect(named(rows({ [key]: -0.004 }), name).value, `${key} never reads -0.00`).toBe('+0.00');
    }
    expect(named(rows({}, { mood: 0.2 }), 'Mood').effect).toBe('help');
    expect(named(rows({}, { mood: -0.2 }), 'Mood').effect).toBe('hurt');
    expect(named(rows({}, { mood: 0 }), 'Mood').effect).toBe('none');
  });

  it('judges skill mastery against 50% and social capacity against the job demand', () => {
    expect(named(rows({ mastery: 0.51 }), 'Skill').effect).toBe('help');
    expect(named(rows({ mastery: 0.5 }), 'Skill').effect).toBe('none');
    expect(named(rows({ mastery: 0.49 }), 'Skill').effect).toBe('hurt');
    expect(named(rows({ socialCapacity: 0.3, socialDemand: 0.3 }), 'Social').effect, 'at the demand').toBe('none');
    expect(named(rows({ socialCapacity: 0.29, socialDemand: 0.3 }), 'Social').effect, 'below it').toBe('hurt');
    expect(named(rows({ socialCapacity: 0.29, socialDemand: 0.3 }), 'Social').value, 'no value column').toBe('');
  });

  it('shows No shift yet for the mood row before any shift is scored', () => {
    const mood = named(rows({}, null), 'Mood');
    expect(mood).toEqual({ name: 'Mood on the last shift', hint: '', value: 'No shift yet', effect: null });
  });
});

describe('the Go to work box', () => {
  const window120 = (state: GoToWorkStatus['state'], overrides: Partial<GoToWorkStatus> = {}): GoToWorkStatus =>
    ({ state, startTick: 360, endTick: 840, opensTick: 240, ...overrides });
  const context = (overrides: Partial<Parameters<typeof careerWorkView>[1]> = {}) =>
    ({ now: 280, dayTicks: 1440, weekday: 1, shiftKind: 0, schedule: 'Day shift, Monday to Friday, 06:00 to 14:00', ...overrides });
  const view = (status: GoToWorkStatus | null, overrides = {}): CareerWorkView | null => careerWorkView(status, context(overrides));

  it('words durations and the window', () => {
    expect([1, 35, 60, 80, 120, 121].map(careerDurationWords)).toEqual(
      ['1 minute', '35 minutes', '1 hour', '1 hour 20 minutes', '2 hours', '2 hours 1 minute']);
    expect(careerDurationWords(0)).toBe('less than a minute');
    expect([120, 60, 180, 90, 45].map(careerWindowWords)).toEqual(['two hours', '1 hour', '3 hours', '90 minutes', '45 minutes']);
  });

  it('shows nothing without a job or a readable status', () => {
    expect(view(null)).toBeNull();
    expect(view({ state: 'none', startTick: null, endTick: null, opensTick: null })).toBeNull();
  });

  it('offers the command before a shift that starts within the window', () => {
    expect(view(window120('due'))).toEqual({
      state: 'due', enabled: true, late: false,
      text: 'Day shift starts at 06:00, in 1 hour 20 minutes.',
      note: 'Stops what they are doing and leaves now, even with low needs.',
    });
  });

  it('offers the command in the late style after the shift has started', () => {
    expect(view(window120('late'), { now: 395 })).toEqual({
      state: 'late', enabled: true, late: true,
      text: 'Started at 06:00, 35 minutes ago. Time before they arrive counts as missed work.',
      note: 'Stops what they are doing and leaves now, even with low needs.',
    });
  });

  it('disables the command and says when it opens before a shift that is too far away', () => {
    // Wednesday: two days after the Monday... the clock reads weekday 0 here.
    const status = window120('early', { startTick: 2 * 1440 + 360, endTick: 2 * 1440 + 840, opensTick: 2 * 1440 + 240 });
    expect(view(status, { now: 100, weekday: 0 })).toEqual({
      state: 'early', enabled: false, late: false,
      text: 'Next shift: Wednesday, 06:00 to 14:00.',
      note: 'Go to work becomes available at 04:00, two hours before the shift.',
    });
    expect(view({ state: 'early', startTick: null, endTick: null, opensTick: null })).toMatchObject({
      enabled: false, text: 'No shift in the next seven days.', note: 'Day shift, Monday to Friday, 06:00 to 14:00' });
  });

  it('wraps the weekday past Sunday and words a short window in hours', () => {
    const status = window120('early', { startTick: 1440 + 360, endTick: 1440 + 840, opensTick: 1440 + 300 });
    const early = view(status, { now: 100, weekday: 6 });
    expect(early?.text).toBe('Next shift: Monday, 06:00 to 14:00.');
    expect(early?.note).toBe('Go to work becomes available at 05:00, 1 hour before the shift.');
  });

  it('shows where the person is when the command does not apply', () => {
    expect(view({ state: 'atWork', startTick: null, endTick: 840, opensTick: null })).toEqual({
      state: 'atWork', enabled: false, late: false, text: 'At work until 14:00.', note: 'Day shift, Monday to Friday, 06:00 to 14:00' });
    expect(view({ state: 'outbound', startTick: null, endTick: null, opensTick: null })).toMatchObject({
      enabled: false, text: 'On the way to work.' });
    expect(view({ state: 'inbound', startTick: null, endTick: null, opensTick: null })).toMatchObject({
      enabled: false, text: 'On the way home.' });
  });

  it('starts the line with Shift when the shift kind has no name', () => {
    expect(view(window120('due'), { shiftKind: null })?.text).toBe('Shift starts at 06:00, in 1 hour 20 minutes.');
  });
});

function panel(source: Source, active = () => true) {
  const states: CareerPanelState[] = [];
  const controller = new CareerPanel(source, state => states.push(state), 100, active);
  return { controller, states, last: () => states[states.length - 1] };
}

describe('CareerPanel', () => {
  it('reads the job on demand and words an unemployed or unreadable person', () => {
    const source = new Source();
    const { controller, last } = panel(source);
    controller.update(0, true);
    expect(last().job?.title).toBe('Senior clerk');
    expect(last().job?.pathLabel).toBe('Office');
    expect(last().paths).toEqual(source.paths);
    source.title = null;
    controller.update(50);
    expect(last().job?.title, 'inside the refresh interval nothing is read').toBe('Senior clerk');
    controller.update(200);
    expect(last().job).toBeNull();
    expect(last().unavailable).toBe(false);
    source.title = 'Senior clerk';
    source.report_ = null;
    controller.update(400);
    expect(last().unavailable).toBe(true);
    source.report_ = report({ path: 9 });
    controller.update(600);
    expect(last().unavailable, 'a path the labels do not have').toBe(true);
  });

  it('does not read while inactive and reads at once when the selection changes', () => {
    const source = new Source();
    let active = false;
    const { controller, last, states } = panel(source, () => active);
    controller.update(0);
    expect(states, 'the new selection shows at once, unread').toHaveLength(1);
    expect(last().job).toBeNull();
    controller.update(50);
    expect(states, 'nothing is read while hidden').toHaveLength(1);
    active = true;
    controller.update(50);
    expect(last().job).not.toBeNull();
    source.selected = 8;
    source.title = 'Barista';
    controller.update(10);
    expect(last().agent).toBe(8);
    expect(last().job?.title).toBe('Barista');
  });

  it('assigns a chosen path, reports the drain result and quits', () => {
    const source = new Source();
    const { controller, last } = panel(source);
    controller.update(0, true);
    controller.choose(1);
    expect(last().choice).toBe(1);
    controller.assign();
    expect(source.sent).toEqual([['assign', 7, 1]]);
    expect(last().pending).toBe(true);
    expect(last().status).toBe('Assigning the career…');
    controller.afterCommands();
    expect(last().pending, 'no result yet').toBe(true);
    source.result = { sequence: 1n, agent: 7, reason: null };
    source.title = 'Lowly barista';
    source.report_ = report({ path: 1, level: 0 });
    controller.afterCommands();
    expect(last().pending).toBe(false);
    expect(last().status).toBe('Career assigned.');
    expect(last().job?.title).toBe('Lowly barista');
    controller.quit();
    expect(source.sent).toEqual([['assign', 7, 1], ['quit', 7]]);
    source.result = { sequence: 2n, agent: 7, reason: 'Not while they are at work or on the way.' };
    controller.afterCommands();
    expect(last().status).toBe('Not while they are at work or on the way.');
    source.result = { sequence: 3n, agent: 7, reason: null };
    source.title = null;
    controller.quit();
    expect(last().status).toBe('This person has no job to leave.');
  });

  it('refuses a second command while one is pending and words a refused send', () => {
    const source = new Source();
    const { controller, last } = panel(source);
    controller.update(0, true);
    controller.choose(2);
    controller.assign();
    controller.choose(0);
    expect(last().choice).toBe(2);
    controller.quit();
    expect(source.sent).toHaveLength(1);
    source.result = { sequence: 1n, agent: 9, reason: null };
    controller.afterCommands();
    expect(last().status).toBe('Another career change was handled. Check the current job.');
    source.accept = false;
    controller.choose(1);
    controller.assign();
    expect(last().status).toBe('The career change could not be sent.');
    expect(last().pending).toBe(false);
  });

  it('tells each promotion which title it led to, from the score inputs and the level titles', () => {
    const source = new Source();
    source.history = [
      { week: 0, performance: 70, event: 0 },
      { week: 1, performance: 80, event: 1 },
      { week: 2, performance: 75, event: 0 },
    ];
    const row = (week: number, level: number): CareerInputWeek => ({ week, career: 0, path: 0, level, shifts: 5, attended: 5, fit: 0,
      traitFit: 0, socialCapacity: 0.5, socialDemand: 0.3, mastery: 0.5, mood: 0, missedMinutes: 0, pay: 160 });
    source.inputWeeks = [row(0, 0), row(1, 0), row(2, 1)];
    const { controller, last } = panel(source);
    controller.update(0, true);
    expect(last().job?.weeks[1]).toMatchObject({ event: 1, after: 'Senior clerk' });
    expect(last().job?.weeks[0].after).toBeUndefined();
    source.history = [{ week: 0, performance: 70, event: 2 }];
    controller.update(200);
    expect(last().job?.weeks[0].after, 'a raise names no title').toBeUndefined();
  });

  it('reads the Go to work status with the clock and the held shift', () => {
    const source = new Source();
    source.now = 280;
    source.work = { state: 'due', startTick: 360, endTick: 840, opensTick: 240 };
    const { controller, last } = panel(source);
    controller.update(0, true);
    expect(last().job?.work).toMatchObject({ state: 'due', enabled: true, text: 'Day shift starts at 06:00, in 1 hour 20 minutes.' });
    expect(last().job?.work?.note).toBe('Stops what they are doing and leaves now, even with low needs.');
    source.work = { state: 'atWork', startTick: null, endTick: 840, opensTick: null };
    controller.update(200);
    expect(last().job?.work?.note, 'at work the note is the schedule line').toBe(last().job?.schedule);
    source.work = null;
    controller.update(400);
    expect(last().job?.work, 'an unreadable status hides the box').toBeNull();
  });

  it('sends the person to work as the one pending command and reports what the drain did', () => {
    const source = new Source();
    source.work = { state: 'due', startTick: 360, endTick: 840, opensTick: 240 };
    const { controller, last } = panel(source);
    controller.update(0, true);
    controller.goToWork();
    expect(source.sent).toEqual([['work', 7]]);
    expect(last().pending).toBe(true);
    expect(last().status).toBe('Sending them to work…');
    controller.quit();
    expect(source.sent, 'a second command waits for the first').toHaveLength(1);
    source.result = { sequence: 1n, agent: 7, reason: null };
    source.work = { state: 'outbound', startTick: null, endTick: null, opensTick: null };
    controller.afterCommands();
    expect(last().pending).toBe(false);
    expect(last().status).toBe('Left for work.');
    expect(last().job?.work?.text).toBe('On the way to work.');
    controller.goToWork();
    source.result = { sequence: 2n, agent: 7, reason: 'Their next shift is more than two hours away.' };
    controller.afterCommands();
    expect(last().status).toBe('Their next shift is more than two hours away.');
  });

  it('words a refused Go to work send and a person without a job', () => {
    const source = new Source();
    const { controller, last } = panel(source);
    controller.update(0, true);
    source.accept = false;
    controller.goToWork();
    expect(last().status).toBe('The career change could not be sent.');
    expect(last().pending).toBe(false);
    source.accept = true;
    source.title = null;
    controller.goToWork();
    expect(last().status).toBe('This person has no job.');
    expect(source.sent, 'nothing more was sent').toEqual([['work', 7]]);
  });

  it("reads and sets the person's job search, employed or not", () => {
    const source = new Source();
    const { controller, last } = panel(source);
    controller.update(0, true);
    expect(last().jobSearch).toBe(true);
    controller.setJobSearch(false);
    expect(source.sent).toEqual([['search', 7, false]]);
    expect(last().jobSearch, 'shown as sent until the drain runs').toBe(false);
    controller.update(200);
    expect(last().jobSearch, 'a read before the drain keeps the sent value').toBe(false);
    source.search = false;
    controller.afterCommands();
    expect(last().jobSearch).toBe(false);
    source.title = null;
    source.search = true;
    controller.update(400);
    expect(last().job).toBeNull();
    expect(last().jobSearch, 'read for the unemployed too').toBe(true);
    source.accept = false;
    controller.setJobSearch(false);
    expect(last().status).toBe('The setting could not be sent.');
    expect(last().jobSearch).toBe(true);
    source.selected = null;
    controller.update(600);
    expect(last().jobSearch).toBeNull();
    controller.setJobSearch(true);
    expect(source.sent).toHaveLength(2);
  });

  it('forgets everything after a load', () => {
    const source = new Source();
    const { controller, last } = panel(source);
    controller.update(0, true);
    controller.choose(1);
    controller.assign();
    source.selected = null;
    controller.resetAfterLoad();
    expect(last()).toMatchObject({ agent: null, job: null, choice: null, pending: false, status: '' });
  });
});

describe('career panel surface', () => {
  function build() {
    const document = new Doc();
    const section = document.createElement('section');
    const empty = document.createElement('p');
    const content = document.createElement('div');
    const rowTitle = document.createElement('span');
    const rowInfo = document.createElement('button');
    const rowGraph = document.createElement('div');
    section.append(empty, content);
    document.body.append(section, rowTitle, rowInfo, rowGraph);
    const actions = { chosen: [] as (number | null)[], assigned: 0, quit: 0, search: [] as boolean[], work: 0,
      review: [] as unknown[] };
    const handlers: CareerPanelActions = { choose: path => actions.chosen.push(path), assign: () => { actions.assigned += 1; },
      quit: () => { actions.quit += 1; }, setJobSearch: search => actions.search.push(search),
      goToWork: () => { actions.work += 1; }, openReviewGraph: sender => actions.review.push(sender) };
    const render = createCareerPanelSurface(document as unknown as Document, {
      section: section as unknown as HTMLElement, empty: empty as unknown as HTMLElement, content: content as unknown as HTMLElement,
      rowTitle: rowTitle as unknown as HTMLElement, rowInfo: rowInfo as unknown as HTMLButtonElement,
      rowGraph: rowGraph as unknown as HTMLElement,
    }, handlers);
    return { section, empty, content, rowTitle, rowInfo, rowGraph, render, actions, document };
  }

  const employed = (overrides: Partial<CareerPanelState> = {}): CareerPanelState => ({
    agent: 7, unavailable: false, paths: ['Office', 'Cafe'], choice: null, pending: false, status: '', jobSearch: true,
    job: careerJobView('Senior clerk', 'Office', 'Senior clerk, Monday to Friday, 06:00 to 14:00', report({ trend: 1 }), FACTORS, WEEKS),
    ...overrides,
  });

  it('lays the tab out in the approved order with the trend, the facts and the controls for a held job', () => {
    const { section, content, rowTitle, render, actions } = build();
    render(employed());
    expect(section.dataset.state).toBe('employed');
    expect(content.querySelector('.career-title')?.textContent).toBe('Senior clerk');
    expect(content.querySelector('.career-title')?.dataset.trend).toBe('up');
    expect(rowTitle.dataset.trend).toBe('up');
    expect(content.querySelector('.career-sub')?.textContent).toBe('Office path, level 2 of 4');
    const order = content.nodes.map(node => node.classes()[0] ?? node.tagName);
    const at = (name: string) => order.indexOf(name);
    expect(order.slice(0, 4), 'heading, subtitle, Go to work box, facts').toEqual(
      ['career-heading', 'career-sub', 'career-work', 'career-facts']);
    expect(at('career-attendance')).toBeGreaterThan(at('career-facts'));
    expect(at('career-inputs-heading')).toBeGreaterThan(at('career-attendance'));
    expect(at('career-graph-heading')).toBeGreaterThan(at('career-inputs'));
    expect(at('career-graph-wrap')).toBeGreaterThan(at('career-graph-heading'));
    expect(at('career-streaks')).toBeGreaterThan(at('career-graph-wrap'));
    expect(at('career-warning')).toBeGreaterThan(at('career-graph-wrap'));
    expect(at('career-controls'), 'Assign a career comes after the graph').toBeGreaterThan(at('career-warning'));
    expect(at('career-shift-change')).toBeGreaterThan(at('career-controls'));
    expect(at('career-search')).toBeGreaterThan(at('career-shift-change'));
    const facts = content.querySelectorAll('.career-facts div');
    expect(facts.map(fact => fact.nodes.map(node => node.textContent))).toEqual([
      ['Shift', 'Senior clerk, Monday to Friday, 06:00 to 14:00'],
      ['Pay', '$170 per shift'],
      ['Pay range at this level', '$160 to $200'],
      ['This week', '2 shifts, scoring 72'],
      ['Last review', '80 of 100'],
      ['Promotion', '2 of 3 good weeks in a row'],
    ]);
    expect(facts[0].classes(), 'the Shift row spans both columns').toContain('career-fact-wide');
    expect(facts[1].classes()).not.toContain('career-fact-wide');
    expect(content.querySelector('.career-warning')?.hidden).toBe(true);
    expect(content.querySelector('.career-inputs-heading')?.textContent).toBe('Score inputs');
    expect(content.querySelector('.career-graph-wrap')?.hidden).toBe(false);
    expect(content.querySelectorAll('.career-graph .career-mark')).toHaveLength(4);
    expect(content.querySelector('.career-graph')?.getAttribute('role'), 'a group the keyboard can enter').toBe('group');
    expect(content.querySelector('.career-legend')?.hidden).toBe(false);
    const select = content.querySelector('select')!;
    expect(select.options.map(option => option.textContent)).toEqual(['Choose a path', 'Office', 'Cafe']);
    const [assign, quit] = content.querySelectorAll('.career-actions button');
    expect(quit.disabled).toBe(false);
    expect(assign.getAttribute('data-action-intent')).toBe('affirmative');
    expect(quit.getAttribute('data-action-intent')).toBe('destructive');
    expect(assign.disabled).toBe(true);
    select.value = '1';
    select.dispatch('change');
    expect(actions.chosen).toEqual([1]);
    assign.click();
    quit.click();
    expect([actions.assigned, actions.quit]).toEqual([1, 1]);
    render(employed({ choice: 1 }));
    expect(assign.disabled).toBe(false);
    expect(select.value).toBe('1');
  });

  it('draws no second copy of the graph in the tab and no expanding control', () => {
    const { content, render } = build();
    render(employed());
    expect(content.querySelector('.career-graph-mini')).toBeNull();
    expect(content.querySelectorAll('svg')).toHaveLength(1);
    expect(content.querySelectorAll('.career-graph')).toHaveLength(1);
    const info = content.querySelector('.career-info')!;
    expect(info.hasAttribute('aria-expanded'), 'it opens a window, it does not expand').toBe(false);
    expect(info.getAttribute('aria-controls')).toBe('career-graph-dialog');
    expect(info.getAttribute('aria-haspopup')).toBe('dialog');
    expect(INDEX_HTML).not.toContain('career-tab-mini-graph');
  });

  it('opens the review window from the i, which names itself and shows a tooltip', () => {
    const { content, render, actions } = build();
    render(employed());
    const info = content.querySelector('.career-info')!;
    expect(info.textContent).toBe('i');
    expect(info.getAttribute('aria-label')).toBe('Open the review graph. Pauses the game.');
    const tip = content.querySelector('.career-info-tip')!;
    expect(tip.textContent).toBe('Open the review graph. Pauses the game.');
    expect(tip.getAttribute('role')).toBe('tooltip');
    expect(tip.parent, 'the tooltip sits beside the i so hover and focus can show it').toBe(info.parent);
    expect(info.hidden).toBe(false);
    info.click();
    expect(actions.review).toEqual([info]);
    expect(INDEX_HTML).toContain('.career-info:focus-visible');
    expect(INDEX_HTML).toContain('.career-info:hover + .career-info-tip');
    expect(INDEX_HTML).toContain('.career-info:focus-visible + .career-info-tip');
  });

  it('renders the facts, the Score inputs rows and the night note', () => {
    const { content, render } = build();
    const job = careerJobView('Guard', 'Night watch', 'Night shift, Sunday to Thursday, 22:00 to 06:00', report(), FACTORS, WEEKS,
      { percent: 15, cents: 12_075 }, { fit: 0, traitFit: 0, socialCapacity: 0.7, mastery: 0.25, mood: -0.1, missedMinutes: 0, attended: true });
    render(employed({ job }));
    expect(content.querySelector('.career-night')?.textContent).toBe('Night shifts pay 15% more: $120.75 per shift.');
    expect(content.querySelector('.career-night')?.hidden).toBe(false);
    const rows = content.querySelectorAll('.career-inputs div');
    expect(rows).toHaveLength(5);
    const cell = (row: (typeof rows)[number], selector: string) => row.querySelector(selector)?.textContent;
    expect(rows.map(row => [cell(row, '.career-input-name'), cell(row, '.career-hint') ?? '', cell(row, '.career-input-value'),
      cell(row, '.career-effect')])).toEqual([
      ['Fit ', '(from -1 to 1)', '+0.40', 'Helps'],
      ['Trait fit ', '(part of fit)', '+0.40', 'Helps'],
      ['Social capacity 70% ', '(job needs 30%)', '', 'No effect'],
      ['Skill mastery ', '(50% is neutral)', '25%', 'Hurts'],
      ['Mood on the last shift', '', '-0.10', 'Hurts'],
    ]);
    expect(rows.map(row => row.querySelector('.career-effect')?.dataset.effect)).toEqual(['help', 'help', 'none', 'hurt', 'hurt']);
    render(employed());
    expect(content.querySelector('.career-night')?.hidden, 'no night premium for a day worker').toBe(true);
  });

  it('shows the Go to work box in each state and sends the command from its button', () => {
    const { content, render, actions } = build();
    const work = (view: CareerWorkView | null) => employed({ job: { ...employed().job!, work: view } });
    const box = () => content.querySelector('.career-work')!;
    const button = () => box().querySelector('button')!;
    render(work(null));
    expect(box().hidden, 'no shift, no box').toBe(true);
    render(work({ state: 'due', enabled: true, late: false, text: 'Day shift starts at 06:00, in 1 hour 20 minutes.',
      note: 'Stops what they are doing and leaves now, even with low needs.' }));
    expect(box().hidden).toBe(false);
    expect(button().textContent).toBe('Go to work');
    expect(button().getAttribute('data-action-intent')).toBe('affirmative');
    expect(button().disabled).toBe(false);
    expect(box().querySelector('.career-work-text')?.textContent).toBe('Day shift starts at 06:00, in 1 hour 20 minutes.');
    expect(box().querySelector('.career-work-note')?.textContent).toBe('Stops what they are doing and leaves now, even with low needs.');
    expect(box().querySelector('.career-work-text')?.classes()).not.toContain('career-work-late');
    button().click();
    expect(actions.work).toBe(1);
    render(work({ state: 'late', enabled: true, late: true, text: 'Started at 06:00, 35 minutes ago. Time before they arrive counts as missed work.',
      note: 'Stops what they are doing and leaves now, even with low needs.' }));
    expect(box().querySelector('.career-work-text')?.classes(), 'the late style').toContain('career-work-late');
    expect(button().disabled).toBe(false);
    render(work({ state: 'early', enabled: false, late: false, text: 'Next shift: Wednesday, 06:00 to 14:00.',
      note: 'Go to work becomes available at 04:00, two hours before the shift.' }));
    expect(button().disabled).toBe(true);
    expect(button().textContent, 'the label does not change when disabled').toBe('Go to work');
    expect(box().querySelector('.career-work-text')?.classes()).not.toContain('career-work-late');
    render(work({ state: 'due', enabled: true, late: false, text: 't', note: 'n' }));
    render({ ...work({ state: 'due', enabled: true, late: false, text: 't', note: 'n' }), pending: true, status: 'Sending them to work…' });
    expect(button().disabled, 'one command at a time').toBe(true);
    expect(content.querySelector('p[role="status"]')?.textContent).toBe('Sending them to work…');
    render({ ...work({ state: 'due', enabled: true, late: false, text: 't', note: 'n' }), unavailable: true });
    expect(button().disabled).toBe(true);
  });

  it('hands focus from Go to work to the button when it can be used again, else to the box', () => {
    const { section, content, document, render } = build();
    const due: CareerWorkView = { state: 'due', enabled: true, late: false, text: 't', note: 'n' };
    const out: CareerWorkView = { state: 'outbound', enabled: false, late: false, text: 'On the way to work.', note: 'n' };
    const state = (view: CareerWorkView, overrides: Partial<CareerPanelState> = {}) =>
      employed({ job: { ...employed().job!, work: view }, ...overrides });
    render(state(due));
    const box = content.querySelector('.career-work')!;
    const button = box.querySelector('button')!;
    button.focus();
    button.click();
    render(state(due, { pending: true, status: 'Sending them to work…' }));
    expect(document.activeElement, 'a disabled button cannot keep focus').toBe(section);
    render(state(out, { status: 'Left for work.' }));
    expect(document.activeElement, 'the button is disabled now, so the box takes focus').toBe(box);
    expect(box.getAttribute('tabindex')).toBe('-1');
    render(state(due));
    button.focus();
    button.click();
    render(state(due, { pending: true, status: 'Sending them to work…' }));
    render(state(due, { status: 'Their next shift is more than two hours away.' }));
    expect(document.activeElement, 'a refused send keeps the button').toBe(button);
    section.focus();
    render(state(due));
    expect(document.activeElement, 'focus the player moved elsewhere is left alone').toBe(section);
  });

  it('words the warning, a job without reviews, the unemployed, the unavailable and the pending states', () => {
    const { section, empty, content, rowTitle, rowInfo, render } = build();
    render(employed({ job: careerJobView('t', 'p', 's', report({ warned: true, trend: -1 }), FACTORS, []) }));
    expect(content.querySelector('.career-warning')?.textContent).toBe(CAREER_WARNING);
    expect(content.querySelector('.career-warning')?.hidden).toBe(false);
    expect(content.querySelector('.career-title')?.dataset.trend).toBe('down');
    expect(content.querySelector('.career-graph-wrap')?.hidden).toBe(true);
    expect(content.querySelector('.career-no-reviews')?.hidden).toBe(false);
    expect(content.querySelector('.career-info')?.hidden, 'no reviewed week, no i').toBe(true);
    expect(content.querySelector('.career-info-tip')?.hidden).toBe(true);
    expect(rowInfo.hidden).toBe(true);
    render(employed({ job: null }));
    expect(section.dataset.state).toBe('unemployed');
    expect(empty.textContent).toBe('Unemployed. Choose a path below to assign one.');
    expect(empty.hidden).toBe(false);
    const [, quit] = content.querySelectorAll('.career-actions button');
    expect(quit.disabled).toBe(true);
    expect(rowTitle.dataset.trend).toBe('level');
    render(employed({ job: null, unavailable: true }));
    expect(empty.textContent).toBe('Career unavailable.');
    expect(content.querySelector('fieldset')!.disabled).toBe(true);
    render(employed({ agent: null, job: null }));
    expect(empty.textContent).toBe('Select a person to see their career.');
    render(employed({ pending: true, status: 'Assigning the career…', choice: 1 }));
    expect(content.querySelector('fieldset')!.disabled).toBe(true);
    expect(content.querySelector('p[role="status"]')?.textContent).toBe('Assigning the career…');
    expect(content.querySelector('select')!.value).toBe('1');
  });

  it("offers the job search box for any selected person and sends the player's choice", () => {
    const { content, document, render, actions } = build();
    render(employed());
    const box = content.querySelector('.career-search input')!;
    expect(box.type).toBe('checkbox');
    const label = box.parent!;
    expect(label.tagName).toBe('label');
    expect(label.querySelector('span')?.textContent).toBe('Look for work automatically when unemployed');
    expect(label.hidden).toBe(false);
    expect(box.checked).toBe(true);
    expect(box.disabled).toBe(false);
    box.checked = false;
    box.dispatch('change');
    expect(actions.search).toEqual([false]);
    render(employed({ job: null, jobSearch: false }));
    expect(box.checked).toBe(false);
    expect(label.hidden).toBe(false);
    box.focus();
    render(employed({ job: null, jobSearch: false, pending: true, status: 'Assigning the career…', choice: 1 }));
    expect(box.disabled, 'a pending assignment leaves the setting alone').toBe(false);
    expect(document.activeElement, 'and keeps its focus').toBe(box);
    render(employed({ agent: null, job: null, jobSearch: null }));
    expect(label.hidden).toBe(true);
    expect(box.disabled).toBe(true);
  });

  it('takes focus back to the path list once a command settles', () => {
    const { section, content, document, render } = build();
    render(employed({ choice: 1 }));
    const select = content.querySelector('select')!;
    select.focus();
    render(employed({ pending: true, status: 'Assigning the career…', choice: 1 }));
    expect(document.activeElement).toBe(section);
    render(employed({ choice: 1, status: 'Career assigned.' }));
    expect(document.activeElement).toBe(select);
  });

  it('takes focus back to the button that sent the command, or its nearest usable control', () => {
    const { section, content, document, render } = build();
    render(employed({ choice: 1 }));
    const [assign, quit] = content.querySelectorAll('.career-actions button');
    assign.focus();
    assign.click();
    render(employed({ pending: true, status: 'Assigning the career…', choice: 1 }));
    expect(document.activeElement).toBe(section);
    render(employed({ choice: 1, status: 'Career assigned.' }));
    expect(document.activeElement, 'Assign is still usable').toBe(assign);
    quit.focus();
    quit.click();
    render(employed({ pending: true, status: 'Leaving the job…' }));
    render(employed({ job: null, status: 'Job left.' }));
    expect(document.activeElement, 'Quit is disabled without a job').toBe(content.querySelector('select'));
  });

  it('is wired into the sheet, the Overview row and the Options flyout', () => {
    expect(INDEX_HTML).toContain('data-open-sim-panel="career"');
    expect(INDEX_HTML).toContain('id="sim-career"');
    expect(INDEX_HTML).toContain('id="career-info"');
    expect(INDEX_HTML).toContain('id="career-row-graph"');
    expect(INDEX_HTML).toContain('id="career-autonomous-change"');
    expect(INDEX_HTML, 'job search is set for each person in the Career tab').not.toContain('career-autonomous-search');
    expect(MAIN_TS).toContain('createCareerPanelSurface(');
    expect(MAIN_TS).toContain('goToWork: () => careerPanel.goToWork()');
    expect(MAIN_TS).toContain('openReviewGraph:');
    expect(MAIN_TS).toContain('careerPanel.afterCommands()');
    expect(MAIN_TS).toContain('careerPanel.resetAfterLoad()');
    expect(MAIN_TS).toContain('new CareerAutonomyControls(');
  });
});

describe('shift selectors (issue 296, [WS-shell] items 3 to 5)', () => {
  it('words each offered shift with its chance, most likely first and ties in authored order', () => {
    expect(careerShiftOptions(OFFICE_SHIFTS, 1440)).toEqual([
      { index: 0, text: 'Day shift, Monday to Friday, 06:00 to 14:00, 95% chance' },
      { index: 1, text: 'Late shift, Monday to Friday, 12:00 to 20:00, 5% chance' },
    ]);
    expect(careerShiftOptions(WATCH_SHIFTS, 1440).map(option => [option.index, option.text.split(', ').pop()]))
      .toEqual([[0, '40% chance'], [1, '40% chance'], [2, '20% chance']]);
    expect(careerShiftOptions([shift(0, 9, 360, 31, 1)], 1440)).toEqual([
      { index: 0, text: 'Monday to Friday, 06:00 to 14:00, 100% chance' },
    ]);
    expect(careerShiftOptions(WATCH_SHIFTS, 1440, 'change').map(option => option.text), 'a change is chosen, not drawn').toEqual([
      'Night shift, Sunday to Thursday, 22:00 to 06:00',
      'Night shift, Wednesday to Sunday, 22:00 to 06:00',
      'Late shift, Monday to Friday, 14:00 to 22:00',
    ]);
    expect(careerShiftOptions([shift(0, 0, 360, 31, 1), shift(1, 2, 720, 31, 3), shift(2, 3, 1320, 31, 2)], 1440)
      .map(option => option.index), 'a likelier later shift comes first').toEqual([1, 2, 0]);
    expect(careerShiftOptions([], 1440)).toEqual([]);
  });

  it('offers By chance and each shift when assigning', () => {
    const source = new Source();
    source.title = null;
    const { controller, last } = panel(source);
    controller.update(0, true);
    expect(last().assignShifts).toEqual([]);
    controller.choose(1);
    expect(last().shiftChoice).toBeNull();
    expect(last().assignShifts?.map(option => option.text)).toEqual([
      'Early shift, Monday to Friday, 06:00 to 14:00, 50% chance',
      'Day shift, Wednesday to Sunday, 09:00 to 17:00, 30% chance',
      'Late shift, Friday to Tuesday, 13:00 to 21:00, 20% chance',
    ]);
    controller.chooseShift(2);
    expect(last().shiftChoice).toBe(2);
    controller.chooseShift(7);
    expect(last().shiftChoice, 'a shift the path does not offer is By chance').toBeNull();
    controller.chooseShift(1);
    controller.choose(2);
    expect(last().shiftChoice, 'a new path starts at By chance, though it lists the same index').toBeNull();
    controller.chooseShift(2);
    controller.choose(0);
    expect(last().shiftChoice).toBeNull();
    expect(last().assignShifts?.map(option => option.index)).toEqual([0, 1]);
    controller.choose(1);
    controller.assign();
    expect(source.sent.pop()).toEqual(['assign', 7, 1]);
    expect(last().status).toBe('Assigning the career…');
    source.result = { sequence: 1n, agent: 7, reason: null };
    controller.afterCommands();
    expect(last().status).toBe('Career assigned.');
    controller.chooseShift(2);
    controller.assign();
    expect(source.sent.pop()).toEqual(['assignShift', 7, 1, 2]);
  });

  it('changes the shift of an employed person', () => {
    const source = new Source();
    const { controller, last } = panel(source);
    controller.update(0, true);
    expect(last().heldShift).toBe(0);
    expect(last().changeChoice).toBe(0);
    expect(last().heldShifts?.map(option => option.index)).toEqual([0, 1]);
    controller.changeShift();
    expect(source.sent, 'the held shift is not sent').toEqual([]);
    controller.chooseChange(1);
    expect(last().changeChoice).toBe(1);
    controller.changeShift();
    expect(source.sent).toEqual([['change', 7, 1]]);
    expect(last().status).toBe('Changing the shift…');
    expect(last().pending).toBe(true);
    source.heldIndex = 1;
    source.result = { sequence: 1n, agent: 7, reason: null };
    controller.afterCommands();
    expect(last().status).toBe('Shift changed.');
    expect(last().heldShift).toBe(1);
    expect(last().changeChoice).toBe(1);
    for (const reason of ['That shift is not offered at this level.', 'This person has no job.',
      'They already work that shift.', 'Not while they are at work or on the way.']) {
      controller.chooseChange(0);
      controller.changeShift();
      source.result = { sequence: (source.result?.sequence ?? 0n) + 1n, agent: 7, reason };
      controller.afterCommands();
      expect(last().status).toBe(reason);
    }
    source.accept = false;
    controller.chooseChange(0);
    controller.changeShift();
    expect(last().status).toBe('The career change could not be sent.');
  });

  it('follows the held shift when a review, a promotion or a new job moves it', () => {
    const source = new Source();
    const { controller, last } = panel(source);
    controller.update(0, true);
    expect(last().changeChoice).toBe(0);
    // A review or promotion moves the held shift; the player chose nothing.
    source.heldIndex = 1;
    controller.update(100, true);
    expect(last().heldShift).toBe(1);
    expect(last().changeChoice, 'the selector follows the held shift').toBe(1);
    controller.changeShift();
    expect(source.sent, 'and nothing is sent').toEqual([]);
    // A choice the player made survives a read that moves nothing.
    controller.chooseChange(0);
    controller.update(200, true);
    expect(last().changeChoice).toBe(0);
    // An assignment draws a shift with the same index on a new path and level.
    controller.choose(1);
    controller.assign();
    source.title = 'Lowly barista';
    source.report_ = report({ path: 1, level: 0 });
    source.result = { sequence: 1n, agent: 7, reason: null };
    controller.afterCommands();
    expect(last().status).toBe('Career assigned.');
    expect(last().heldShift).toBe(1);
    expect(last().changeChoice, 'the old choice does not carry to the new job').toBe(1);
    // A promotion that keeps the same shift index also drops an unsent choice.
    controller.chooseChange(0);
    source.title = 'Barista';
    source.report_ = report({ path: 1, level: 1 });
    controller.update(300, true);
    expect(last().changeChoice).toBe(1);
  });

  it('shows a retired held shift in the change list', () => {
    const source = new Source();
    source.heldIndex = 4;
    source.heldKind = 2;
    const { controller, last } = panel(source);
    controller.update(0, true);
    expect(last().heldShift).toBe(4);
    expect(last().changeChoice).toBe(4);
    expect(last().heldShifts?.map(option => [option.index, option.text])).toEqual([
      [4, 'Late shift, Monday to Friday, 06:00 to 14:00'],
      [0, 'Day shift, Monday to Friday, 06:00 to 14:00'],
      [1, 'Late shift, Monday to Friday, 12:00 to 20:00'],
    ]);
    expect(heldShiftOptions(OFFICE_SHIFTS, null, 1440)).toHaveLength(2);
    expect(heldShiftOptions(OFFICE_SHIFTS, { workingDays: 31, shiftStart: 360, shiftTicks: 480, kind: 0, index: 1 }, 1440)
      .map(option => option.index), 'an offered held shift is not repeated').toEqual([0, 1]);
    expect(heldShiftOptions(OFFICE_SHIFTS, { workingDays: 0, shiftStart: 360, shiftTicks: 480, kind: 0, index: 4 }, 1440)
      .map(option => option.index), 'unreadable hours leave the list alone').toEqual([0, 1]);
  });

  it('hides the change controls for an unemployed person', () => {
    const source = new Source();
    source.title = null;
    const { controller, last } = panel(source);
    controller.update(0, true);
    expect(last().heldShifts).toEqual([]);
    expect(last().heldShift).toBeNull();
    controller.changeShift();
    expect(source.sent).toEqual([]);
  });

  it('draws both Shift selectors, the Change shift button and the note', () => {
    const document = new Doc();
    const section = document.createElement('section');
    const empty = document.createElement('p');
    const content = document.createElement('div');
    section.append(empty, content);
    document.body.append(section);
    const calls: unknown[][] = [];
    const render = createCareerPanelSurface(document as unknown as Document, {
      section: section as unknown as HTMLElement, empty: empty as unknown as HTMLElement, content: content as unknown as HTMLElement,
    }, { choose: () => {}, assign: () => {}, quit: () => {}, setJobSearch: () => {},
      chooseShift: shift => calls.push(['shift', shift]), chooseChange: shift => calls.push(['changeTo', shift]),
      changeShift: () => calls.push(['change']) });
    const held = careerShiftOptions(OFFICE_SHIFTS, 1440);
    const state = (overrides: Partial<CareerPanelState> = {}): CareerPanelState => ({
      agent: 7, unavailable: false, paths: ['Office', 'Cafe'], choice: null, pending: false, status: '', jobSearch: true,
      job: careerJobView('Office clerk', 'Office', 'Office clerk, Day shift, Monday to Friday, 06:00 to 14:00', report(), FACTORS, WEEKS),
      assignShifts: [], shiftChoice: null, heldShifts: held, heldShift: 0, changeChoice: 0, ...overrides,
    });
    render(state());
    const assignShift = content.querySelector('.career-shift-assign select')!;
    expect(content.querySelector('.career-shift-assign')?.textContent).toBe('Shift');
    expect(assignShift.options.map(option => option.textContent)).toEqual([BY_CHANCE]);
    expect(assignShift.disabled, 'no path chosen').toBe(true);
    const change = content.querySelector('.career-shift-change')!;
    expect(change.hidden).toBe(false);
    expect(change.querySelector('legend')?.textContent).toBe(SHIFT_SCHEDULE);
    const changeLine = change.querySelector('.career-shift-line')!;
    expect(changeLine.textContent, 'the selected shift reads in full beneath the selector').toBe(held[0].text);
    expect(changeLine.hidden).toBe(false);
    expect(changeLine.getAttribute('aria-hidden')).toBe('true');
    const assignLine = content.querySelector('.career-shift-assign')!.parent!.querySelector('.career-shift-line')!;
    expect(assignLine.hidden, 'By chance needs no repeat').toBe(true);
    const changeSelect = change.querySelector('select')!;
    expect(changeSelect.options.map(option => option.textContent)).toEqual(held.map(option => option.text));
    expect(changeSelect.value).toBe('0');
    const button = change.querySelector('.career-change-shift')!;
    expect(button.textContent).toBe(CHANGE_SHIFT);
    expect(button.disabled, 'the held shift is selected').toBe(true);
    const note = change.querySelector('.career-shift-note')!;
    expect(note.textContent).toBe(SHIFT_CHANGE_NOTE);
    expect(note.id).toBe('career-shift-note');
    expect(button.getAttribute('aria-describedby')).toBe(note.id);
    changeSelect.value = '1';
    changeSelect.dispatch('change');
    render(state({ changeChoice: 1 }));
    expect(button.disabled).toBe(false);
    button.click();
    render(state({ choice: 1, assignShifts: careerShiftOptions(CAFE_SHIFTS, 1440), shiftChoice: 2 }));
    expect(assignShift.options.map(option => option.textContent)[0]).toBe(BY_CHANCE);
    expect(assignShift.options).toHaveLength(4);
    expect(assignShift.value).toBe('2');
    expect(assignShift.disabled).toBe(false);
    expect(assignLine.textContent).toBe(careerShiftOptions(CAFE_SHIFTS, 1440).find(option => option.index === 2)!.text);
    expect(assignLine.hidden).toBe(false);
    assignShift.value = '';
    assignShift.dispatch('change');
    expect(calls).toEqual([['changeTo', 1], ['change'], ['shift', null]]);
    render(state({ job: null, heldShifts: [], heldShift: null, changeChoice: null }));
    expect(change.hidden, 'no job, no change controls').toBe(true);
    render(state({ heldShifts: held.slice(0, 1) }));
    expect(change.hidden, 'one shift at the level, nothing to change to').toBe(true);
    render(state({ pending: true, status: 'Changing the shift…' }));
    expect(change.disabled).toBe(true);
  });

  it('takes focus back to the Change shift controls once a change settles', () => {
    const document = new Doc();
    const section = document.createElement('section');
    const empty = document.createElement('p');
    const content = document.createElement('div');
    section.append(empty, content);
    document.body.append(section);
    const render = createCareerPanelSurface(document as unknown as Document, {
      section: section as unknown as HTMLElement, empty: empty as unknown as HTMLElement, content: content as unknown as HTMLElement,
    }, { choose: () => {}, assign: () => {}, quit: () => {}, setJobSearch: () => {}, changeShift: () => {} });
    const held = careerShiftOptions(OFFICE_SHIFTS, 1440, 'change');
    const state = (overrides: Partial<CareerPanelState> = {}): CareerPanelState => ({
      agent: 7, unavailable: false, paths: ['Office', 'Cafe'], choice: null, pending: false, status: '', jobSearch: true,
      job: careerJobView('Office clerk', 'Office', 'Office clerk, Day shift, Monday to Friday, 06:00 to 14:00', report(), FACTORS, WEEKS),
      assignShifts: [], shiftChoice: null, heldShifts: held, heldShift: 0, changeChoice: 1, ...overrides,
    });
    render(state());
    const change = content.querySelector('.career-shift-change')!;
    const button = change.querySelector('.career-change-shift')!;
    button.focus();
    button.click();
    render(state({ pending: true, status: 'Changing the shift…' }));
    expect(document.activeElement).toBe(section);
    render(state({ heldShift: 1, changeChoice: 1, status: 'Shift changed.' }));
    expect(button.disabled, 'the new held shift is selected').toBe(true);
    expect(document.activeElement, 'not the Career path list').toBe(change.querySelector('select'));
    render(state({ heldShift: 1, changeChoice: 0 }));
    button.focus();
    button.click();
    render(state({ heldShift: 1, changeChoice: 0, pending: true, status: 'Changing the shift…' }));
    render(state({ heldShift: 1, changeChoice: 0, status: 'Not while they are at work or on the way.' }));
    expect(document.activeElement, 'a refused change keeps the button').toBe(button);
  });
});

describe('the night premium on the Career tab (issue 298, [WB-panel])', () => {
  it('adds the night pay sentence for a night worker and leaves it out for others', () => {
    expect(nightPayLine({ percent: 15, cents: 12_075 })).toBe('Night shifts pay 15% more: $120.75 per shift.');
    const night = careerJobView('Guard', 'Night watch', 's', report({ pay: 105, payMin: 105, payMax: 128 }), FACTORS, WEEKS,
      { percent: 15, cents: 12_075 });
    expect(night.nightNote).toBe('Night shifts pay 15% more: $120.75 per shift.');
    const day = careerJobView('Guard', 'Night watch', 's', report({ pay: 105, payMin: 105, payMax: 128 }), FACTORS, WEEKS);
    expect(day.nightNote).toBeNull();
    expect(day.facts.find(fact => fact.label === 'Pay')?.value).toBe('$105 per shift');
  });

  it('reads the night pay from the source for the selected person only while they work nights', () => {
    const source = new Source() as Source & { nightPayCentsOf(entity: number): number | null; nightShiftPremiumPercent(): number };
    let night: number | null = null;
    source.nightPayCentsOf = () => night;
    source.nightShiftPremiumPercent = () => 15;
    const { controller, last } = panel(source);
    controller.update(0, true);
    expect(last().job?.nightNote).toBeNull();
    night = 23_000;
    controller.update(200);
    expect(last().job?.nightNote).toBe('Night shifts pay 15% more: $230.00 per shift.');
  });
});
