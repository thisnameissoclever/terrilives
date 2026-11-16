import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CareerFactors, CareerReport, CareerResult, CareerShift, CareerWeek } from '../src/bridge.js';
import {
  BY_CHANCE,
  CAREER_WARNING,
  CHANGE_SHIFT,
  SHIFT_SCHEDULE,
  CareerPanel,
  SHIFT_CHANGE_NOTE,
  careerShiftOptions,
  heldShiftOptions,
  careerFactorLines,
  careerAttendanceLine,
  careerJobView,
  nightPayLine,
  createCareerPanelSurface,
  type CareerPanelSource,
  type CareerPanelState,
} from '../src/ui/career-panel.js';
import { careerEventTitle, careerGraphKey, renderCareerGraph } from '../src/ui/career-graph.js';

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
  it('words the job, the week, the review, the factors and the streaks', () => {
    const view = careerJobView('Senior clerk', 'Office', 'Senior clerk, Monday to Friday, 06:00 to 14:00', report(), FACTORS, WEEKS);
    expect(view.level).toBe('Level 2 of 4');
    expect(view.pay).toBe('$170 per shift, from $160 to $200 at this level');
    expect(view.weekSoFar).toBe('2 shifts this week, scoring 72 on average.');
    expect(view.lastReview).toBe('Last review: 80 of 100.');
    expect(view.streaks).toBe('Good weeks in a row: 2.');
    expect(view.nextPromotion).toBe('The next promotion needs 3 good weeks in a row.');
    expect(view.warning).toBeNull();
    expect(view.factors).toEqual(careerFactorLines(FACTORS));
    expect(view.factors[2]).toBe("Social capacity 70% against the job's 30%");
    expect(view.trend).toBe(0);
    expect(view.thresholds).toEqual({ poor: 40, good: 65 });
  });

  it('words a fresh job, a warning, the top of the path and the trends', () => {
    const fresh = careerJobView('Lowly barista', 'Cafe', 'Lowly barista', report({ shifts: 0, mean: null, last: null, good: 0, level: 0 }), null, []);
    expect(fresh.weekSoFar).toBe('No shifts completed this week.');
    expect(fresh.lastReview).toBe('No review yet.');
    expect(fresh.streaks).toBe('No streak running.');
    expect(fresh.factors).toEqual([]);
    expect(fresh.level).toBe('Level 1 of 4');
    const warned = careerJobView('t', 'p', 's', report({ poor: 2, good: 0, warned: true, trend: -1 }), FACTORS, WEEKS);
    expect(warned.warning).toBe(CAREER_WARNING);
    expect(warned.streaks).toBe('Poor weeks in a row: 2.');
    expect(warned.trend).toBe(-1);
    const top = careerJobView('t', 'p', 's', report({ level: 3, trend: 1, advanceWeeks: 1 }), FACTORS, WEEKS);
    expect(top.nextPromotion).toBe('At the top of this path.');
    expect(top.trend).toBe(1);
    const one = careerJobView('t', 'p', 's', report({ shifts: 1, mean: 50, advanceWeeks: 1 }), FACTORS, WEEKS);
    expect(one.weekSoFar).toBe('1 shift this week, scoring 50 on average.');
    expect(one.nextPromotion).toBe('The next promotion needs 1 good week in a row.');
  });
});

describe('career graph', () => {
  it('names every event and keys the drawing by its weeks and thresholds', () => {
    expect([0, 1, 2, 3, 4, 5].map(careerEventTitle)).toEqual([null, 'Promoted', 'Got a raise', 'Demoted', 'Fired', 'Changed path']);
    expect(careerGraphKey(WEEKS, { poor: 40, good: 65 })).not.toBe(careerGraphKey(WEEKS.slice(1), { poor: 40, good: 65 }));
    expect(careerGraphKey(WEEKS, { poor: 40, good: 65 })).not.toBe(careerGraphKey(WEEKS, { poor: 30, good: 65 }));
  });

  it('draws a line, the two rules and one titled marker per event', () => {
    const document = doc();
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as unknown as SVGSVGElement;
    renderCareerGraph(document, svg, WEEKS, { poor: 40, good: 65 });
    const model = svg as unknown as Node_;
    expect(model.querySelectorAll('polyline')).toHaveLength(1);
    expect(model.querySelectorAll('.career-rule')).toHaveLength(2);
    expect(model.querySelectorAll('.career-point')).toHaveLength(5);
    const marks = model.querySelectorAll('.career-mark');
    expect(marks.map(mark => mark.dataset.event)).toEqual(['2', '1', '3', '5']);
    expect(marks.map(mark => mark.querySelector('title')?.textContent)).toEqual([
      'Week 2: Got a raise', 'Week 3: Promoted', 'Week 4: Demoted', 'Week 5: Changed path']);
    expect(model.querySelector('.career-mark-up')).not.toBeNull();
    expect(model.querySelector('.career-mark-down')).not.toBeNull();
    expect(model.querySelector('.career-mark-raise')?.textContent).toBe('$');
    expect(model.querySelectorAll('.career-axis').map(axis => axis.textContent)).toContain('Week 5');
    renderCareerGraph(document, svg, [], { poor: 40, good: 65 });
    expect(model.querySelectorAll('polyline')).toHaveLength(0);
    expect(model.querySelectorAll('.career-rule')).toHaveLength(2);
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
    const actions = { chosen: [] as (number | null)[], assigned: 0, quit: 0, search: [] as boolean[] };
    const render = createCareerPanelSurface(document as unknown as Document, {
      section: section as unknown as HTMLElement, empty: empty as unknown as HTMLElement, content: content as unknown as HTMLElement,
      rowTitle: rowTitle as unknown as HTMLElement, rowInfo: rowInfo as unknown as HTMLButtonElement,
      rowGraph: rowGraph as unknown as HTMLElement,
    }, { choose: path => actions.chosen.push(path), assign: () => { actions.assigned += 1; }, quit: () => { actions.quit += 1; },
      setJobSearch: search => actions.search.push(search) });
    return { section, empty, content, rowTitle, rowInfo, rowGraph, render, actions, document };
  }

  const employed = (overrides: Partial<CareerPanelState> = {}): CareerPanelState => ({
    agent: 7, unavailable: false, paths: ['Office', 'Cafe'], choice: null, pending: false, status: '', jobSearch: true,
    job: careerJobView('Senior clerk', 'Office', 'Senior clerk, Monday to Friday, 06:00 to 14:00', report({ trend: 1 }), FACTORS, WEEKS),
    ...overrides,
  });

  it('shows every line, the graph, the trend and the controls for a held job', () => {
    const { section, content, rowTitle, rowInfo, rowGraph, render, actions } = build();
    render(employed());
    expect(section.dataset.state).toBe('employed');
    expect(content.querySelector('.career-title')?.textContent).toBe('Senior clerk');
    expect(content.querySelector('.career-title')?.dataset.trend).toBe('up');
    expect(rowTitle.dataset.trend).toBe('up');
    expect(content.querySelector('.career-path')?.textContent).toBe('Path: Office');
    expect(content.querySelector('.career-level')?.textContent).toBe('Level 2 of 4');
    expect(content.querySelectorAll('.career-factors li')).toHaveLength(5);
    expect(content.querySelector('.career-warning')?.hidden).toBe(true);
    expect(content.querySelector('.career-graph:not(.career-graph-mini)')?.hidden).toBe(false);
    expect(content.querySelectorAll('.career-graph:not(.career-graph-mini) .career-mark')).toHaveLength(4);
    // The miniature sits right after the heading, where its control is.
    expect(content.nodes[1].getAttribute('id')).toBe('career-tab-mini-graph');
    expect(content.querySelector('.career-info')?.getAttribute('aria-controls')).toBe('career-tab-mini-graph');
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
    const info = content.querySelector('.career-info')!;
    expect(info.hidden).toBe(false);
    info.click();
    expect(info.getAttribute('aria-expanded')).toBe('true');
    expect(content.querySelector('.career-graph-mini')?.hidden).toBe(false);
    expect(rowInfo.hidden).toBe(false);
    rowInfo.click();
    expect(rowGraph.hidden).toBe(false);
    expect(rowGraph.querySelectorAll('.career-mark')).toHaveLength(4);
    render(employed({ choice: 1 }));
    expect(assign.disabled).toBe(false);
    expect(select.value).toBe('1');
  });

  it('words the warning, a job without reviews, the unemployed, the unavailable and the pending states', () => {
    const { section, empty, content, rowTitle, rowInfo, render } = build();
    render(employed({ job: careerJobView('t', 'p', 's', report({ warned: true, trend: -1 }), FACTORS, []) }));
    expect(content.querySelector('.career-warning')?.textContent).toBe(CAREER_WARNING);
    expect(content.querySelector('.career-warning')?.hidden).toBe(false);
    expect(content.querySelector('.career-title')?.dataset.trend).toBe('down');
    expect(content.querySelector('.career-graph:not(.career-graph-mini)')?.hidden).toBe(true);
    expect(content.querySelector('.career-no-reviews')?.hidden).toBe(false);
    expect(content.querySelector('.career-info')?.hidden).toBe(true);
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
    expect(night.pay).toBe('$105 per shift, from $105 to $128 at this level. Night shifts pay 15% more: $120.75 per shift.');
    const day = careerJobView('Guard', 'Night watch', 's', report({ pay: 105, payMin: 105, payMax: 128 }), FACTORS, WEEKS);
    expect(day.pay).toBe('$105 per shift, from $105 to $128 at this level');
  });

  it('reads the night pay from the source for the selected person only while they work nights', () => {
    const source = new Source() as Source & { nightPayCentsOf(entity: number): number | null; nightShiftPremiumPercent(): number };
    let night: number | null = null;
    source.nightPayCentsOf = () => night;
    source.nightShiftPremiumPercent = () => 15;
    const { controller, last } = panel(source);
    controller.update(0, true);
    expect(last().job?.pay).not.toContain('Night shifts');
    night = 23_000;
    controller.update(200);
    expect(last().job?.pay).toContain('Night shifts pay 15% more: $230.00 per shift.');
  });
});
