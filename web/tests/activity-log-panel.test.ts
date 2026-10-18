import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FILTER } from '../src/ui/activity-log-compose.js';
import {
  ACTIVITY_LOG_WINDOW, ActivityLogNames, ActivityLogPanel, type ActivityLogRow, type ActivityLogView,
  attachActivityLogPanel, rememberingNames,
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
    refreshMs: 100,
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
    panel.update(0);
    panel.update(500);
    expect(view.calls).toBe(before);
    expect(labelReads()).toBe(0);
  });

  it('composes the history on open, then appends only new lines', () => {
    const { panel, view, drain, read, labelReads } = setup();
    drain(read(), read());
    panel.open();
    expect(view.texts()).toEqual(['Tim: Read a book', 'Tim: Read a book']);
    expect(labelReads()).toBe(1);
    panel.update(0);
    const calls = view.calls;
    panel.update(10);
    expect(view.calls, 'no new records and no poll due: nothing to do').toBe(calls);
    drain(read(BILL));
    panel.update(20);
    expect(view.texts()).toHaveLength(3);
    expect(view.texts()[2]).toBe('Bill: Read a book');
    expect(view.scrolled).toBe(1);
    view.bottom = false;
    drain(read());
    panel.update(30);
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
    panel.update(0);
    expect(view.texts()).toEqual(['Tim: Read a book', 'Tim: Read a book', "Tim: Annoyed by Bill's dishes (2 times)"]);
  });

  it('shows the empty states', () => {
    const { panel, view, drain, read } = setup();
    panel.open();
    expect(view.empty).toBe(PANEL_WORDS.nothingYet);
    panel.toggleFilter(0);
    drain(read());
    panel.update(0);
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
    panel.update(0);
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
    panel.update(0);
    expect(view.rows).toHaveLength(200);
  });

  it('never renders more than the store holds', () => {
    const { panel, view, drain, read } = setup();
    for (let batch = 0; batch < 9; batch++) drain(...Array.from({ length: 250 }, () => read()));
    panel.open();
    for (let step = 0; step < 12; step++) panel.showEarlier();
    expect(view.rows).toHaveLength(2_000);
    drain(...Array.from({ length: 100 }, () => read()));
    panel.update(0);
    expect(view.rows).toHaveLength(2_000);
  });

  it('polls the selected housemate at the refresh cadence and narrows the lines', () => {
    const { panel, view, drain, read, select } = setup();
    drain(read(TIM), read(BILL));
    panel.open();
    panel.update(0);
    expect(view.selected).toBeNull();
    select(BILL);
    panel.update(50);
    expect(view.texts()).toHaveLength(2);
    panel.update(100);
    expect(view.texts()).toEqual(['Bill: Read a book']);
    expect(view.selected).toBe('Only entries involving Bill.');
    select(null);
    panel.update(200);
    expect(view.texts()).toHaveLength(2);
    expect(view.selected).toBeNull();
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
