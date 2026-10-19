import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FILTER } from '../src/ui/activity-log-compose.js';
import {
  ACTIVITY_LOG_WINDOW, ActivityLogNames, ActivityLogPanel, type ActivityLogRow, type ActivityLogView,
  attachActivityLogPanel, createActivityLogView, rememberingNames,
} from '../src/ui/activity-log-panel.js';
import { ActivityLogStore, KIND } from '../src/ui/activity-log-store.js';
import { PANEL_WORDS } from '../src/ui/activity-log-words.js';
import { QueueSource, record } from './activity-log-records.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/ui/compact-hud.css', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

const TIM = 1;
const BILL = 2;
const LABELS = ['Read a book', 'cause:household-mess'];

/** A view that records what the controller asked of it. */
class FakeView implements ActivityLogView {
  open = false;
  toggleHidden = false;
  filters: boolean[] = [];
  selected: string | null = null;
  empty: string | null = null;
  earlier = false;
  rows: { row: ActivityLogRow; text: string }[] = [];
  calls = 0;
  bottom = true;
  scrolled = 0;
  focused = 0;
  fits = 0;

  reflectOpen(open: boolean) { this.calls++; this.open = open; }
  reflectToggleHidden(hidden: boolean) { this.calls++; this.toggleHidden = hidden; }
  reflectFilter(index: number, on: boolean) { this.calls++; this.filters[index] = on; }
  reflectSelected(text: string | null) { this.calls++; this.selected = text; }
  reflectEmpty(text: string | null) { this.calls++; this.empty = text; }
  reflectShowEarlier(visible: boolean) { this.calls++; this.earlier = visible; }
  replaceRows(texts: readonly string[]) {
    this.calls++;
    this.rows = texts.map(text => ({ row: { __row: true } as const, text }));
    return this.rows.map(entry => entry.row);
  }
  appendRow(text: string) {
    this.calls++;
    const row = { __row: true } as const;
    this.rows.push({ row, text });
    return row;
  }
  removeRow(row: ActivityLogRow) { this.calls++; this.rows = this.rows.filter(entry => entry.row !== row); }
  atBottom() { this.calls++; return this.bottom; }
  scrollToBottom() { this.calls++; this.scrolled++; }
  focusToggle() { this.calls++; this.focused++; }
  fitAboveDock() { this.calls++; this.fits++; }
  texts() { return this.rows.map(entry => entry.text); }
}

function setup() {
  const store = new ActivityLogStore();
  const source = new QueueSource();
  const view = new FakeView();
  const names = new ActivityLogNames();
  names.remember([{ simId: TIM, name: 'Tim' }, { simId: BILL, name: 'Bill' }]);
  let selected: number | null = null;
  let opened = 0;
  let labelReads = 0;
  const panel = new ActivityLogPanel({
    store, view, names,
    labels: () => { labelReads++; return LABELS; },
    bands: () => ({ loves: 0.6, likes: 0.2 }),
    dayTicks: 1_440,
    selected: () => selected,
    room: () => '',
    onOpen: () => { opened++; },
  });
  let seq = 0;
  const read = (actor = TIM) => record({ seq: ++seq, tick: seq, kind: KIND.actionDone, triggers: FILTER.actions, actor, label: 0 });
  const drain = (...records: number[][]) => store.drain(source.push(...records));
  return {
    store, view, panel, names, read, drain,
    select: (simId: number | null) => { selected = simId; },
    opened: () => opened,
    labelReads: () => labelReads,
  };
}

describe('the activity log panel', () => {
  it('opens and closes from the toggle and starts with the default filters', () => {
    const { panel, view, opened } = setup();
    expect(view.filters).toEqual([true, false, true, false, true, false, false]);
    expect(view.open).toBe(false);
    expect(panel.toggle()).toBe(true);
    expect(view.open).toBe(true);
    expect(opened()).toBe(1);
    expect(panel.toggle()).toBe(false);
    expect(view.open).toBe(false);
  });

  it('closes on Escape and returns focus to the toggle', () => {
    const { panel, view } = setup();
    expect(panel.handleKey('Escape')).toBe(false);
    panel.open();
    expect(panel.handleKey('Enter')).toBe(false);
    expect(panel.handleKey('Escape')).toBe(true);
    expect(view.open).toBe(false);
    expect(view.focused).toBe(1);
  });

  it('wires Escape in the capture phase unless a dialog or the object menu has it', () => {
    const { panel } = setup();
    const listeners: ((event: Parameters<Parameters<typeof attachActivityLogPanel>[0]['addEventListener']>[1] extends (e: infer E) => void ? E : never) => void)[] = [];
    let captured = false;
    const button = () => {
      const clicks: (() => void)[] = [];
      return { addEventListener: (_: string, listener: () => void) => clicks.push(listener), focus() {}, click: () => clicks.forEach(c => c()) };
    };
    const toggle = button();
    let blocked = false;
    attachActivityLogPanel(
      { addEventListener: (_type, listener, capture) => { captured = capture; listeners.push(listener); } },
      { toggle, close: button(), filters: [button(), button()], earlier: button() } as never,
      panel,
      () => blocked,
    );
    expect(captured).toBe(true);
    const escape = () => {
      let prevented = false;
      listeners[0]({ key: 'Escape', target: null, defaultPrevented: false, preventDefault() { prevented = true; }, stopPropagation() {} });
      return prevented;
    };
    toggle.click();
    expect(panel.isOpen()).toBe(true);
    blocked = true;
    expect(escape()).toBe(false);
    expect(panel.isOpen()).toBe(true);
    blocked = false;
    expect(escape()).toBe(true);
    expect(panel.isOpen()).toBe(false);
  });

  it('hides the toggle and closes in Build', () => {
    const { panel, view } = setup();
    panel.open();
    panel.setBuilding(true);
    expect(view.open).toBe(false);
    expect(view.toggleHidden).toBe(true);
    panel.open();
    expect(panel.isOpen()).toBe(false);
    panel.setBuilding(false);
    expect(view.toggleHidden).toBe(false);
    expect(panel.isOpen()).toBe(false);
  });

  it('does no work while closed', () => {
    const { panel, view, drain, read, labelReads } = setup();
    const before = view.calls;
    drain(read(), read());
    panel.update();
    panel.update();
    expect(view.calls).toBe(before);
    expect(labelReads()).toBe(0);
  });

  it('composes the history on open, then appends only new lines', () => {
    const { panel, view, drain, read, labelReads } = setup();
    drain(read(), read());
    panel.open();
    expect(view.texts()).toEqual(['Tim: Read a book', 'Tim: Read a book']);
    expect(labelReads()).toBe(1);
    panel.update();
    const calls = view.calls;
    panel.update();
    expect(view.calls, 'no new records and no new selection: nothing to do').toBe(calls);
    drain(read(BILL));
    panel.update();
    expect(view.texts()).toHaveLength(3);
    expect(view.texts()[2]).toBe('Bill: Read a book');
    expect(view.scrolled).toBe(1);
    view.bottom = false;
    drain(read());
    panel.update();
    expect(view.scrolled, 'a player reading earlier lines stays where they are').toBe(1);
    panel.close();
    panel.open();
    expect(labelReads(), 'the label table is read once').toBe(1);
  });

  it('moves a merged annoyance to the newest position', () => {
    const { panel, view, drain } = setup();
    const mess = (seq: number) => record({ seq, tick: seq, kind: KIND.annoyed, triggers: FILTER.social, actor: TIM, other: BILL, label: 1 });
    const read = (seq: number) => record({ seq, tick: seq, kind: KIND.actionDone, triggers: FILTER.actions, actor: TIM, label: 0 });
    drain(mess(1), read(2), read(3));
    panel.open();
    drain(mess(4));
    panel.update();
    expect(view.texts()).toEqual(['Tim: Read a book', 'Tim: Read a book', "Tim: Annoyed by Bill's dishes (2 times)"]);
  });

  it('shows the empty states', () => {
    const { panel, view, drain, read } = setup();
    panel.open();
    expect(view.empty).toBe(PANEL_WORDS.nothingYet);
    panel.toggleFilter(0);
    drain(read());
    panel.update();
    expect(view.empty).toBe(PANEL_WORDS.nothingMatches);
    panel.toggleFilter(0);
    expect(view.empty).toBeNull();
  });

  it('keeps filters across a Load and empties the lines', () => {
    const { panel, view, store, drain, read } = setup();
    drain(read());
    panel.toggleFilter(1);
    panel.toggleFilter(6);
    expect(panel.filters()).toBe(FILTER.actions | FILTER.chores | FILTER.social | FILTER.career | FILTER.time);
    panel.open();
    expect(view.texts()).toEqual(['D1, T00:01 Tim: Read a book']);
    store.resetAfterLoad();
    panel.resetAfterLoad();
    expect(view.texts()).toEqual([]);
    expect(view.empty).toBe(PANEL_WORDS.nothingYet);
    expect(view.filters).toEqual([true, true, true, false, true, false, true]);
    drain(record({ seq: 1, tick: 5, kind: KIND.actionDone, triggers: FILTER.actions, actor: TIM, label: 0 }));
    panel.update();
    expect(view.texts()).toEqual(['D1, T00:05 Tim: Read a book']);
  });

  it('renders the newest 200 lines and 200 more per Show earlier entries', () => {
    const { panel, view, drain, read } = setup();
    for (let batch = 0; batch < 2; batch++) drain(...Array.from({ length: 125 }, () => read()));
    panel.open();
    expect(view.rows).toHaveLength(ACTIVITY_LOG_WINDOW);
    expect(view.earlier).toBe(true);
    panel.showEarlier();
    expect(view.rows).toHaveLength(250);
    expect(view.earlier).toBe(false);
    panel.close();
    panel.open();
    expect(view.rows, 'reopening starts from the newest 200 again').toHaveLength(200);
    drain(read());
    panel.update();
    expect(view.rows).toHaveLength(200);
  });

  it('never renders more than the store holds', () => {
    const { panel, view, drain, read } = setup();
    for (let batch = 0; batch < 9; batch++) drain(...Array.from({ length: 250 }, () => read()));
    panel.open();
    for (let step = 0; step < 12; step++) panel.showEarlier();
    expect(view.rows).toHaveLength(2_000);
    drain(...Array.from({ length: 100 }, () => read()));
    panel.update();
    expect(view.rows).toHaveLength(2_000);
  });

  it('follows the housemate the roster reports as selected and narrows the lines', () => {
    const { panel, view, drain, read, select } = setup();
    drain(read(TIM), read(BILL));
    panel.open();
    panel.update();
    expect(view.selected).toBeNull();
    expect(view.texts()).toHaveLength(2);
    select(BILL);
    panel.update();
    expect(view.texts()).toEqual(['Bill: Read a book']);
    expect(view.selected).toBe('Only entries involving Bill.');
    select(null);
    panel.update();
    expect(view.texts()).toHaveLength(2);
    expect(view.selected).toBeNull();
  });

  it('fits above the dock when it opens, and its frames read no layout', () => {
    const { panel, view, drain, read } = setup();
    panel.open();
    expect(view.fits).toBe(1);
    for (let frame = 0; frame < 20; frame++) {
      if (frame % 4 === 0) drain(read());
      panel.update();
    }
    expect(view.fits, 'the view follows the dock by itself').toBe(1);
  });

  it('shows what arrived when the staging ring dropped records', () => {
    // [R12]: records 3 and 4 were overwritten before a drain. Record 5 was
    // staged as a child of record 3, so it has no line to join and stays
    // hidden; the lines around the gap compose as usual.
    const { panel, view, drain } = setup();
    const at = (seq: number, actor: number, parent = 0) => record({
      seq, tick: 10, kind: parent === 0 ? KIND.actionDone : KIND.skillLevel,
      triggers: parent === 0 ? FILTER.actions : FILTER.skills, actor, label: 0, parent,
    });
    drain(at(1, TIM), at(2, BILL));
    panel.open();
    drain(at(5, TIM, 3), at(6, BILL));
    panel.update();
    panel.toggleFilter(3);
    expect(view.texts()).toEqual(['Tim: Read a book', 'Bill: Read a book', 'Bill: Read a book']);
  });

  it('remembers names from the roster for people who have left', () => {
    const names = new ActivityLogNames();
    const rendered: unknown[] = [];
    const surface = rememberingNames({ render: (...args) => { rendered.push(args); } }, names);
    surface.render([{ simId: 9, entity: 3, name: 'Ann' }], null, () => {});
    surface.render([], null, () => {});
    expect(rendered).toHaveLength(2);
    expect(names.name(9)).toBe('Ann');
    expect(names.name(10)).toBeNull();
  });

  it('learns the selected housemate from the roster, so its poll calls no simIdOf', () => {
    const names = new ActivityLogNames();
    const surface = rememberingNames({ render: () => {} }, names);
    expect(names.selected()).toBeNull();
    surface.render([{ simId: 9, entity: 3, name: 'Ann' }], 9, () => {});
    expect(names.selected()).toBe(9);
    surface.render([{ simId: 9, entity: 3, name: 'Ann' }], null, () => {});
    expect(names.selected()).toBeNull();
  });
});

/** A stand-in for the panel's elements, counting every layout read. */
function fakePage() {
  let layoutReads = 0;
  let scrollTop = 0;
  const content = { height: 100 };
  const listeners: Record<string, () => void> = {};
  let observed: (() => void) | null = null;
  const element = () => ({
    hidden: false,
    textContent: '',
    style: { setProperty() {}, removeProperty() {} },
    setAttribute() {},
    addEventListener(type: string, listener: () => void) { listeners[type] = listener; },
    focus() {},
  });
  const items: { textContent: string; remove(): void }[] = [];
  const list = {
    ...element(),
    firstElementChild: null,
    append(item: { textContent: string; remove(): void }) {
      items.push(item);
      content.height += 20;
    },
    replaceChildren(...next: { textContent: string; remove(): void }[]) {
      items.splice(0, items.length, ...next);
      content.height = 100 + 20 * next.length;
    },
  };
  const scroller = {
    ...element(),
    get scrollHeight() { layoutReads++; return content.height; },
    get clientHeight() { layoutReads++; return 100; },
    get scrollTop() { layoutReads++; return scrollTop; },
    set scrollTop(value: number) { scrollTop = Math.min(value, content.height - 100); },
  };
  const dock = { ...element(), get offsetTop() { layoutReads++; return 700; } };
  class Observer {
    constructor(callback: () => void) { observed = callback; }
    observe() {}
    disconnect() {}
  }
  const page = { ResizeObserver: Observer, innerHeight: 900, addEventListener() {} };
  const doc = {
    defaultView: page,
    createElement: () => {
      const item = { textContent: '', remove: () => { items.splice(items.indexOf(item), 1); } };
      return item;
    },
  };
  const elements = {
    toggle: element(), panel: element(), close: element(), filters: [], selected: element(), scroller,
    earlier: element(), list, empty: element(), dock,
  };
  const view = createActivityLogView(doc as never, elements as never);
  return {
    view,
    items,
    reads: () => layoutReads,
    scrollTop: () => scrollTop,
    scroll: (to: number) => { scrollTop = to; listeners.scroll?.(); },
    afterLayout: () => observed?.(),
  };
}

describe('the activity log view', () => {
  it('reads layout only after layout, never while a frame appends', () => {
    const page = fakePage();
    page.view.reflectOpen(true);
    page.afterLayout();
    const reads = page.reads();
    const following = page.view.atBottom();
    page.view.appendRow('Tim: Read a book');
    if (following) page.view.scrollToBottom();
    expect(page.reads(), 'the frame read no layout').toBe(reads);
    expect(page.scrollTop()).toBe(0);
    page.afterLayout();
    expect(page.scrollTop(), 'the waiting scroll lands after layout').toBe(20);
    expect(page.items.map(item => item.textContent)).toEqual(['Tim: Read a book']);
  });

  it('stays where a player scrolled up to, and rows are their list items', () => {
    const page = fakePage();
    page.view.reflectOpen(true);
    const rows = page.view.replaceRows(['a', 'b', 'c'], null);
    page.afterLayout();
    expect(page.scrollTop()).toBe(60);
    page.scroll(10);
    expect(page.view.atBottom()).toBe(false);
    page.view.appendRow('d');
    page.afterLayout();
    expect(page.scrollTop(), 'reading earlier lines is left alone').toBe(10);
    page.view.removeRow(rows[0]);
    expect(page.items.map(item => item.textContent)).toEqual(['b', 'c', 'd']);
  });
});

describe('the activity log page', () => {
  it('puts the toggle at the top right with the panel controls it names', () => {
    expect(html).toContain('<button id="activity-log-toggle" class="hud-button" type="button" aria-expanded="false" aria-controls="activity-log"></button>');
    expect(html).toContain('<section id="activity-log" aria-labelledby="activity-log-title" hidden>');
    for (const id of ['activity-log-close', 'activity-log-filters', 'activity-log-selected', 'activity-log-scroller',
      'activity-log-earlier', 'activity-log-list', 'activity-log-empty']) expect(html).toContain(`id="${id}"`);
    expect(css).toMatch(/#activity-log-toggle \{\s*position: fixed;\s*top: max\(8px, env\(safe-area-inset-top\)\);\s*right: max\(8px, env\(safe-area-inset-right\)\);/);
    expect(css).toContain("body[data-building='true'] #activity-log-toggle");
    expect(css).toMatch(/#activity-log \{[^}]*width: min\(360px, calc\(100vw - 16px\)\);[^}]*z-index: 7;/);
    expect(css).toContain('#activity-log-scroller { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain;');
  });

  it('no longer says Options owns the top-right corner', () => {
    expect(html).not.toContain("it is fixed to the window's\n         top right");
    expect(html).toContain('The Log toggle owns the window\'s top right in normal play');
  });

  it('keeps every panel word in the words module', () => {
    const markup = html.slice(html.indexOf('<button id="activity-log-toggle"'), html.indexOf('<div id="hud">'));
    expect(markup.replace(/<[^>]*>/g, '').trim()).toBe('');
    expect(PANEL_WORDS.filters).toEqual(['Actions', 'Chores', 'Social', 'Skills', 'Career', 'Details', 'Time']);
  });

  it('drains every frame, resets on Load and closes beside Options and Sim details', () => {
    expect(main.match(/activityLogStore\.drain\(sim\);/g)).toHaveLength(2);
    expect(main).toContain('activityLogStore.resetAfterLoad();\n          activityLogPanel.resetAfterLoad();');
    expect(main).toContain("optionsToggle.addEventListener('click', () => { compactHud.close(); activityLogPanel.close(); });");
    expect(main).toContain('onOpen: () => { optionsMenu.close(); compactHud.close(); },');
    expect(main).toContain('activityLogPanel.setBuilding(buildSession.active);');
    expect(main).toContain("get('activitylog') === '0') sim.setActivityLogEnabled(false);");
  });
});
