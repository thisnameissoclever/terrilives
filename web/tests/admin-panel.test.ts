import { describe, expect, it } from 'vitest';
import type { AdminApplyResult, AdminBeginResult, AdminChange, AdminRefusalCode, AdminUndoResult } from '../src/admin/codec.js';
import {
  AdminPanel,
  type AdminMember,
  type AdminPanelSource,
  type AdminSkipHost,
  type AdminTab,
  type AdminTabContext,
  type AdminTabId,
} from '../src/admin/admin-panel.js';
import { ADMIN_REFUSAL_TEXT, beginRefusalText, refusalText } from '../src/admin/admin-words.js';
import type { SkipResult } from '../src/admin/admin-panel.js';
import { OverlayPauseController } from '../src/ui/overlay-pause.js';
import { FakeNode, fakeDocument } from './helpers/fake-dom.js';

const HUNGER: AdminChange = { edits: [{ edit: 'SetNeed', sim: 5, need: 0, value: 80 }] };

class Source implements AdminPanelSource {
  readonly log: string[] = [];
  begin: AdminBeginResult = 'ok';
  undoResult: AdminUndoResult = 'ok';
  /** The next apply's refusal; null applies. */
  refuse: AdminRefusalCode | null = null;
  depth = 0;
  /** A depth the bridge reports instead of the real one, to model a label mismatch. */
  reportedDepth: number | null = null;
  adminBegin(): AdminBeginResult {
    this.log.push('begin');
    // A new session starts with an empty journal, as the simulation's does.
    if (this.begin === 'ok') this.depth = 0;
    return this.begin;
  }
  adminEnd(): void { this.log.push('end'); }
  adminApply(_change: AdminChange): AdminApplyResult {
    this.log.push('apply');
    if (this.refuse !== null) return { applied: false, edit: 0, refusal: this.refuse, depth: this.depth };
    this.depth += 1;
    return { applied: true, depth: this.reportedDepth ?? this.depth };
  }
  adminUndo(): AdminUndoResult {
    this.log.push('undo');
    if (this.undoResult === 'ok') this.depth = Math.max(0, this.depth - 1);
    return this.undoResult;
  }
  adminUndoDepth(): number { return this.reportedDepth ?? this.depth; }
  /** Whether a refused change left the session broken. */
  broken = false;
  adminBroken(): boolean { return this.broken; }
}

class Driver {
  readonly speeds: number[] = [];
  setSpeed(multiplier: number): void { this.speeds.push(multiplier); }
  get last(): number | undefined { return this.speeds[this.speeds.length - 1]; }
}

/** The host side of Skip ahead: the shell hands it a run and it answers through the handlers. */
class SkipHost implements AdminSkipHost {
  readonly log: string[] = [];
  handlers: { progress(done: number): void; finish(result: SkipResult): void } | null = null;
  limits() { return { maxHours: 168, defaultHours: 8 }; }
  start(hours: number, handlers: { progress(done: number): void; finish(result: SkipResult): void }): void {
    this.log.push(`start ${hours}`);
    this.handlers = handlers;
  }
  stop(): void { this.log.push('stop'); }
  cancel(): void { this.log.push('cancel'); this.handlers = null; }
}

class SpyTab implements AdminTab {
  readonly body: HTMLElement;
  refreshes = 0;
  skipChanges = 0;
  skipChanged(): void { this.skipChanges += 1; }
  constructor(readonly id: AdminTabId, readonly context: AdminTabContext, doc: Document) {
    this.body = doc.createElement('div');
    this.body.setAttribute('data-spy', id);
  }
  refresh(): void { this.refreshes += 1; }
}

const MEMBERS: AdminMember[] = [{ simId: 3, name: 'Tim' }, { simId: 5, name: 'Bill' }, { simId: 9, name: 'Casey' }];

interface Options {
  speed?: number;
  members?: AdminMember[];
  gameSelected?: number | null;
  spyTabs?: boolean;
  skip?: SkipHost;
}

function build(options: Options = {}) {
  const { fake, doc } = fakeDocument();
  const source = new Source();
  const driver = new Driver();
  const recorded: number[] = [];
  const pause = new OverlayPauseController(driver, speed => recorded.push(speed), options.speed ?? 1);
  const dialog = fake.createElement('dialog');
  dialog.id = 'admin-panel';
  fake.body.append(dialog);
  const canvas = fake.createElement('canvas');
  fake.body.append(canvas);
  const opener = fake.createElement('button');
  fake.body.append(opener);
  const members = { current: options.members ?? MEMBERS };
  const gameSelected = { current: options.gameSelected === undefined ? 5 : options.gameSelected };
  const changes: string[] = [];
  const spies: SpyTab[] = [];
  const tabs = options.spyTabs === false ? {} : Object.fromEntries((['housemate', 'relationships', 'household'] as const).map(id => [
    id, (context: AdminTabContext) => { const spy = new SpyTab(id, context, doc); spies.push(spy); return spy; },
  ]));
  const panel = new AdminPanel(doc, dialog as unknown as HTMLDialogElement, source, pause, {
    members: () => members.current,
    selectedSimId: () => gameSelected.current,
    fallbackFocus: () => canvas as unknown as HTMLElement,
    worldChanged: cause => changes.push(cause),
    closed: () => changes.push('closed'),
    tabs,
    skip: options.skip,
  });
  const q = (selector: string): FakeNode => {
    const node = dialog.querySelector(selector);
    if (!node) throw new Error(`no ${selector}`);
    return node;
  };
  const all = (selector: string) => dialog.querySelectorAll(selector);
  const open = () => panel.open(opener as unknown as HTMLElement);
  const spy = (id: AdminTabId): SpyTab => spies.find(tab => tab.id === id)!;
  const tabButton = (label: string): FakeNode => all('[role="tab"]').find(node => node.textContent === label)!;
  const pickerButtons = (): FakeNode[] => all('.admin-picker button');
  const undo = (): FakeNode => q('.admin-undo');
  const key = (target: FakeNode, name: string, extra: Record<string, unknown> = {}) =>
    target.dispatch('keydown', { key: name, ...extra } as never);
  const alert = (): FakeNode | undefined => fake.body.querySelectorAll('dialog').find(node => node !== dialog);
  return { fake, doc, source, driver, recorded, pause, dialog, canvas, opener, members, gameSelected, changes, spies,
    panel, q, all, open, spy, tabButton, pickerButtons, undo, key, alert };
}

describe('opening and closing: the game pauses and comes back exactly as it was', () => {
  for (const speed of [0, 1, 2, 3]) {
    it(`restores ${speed === 0 ? 'paused' : `${speed}x`} after Close`, () => {
      const h = build({ speed });
      expect(h.open()).toBe(true);
      expect(h.driver.last, 'the game is paused while the panel is open').toBe(0);
      expect(h.pause.suspended).toBe(true);
      h.q('.admin-close').click();
      expect(h.dialog.open).toBe(false);
      expect(h.pause.suspended).toBe(false);
      expect(h.driver.last, 'the speed from before opening is back').toBe(speed);
      expect(h.pause.selectedSpeed).toBe(speed);
      expect(h.recorded, 'pausing for the panel is shell time, never a speed command').toEqual([]);
    });
  }

  it('begins the session after pausing and before the dialog shows', () => {
    const h = build();
    const order: string[] = [];
    const driverSet = h.driver.setSpeed.bind(h.driver);
    h.driver.setSpeed = speed => { order.push(`speed ${speed}`); driverSet(speed); };
    const begin = h.source.adminBegin.bind(h.source);
    h.source.adminBegin = () => { order.push(`begin open=${h.dialog.open}`); return begin(); };
    h.open();
    expect(order).toEqual(['speed 0', 'begin open=false']);
    expect(h.dialog.open).toBe(true);
  });

  it('ends the session once, however it is closed', () => {
    const routes: [string, (h: ReturnType<typeof build>) => void][] = [
      ['the Close button', h => h.q('.admin-close').click()],
      ['Escape (the dialog cancel)', h => h.dialog.dispatch('cancel')],
      ['the close method', h => h.panel.close()],
    ];
    for (const [name, close] of routes) {
      const h = build({ speed: 2 });
      h.open();
      close(h);
      close(h);
      expect(h.dialog.open, name).toBe(false);
      expect(h.source.log, name).toEqual(['begin', 'end']);
      expect(h.driver.speeds, `${name} resumes once`).toEqual([0, 2]);
    }
  });

  it('does not open twice', () => {
    const h = build();
    expect(h.open()).toBe(true);
    expect(h.open()).toBe(false);
    expect(h.source.log).toEqual(['begin']);
    expect(h.driver.speeds).toEqual([0]);
  });

  it('says what closing does, at the speed that was chosen', () => {
    const running = build({ speed: 3 });
    running.open();
    expect(running.q('.admin-pill').getAttribute('role')).toBe('status');
    expect(running.q('.admin-pill-label').textContent).toBe('Game paused');
    expect(running.q('.admin-pill-note').textContent).toBe('Closing the panel resumes the game at 3x.');
    const paused = build({ speed: 0 });
    paused.open();
    expect(paused.q('.admin-pill-note').textContent).toBe('The game stays paused after you close the panel.');
  });

  it('is a labelled dialog with the Cheat badge and the key hint', () => {
    const h = build();
    h.open();
    expect(h.dialog.getAttribute('aria-labelledby')).toBe('admin-panel-title');
    expect(h.q('#admin-panel-title').textContent).toBe('Admin panel Cheat');
    expect(h.q('.admin-cheat').textContent).toBe('Cheat');
    expect(h.q('.admin-hint').textContent).toBe('~ opens and closes');
  });
});

describe('a refused begin', () => {
  const cases: [Exclude<AdminBeginResult, 'ok'>, string][] = [
    ['build-active', 'Leave Build mode to open the admin panel.'],
    ['would-not-reload', "This game's state would not reload, so the admin panel can't open."],
    ['already-open', 'Admin panel already open'],
  ];
  for (const [result, message] of cases) {
    it(`shows "${message}" and leaves the game running as before`, () => {
      const h = build({ speed: 2 });
      h.source.begin = result;
      expect(h.open()).toBe(false);
      expect(h.dialog.open).toBe(false);
      expect(h.pause.suspended).toBe(false);
      expect(h.driver.last, 'the speed from before is back').toBe(2);
      expect(h.source.log, 'a session that never began is not ended').toEqual(['begin']);
      const alert = h.alert()!;
      expect(alert.open).toBe(true);
      expect(alert.getAttribute('role')).toBe('alertdialog');
      expect(alert.textContent).toContain(message);
      expect(beginRefusalText(result)).toBe(message);
    });
  }

  it('returns focus to the opener when the alert is closed, and can then open normally', () => {
    const h = build();
    h.source.begin = 'build-active';
    h.open();
    const alert = h.alert()!;
    const close = alert.querySelector('button')!;
    expect(h.fake.activeElement).toBe(close);
    close.click();
    expect(alert.open).toBe(false);
    expect(h.fake.activeElement).toBe(h.opener);
    h.source.begin = 'ok';
    expect(h.open()).toBe(true);
  });

  it('keeps the game paused when another surface also holds the pause', () => {
    const h = build({ speed: 1 });
    h.pause.suspend('help');
    h.source.begin = 'build-active';
    h.open();
    expect(h.pause.suspended).toBe(true);
    h.pause.resume('help');
    expect(h.driver.last).toBe(1);
  });
});

describe('tabs', () => {
  it('lists Housemate, Relationships and Household with Housemate selected', () => {
    const h = build();
    h.open();
    const tabs = h.all('[role="tab"]');
    expect(tabs.map(tab => tab.textContent)).toEqual(['Housemate', 'Relationships', 'Household']);
    expect(tabs.map(tab => tab.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    expect(tabs.map(tab => tab.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
    expect(h.all('[role="tablist"]')).toHaveLength(1);
    const panels = h.all('[role="tabpanel"]');
    expect(panels.map(panel => panel.hidden)).toEqual([false, true, true]);
    expect(panels[0].getAttribute('aria-labelledby')).toBe(tabs[0].id);
    expect(tabs[0].getAttribute('aria-controls')).toBe(panels[0].id);
  });

  it('switches on click and shows only that tab, re-reading it', () => {
    const h = build();
    h.open();
    const before = h.spy('relationships').refreshes;
    h.tabButton('Relationships').click();
    expect(h.tabButton('Relationships').getAttribute('aria-selected')).toBe('true');
    expect(h.tabButton('Housemate').getAttribute('aria-selected')).toBe('false');
    expect(h.all('[role="tabpanel"]').map(panel => panel.hidden)).toEqual([true, false, true]);
    expect(h.spy('relationships').refreshes).toBeGreaterThan(before);
    expect(h.all('[role="tabpanel"]')[1].contains(h.spy('relationships').body as unknown as FakeNode)).toBe(true);
  });

  it('moves with the arrow keys, Home and End, wrapping at both ends', () => {
    const h = build();
    h.open();
    const [housemate, relationships, household] = h.all('[role="tab"]');
    h.key(housemate, 'ArrowRight');
    expect(relationships.getAttribute('aria-selected')).toBe('true');
    expect(h.fake.activeElement).toBe(relationships);
    h.key(relationships, 'End');
    expect(household.getAttribute('aria-selected')).toBe('true');
    h.key(household, 'ArrowRight');
    expect(housemate.getAttribute('aria-selected')).toBe('true');
    h.key(housemate, 'ArrowLeft');
    expect(household.getAttribute('aria-selected')).toBe('true');
    h.key(household, 'Home');
    expect(housemate.getAttribute('aria-selected')).toBe('true');
  });

  it('renders a plain placeholder for a tab no module has plugged in', () => {
    const h = build({ spyTabs: false });
    h.open();
    expect(h.all('[role="tabpanel"]')).toHaveLength(3);
    h.tabButton('Household').click();
    expect(h.all('[role="tabpanel"]')[2].hidden).toBe(false);
    expect(h.all('[role="tabpanel"]')[2].textContent).toBe('Household');
  });

  it('creates each tab once for the life of the panel', () => {
    const h = build();
    h.open();
    h.panel.close();
    h.open();
    expect(h.spies).toHaveLength(3);
  });

  it('starts on Housemate each time it opens', () => {
    const h = build();
    h.open();
    h.tabButton('Household').click();
    h.panel.close();
    h.open();
    expect(h.tabButton('Housemate').getAttribute('aria-selected')).toBe('true');
  });
});

describe('the housemate picker, shared by Housemate and Relationships', () => {
  it('has one button per living housemate, named Housemate as a group', () => {
    const h = build();
    h.open();
    expect(h.q('.admin-picker').getAttribute('role')).toBe('group');
    expect(h.q('.admin-picker').getAttribute('aria-label')).toBe('Housemate');
    expect(h.pickerButtons().map(button => button.textContent)).toEqual(['Tim', 'Bill', 'Casey']);
  });

  it("starts at the game's selected housemate, or the first by id", () => {
    const selected = build({ gameSelected: 5 });
    selected.open();
    expect(selected.pickerButtons().map(button => button.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
    expect(selected.spy('housemate').context.selected()).toEqual({ simId: 5, name: 'Bill' });
    for (const gameSelected of [null, 77]) {
      const fallback = build({ gameSelected });
      fallback.open();
      expect(fallback.spy('housemate').context.selected()).toEqual({ simId: 3, name: 'Tim' });
    }
  });

  it('keeps one choice across the two tabs and re-reads them when it changes', () => {
    const h = build();
    h.open();
    const housemateReads = h.spy('housemate').refreshes;
    const relationshipReads = h.spy('relationships').refreshes;
    h.pickerButtons()[2].click();
    expect(h.spy('housemate').context.selected()).toEqual({ simId: 9, name: 'Casey' });
    expect(h.spy('relationships').context.selected()).toEqual({ simId: 9, name: 'Casey' });
    expect(h.spy('housemate').refreshes).toBeGreaterThan(housemateReads);
    expect(h.spy('relationships').refreshes).toBeGreaterThan(relationshipReads);
    h.tabButton('Relationships').click();
    expect(h.pickerButtons().map(button => button.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true']);
  });

  it('shows on Housemate and Relationships only, and never changes the game selection', () => {
    const h = build();
    h.open();
    expect(h.q('.admin-picker').hidden).toBe(false);
    h.tabButton('Relationships').click();
    expect(h.q('.admin-picker').hidden).toBe(false);
    h.pickerButtons()[0].click();
    h.tabButton('Household').click();
    expect(h.q('.admin-picker').hidden).toBe(true);
    expect(h.gameSelected.current, 'the game keeps its own selection').toBe(5);
  });

  it('starts again from the game selection after a close and open', () => {
    const h = build();
    h.open();
    h.pickerButtons()[2].click();
    h.panel.close();
    h.open();
    expect(h.spy('housemate').context.selected()).toEqual({ simId: 5, name: 'Bill' });
  });

  it("falls back to the game's selection when the chosen housemate has gone after an Undo", () => {
    const h = build();
    h.open();
    h.pickerButtons()[2].click();
    h.spy('housemate').context.apply(HUNGER, { label: 'Change Hunger' });
    h.members.current = MEMBERS.slice(0, 2);
    h.undo().click();
    expect(h.spy('housemate').context.selected()).toEqual({ simId: 5, name: 'Bill' });
    expect(h.pickerButtons().map(button => button.textContent)).toEqual(['Tim', 'Bill']);
  });
});

describe('Undo', () => {
  it('starts disabled with nothing to undo', () => {
    const h = build();
    h.open();
    expect(h.undo().textContent).toBe('Undo');
    expect(h.undo().disabled).toBe(true);
    expect(h.undo().getAttribute('title')).toBe('Nothing to undo');
  });

  it('names the last change and enables itself after an applied change', () => {
    const h = build();
    h.open();
    const result = h.spy('housemate').context.apply(HUNGER, { label: 'Change Hunger' });
    expect(result).toEqual({ applied: true, depth: 1 });
    expect(h.undo().textContent).toBe('Undo: Change Hunger');
    expect(h.undo().disabled).toBe(false);
    expect(h.undo().getAttribute('title')).toBe('Undo: Change Hunger');
    h.spy('household').context.apply(HUNGER, { label: 'Add $1,000' });
    expect(h.undo().textContent).toBe('Undo: Add $1,000');
  });

  it('splits the word Undo from the change, so a phone shows the word alone, and names the button in full', () => {
    const h = build();
    h.open();
    const word = (): string => h.undo().querySelector('.admin-undo-verb')!.textContent;
    const detail = (): string => h.undo().querySelector('.admin-undo-detail')!.textContent;
    expect([word(), detail()]).toEqual(['Undo', '']);
    expect(h.undo().getAttribute('aria-label')).toBe('Undo');
    h.spy('housemate').context.apply(HUNGER, { label: 'Change Hunger' });
    expect([word(), detail()]).toEqual(['Undo', ': Change Hunger']);
    expect(h.undo().textContent).toBe('Undo: Change Hunger');
    expect(h.undo().getAttribute('aria-label')).toBe('Undo: Change Hunger');
    expect(h.undo().getAttribute('title')).toBe('Undo: Change Hunger');
  });
  it('calls the bridge, drops the label, shows the new depth and re-reads every tab', () => {
    const h = build();
    h.open();
    const ctx = h.spy('housemate').context;
    ctx.apply(HUNGER, { label: 'Change Hunger' });
    ctx.apply(HUNGER, { label: 'Fill needs' });
    const reads = h.spies.map(tab => tab.refreshes);
    h.undo().click();
    expect(h.source.log.filter(entry => entry === 'undo')).toHaveLength(1);
    expect(h.source.depth).toBe(1);
    expect(h.undo().textContent).toBe('Undo: Change Hunger');
    expect(h.spies.map((tab, at) => tab.refreshes > reads[at])).toEqual([true, true, true]);
    h.undo().click();
    expect(h.undo().textContent).toBe('Undo');
    expect(h.undo().disabled).toBe(true);
    expect(h.undo().getAttribute('title')).toBe('Nothing to undo');
  });

  it('re-reads every tab after an applied change, even one that is not showing', () => {
    const h = build();
    h.open();
    const reads = h.spies.map(tab => tab.refreshes);
    h.spy('housemate').context.apply(HUNGER, { label: 'Change Hunger' });
    expect(h.spies.map((tab, at) => tab.refreshes - reads[at])).toEqual([1, 1, 1]);
  });

  it('tells the host what changed so it can refresh the rest of the game', () => {
    const h = build();
    h.open();
    h.spy('housemate').context.apply(HUNGER, { label: 'Change Hunger' });
    h.undo().click();
    expect(h.changes).toEqual(['apply', 'undo']);
    h.panel.close();
    expect(h.changes, 'closing tells the host too, so the HUD reads the world as the panel left it').toEqual(['apply', 'undo', 'closed']);
    h.panel.close();
    expect(h.changes, 'once per close').toEqual(['apply', 'undo', 'closed']);
  });

  it('reads "Undo last change" when its labels no longer match the bridge depth', () => {
    const h = build();
    h.open();
    const ctx = h.spy('housemate').context;
    ctx.apply(HUNGER, { label: 'Change Hunger' });
    h.source.reportedDepth = 3;
    ctx.apply(HUNGER, { label: 'Fill needs' });
    expect(h.undo().textContent).toBe('Undo last change');
    expect(h.undo().disabled).toBe(false);
    h.undo().click();
    expect(h.undo().textContent).toBe('Undo last change');
  });

  it('does not trust a label again after the counts disagreed, even if they later match', () => {
    const h = build();
    h.open();
    const ctx = h.spy('housemate').context;
    ctx.apply(HUNGER, { label: 'Change Hunger' });
    h.source.reportedDepth = 1;
    ctx.apply(HUNGER, { label: 'Fill needs' });
    expect(h.undo().textContent).toBe('Undo last change');
    h.undo().click();
    expect(h.undo().textContent, 'one label would match depth 1, but the labels were dropped').toBe('Undo last change');
  });

  it('says so, keeps the changes and disables itself when the bridge fails an Undo', () => {
    const h = build();
    h.open();
    h.spy('housemate').context.apply(HUNGER, { label: 'Change Hunger' });
    h.source.undoResult = 'failed';
    h.undo().click();
    expect(h.q('.admin-undo-status').textContent).toBe('Undo failed. Your changes are kept.');
    expect(h.q('.admin-undo-status').getAttribute('role')).toBe('status');
    expect(h.undo().disabled).toBe(true);
    h.spy('housemate').context.apply(HUNGER, { label: 'Fill needs' });
    expect(h.undo().disabled, 'stays disabled for the rest of the session').toBe(true);
    h.panel.close();
    h.open();
    expect(h.q('.admin-undo-status').textContent).toBe('');
  });

  it('takes the Undo failure path when a refused change leaves the session broken', () => {
    const h = build();
    h.open();
    const ctx = h.spy('housemate').context;
    ctx.apply(HUNGER, { label: 'Change Hunger' });
    const reports: (string | null)[] = [];
    h.source.refuse = 99;
    ctx.apply(HUNGER, { label: 'Fill needs', report: text => reports.push(text) });
    expect(reports, 'an ordinary refusal changed nothing').toEqual(['That change could not be kept. Nothing was changed.']);
    expect(h.undo().disabled).toBe(false);
    h.source.broken = true;
    ctx.apply(HUNGER, { label: 'Fill needs', report: text => reports.push(text) });
    expect(reports[1], 'a broken session kept the edits, so it does not say nothing changed').toBe('Undo failed. Your changes are kept.');
    expect(h.q('.admin-undo-status').textContent).toBe('Undo failed. Your changes are kept.');
    expect(h.undo().disabled).toBe(true);
  });

  it('is reset by a new session', () => {
    const h = build();
    h.open();
    h.spy('housemate').context.apply(HUNGER, { label: 'Change Hunger' });
    h.panel.close();
    h.source.depth = 0;
    h.open();
    expect(h.undo().textContent).toBe('Undo');
    expect(h.undo().disabled).toBe(true);
  });

  it('keeps focus on Undo while it stays enabled, else moves it to the active tab', () => {
    const h = build();
    h.open();
    const ctx = h.spy('housemate').context;
    ctx.apply(HUNGER, { label: 'Change Hunger' });
    ctx.apply(HUNGER, { label: 'Fill needs' });
    h.undo().focus();
    h.undo().click();
    expect(h.fake.activeElement).toBe(h.undo());
    h.undo().click();
    expect(h.undo().disabled).toBe(true);
    expect(h.fake.activeElement).toBe(h.tabButton('Housemate'));
  });

  it('presses on Ctrl+Z or Cmd+Z outside a text field, and leaves a text field alone', () => {
    const h = build();
    h.open();
    const ctx = h.spy('housemate').context;
    ctx.apply(HUNGER, { label: 'Change Hunger' });
    ctx.apply(HUNGER, { label: 'Fill needs' });
    const slider = h.fake.createElement('input');
    slider.type = 'range';
    const text = h.fake.createElement('input');
    text.type = 'text';
    h.spy('housemate').body.append(slider as unknown as HTMLElement, text as unknown as HTMLElement);
    const undone = () => h.source.log.filter(entry => entry === 'undo').length;
    const inText = h.key(text, 'z', { ctrlKey: true });
    expect(undone(), 'a number or text field keeps its own undo').toBe(0);
    expect(inText.defaultPrevented).toBe(false);
    const onSlider = h.key(slider, 'z', { ctrlKey: true });
    expect(undone()).toBe(1);
    expect(onSlider.defaultPrevented).toBe(true);
    h.key(h.tabButton('Housemate'), 'z', { metaKey: true });
    expect(undone()).toBe(2);
    h.key(h.tabButton('Housemate'), 'z', { altKey: true });
    h.key(h.tabButton('Housemate'), 'z');
    expect(undone(), 'only the Ctrl or Cmd chord').toBe(2);
  });
});

describe('applying a change from a tab', () => {
  it('shows the refusal through the tab, not as a label, and adds no Undo step', () => {
    const h = build();
    h.open();
    h.source.refuse = 5;
    const shown: (string | null)[] = [];
    const result = h.spy('housemate').context.apply(HUNGER, { label: 'Change Hunger', report: message => shown.push(message) });
    expect(result).toMatchObject({ applied: false, refusal: 5 });
    expect(shown).toEqual(['That has already ended or been removed.']);
    expect(h.undo().disabled).toBe(true);
    expect(h.changes).toEqual([]);
  });

  it('clears the status on success', () => {
    const h = build();
    h.open();
    const shown: (string | null)[] = [];
    h.spy('housemate').context.apply(HUNGER, { label: 'Change Hunger', report: message => shown.push(message) });
    expect(shown).toEqual([null]);
  });

  it('words refusals that name a person from the chosen housemate unless told otherwise', () => {
    const h = build();
    h.open();
    h.source.refuse = 2;
    const shown: (string | null)[] = [];
    h.spy('housemate').context.apply(HUNGER, { label: 'x', report: message => shown.push(message) });
    h.spy('housemate').context.apply(HUNGER, { label: 'x', report: message => shown.push(message), words: { name: 'Casey' } });
    expect(shown).toEqual(['Bill is no longer in the household.', 'Casey is no longer in the household.']);
  });

  it('refuses to send while the panel is closed', () => {
    const h = build();
    h.open();
    const context = h.spy('housemate').context;
    h.panel.close();
    const shown: (string | null)[] = [];
    const result = context.apply(HUNGER, { label: 'x', report: message => shown.push(message) });
    expect(result).toMatchObject({ applied: false, refusal: 1 });
    expect(shown).toEqual(['The admin panel is closed.']);
    expect(h.source.log, 'nothing reached the bridge').toEqual(['begin', 'end']);
  });
});

describe('focus', () => {
  it('lands on the heading so a screen reader announces the panel', () => {
    const h = build();
    h.open();
    expect(h.q('#admin-panel-title').getAttribute('tabindex')).toBe('-1');
    expect(h.fake.activeElement).toBe(h.q('#admin-panel-title'));
  });

  it('orders Undo, Close, the selected tab, the picker, then the tab content', () => {
    const h = build();
    h.open();
    h.spy('housemate').context.apply(HUNGER, { label: 'Change Hunger' });
    const content = h.fake.createElement('button');
    h.spy('housemate').body.append(content as unknown as HTMLElement);
    expect(h.panel.focusable()).toEqual([h.undo(), h.q('.admin-close'), h.tabButton('Housemate'), ...h.pickerButtons(), content]);
  });

  it('wraps Tab from the last control to the first, and Shift+Tab back', () => {
    const h = build();
    h.open();
    const content = h.fake.createElement('button');
    h.spy('housemate').body.append(content as unknown as HTMLElement);
    const order = h.panel.focusable() as unknown as FakeNode[];
    content.focus();
    const forward = h.key(content, 'Tab');
    expect(forward.defaultPrevented).toBe(true);
    expect(h.fake.activeElement).toBe(order[0]);
    const backward = h.key(order[0], 'Tab', { shiftKey: true });
    expect(backward.defaultPrevented).toBe(true);
    expect(h.fake.activeElement).toBe(content);
  });

  it('leaves Tab alone in the middle of the panel', () => {
    const h = build();
    h.open();
    const middle = h.q('.admin-close');
    middle.focus();
    expect(h.key(middle, 'Tab').defaultPrevented).toBe(false);
  });

  it('skips disabled controls and a hidden picker when trapping', () => {
    const h = build();
    h.open();
    expect(h.panel.focusable()).not.toContain(h.undo());
    h.tabButton('Household').click();
    for (const button of h.pickerButtons()) expect(h.panel.focusable()).not.toContain(button);
  });

  it('returns focus to the opener on every way of closing', () => {
    const routes: [string, (h: ReturnType<typeof build>) => void][] = [
      ['Close', h => h.q('.admin-close').click()],
      ['Escape', h => h.dialog.dispatch('cancel')],
    ];
    for (const [name, close] of routes) {
      const h = build();
      h.open();
      expect(h.fake.activeElement).not.toBe(h.opener);
      close(h);
      expect(h.fake.activeElement, name).toBe(h.opener);
    }
  });

  it('falls back to the game canvas when the opener is gone, hidden or disabled', () => {
    const gone = build();
    gone.open();
    gone.opener.isConnected = false;
    gone.panel.close();
    expect(gone.fake.activeElement).toBe(gone.canvas);

    const hidden = build();
    hidden.open();
    hidden.opener.rendered = false;
    hidden.panel.close();
    expect(hidden.fake.activeElement).toBe(hidden.canvas);

    const disabled = build();
    disabled.open();
    disabled.opener.disabled = true;
    disabled.panel.close();
    expect(disabled.fake.activeElement).toBe(disabled.canvas);
  });

  it('returns to the game canvas when nothing had focus', () => {
    const h = build();
    h.fake.activeElement = h.fake.body;
    h.panel.open();
    h.panel.close();
    expect(h.fake.activeElement).toBe(h.canvas);
  });

  it('uses the element that had focus when no opener is given', () => {
    const h = build();
    h.opener.focus();
    h.panel.open();
    h.panel.close();
    expect(h.fake.activeElement).toBe(h.opener);
  });

  it('gives every control an accessible name', () => {
    const h = build();
    h.open();
    for (const control of h.all('button, input, select')) {
      const named = control.textContent.trim() !== '' || control.getAttribute('aria-label') !== null;
      expect(named, control.className).toBe(true);
    }
  });
});

describe('the words', () => {
  it('words every refusal code in the plan, and one the plan lacks for Malformed', () => {
    expect(refusalText(1, {})).toBe('The admin panel is closed.');
    expect(refusalText(3, {})).toBe('That value is outside the allowed range.');
    expect(refusalText(6, {})).toBe('They are at work or on the way. Change the job when they are home.');
    expect(refusalText(12, { kind: 'rent' })).toBe('There is already a rent bill due that day.');
    expect(refusalText(15, { day: 12 })).toBe('A late fee starts only after Day 12.');
    expect(refusalText(16, { cap: '12.50' })).toBe('The late fee can be at most $12.50.');
    expect(refusalText(17, {})).toBe("Funds don't cover this bill.");
    expect(refusalText(99, {})).toBe('That change could not be kept. Nothing was changed.');
    expect(refusalText(19, {})).toBe('Invalid change');
    expect(Object.keys(ADMIN_REFUSAL_TEXT).map(Number).sort((a, b) => a - b))
      .toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 99]);
  });
});

describe('skip ahead, the shell side ([AP-skip])', () => {
  function skipping(options: Options = {}) {
    const skip = new SkipHost();
    const h = build({ ...options, skip });
    h.open();
    const context = h.spy('household').context;
    return { ...h, skip, context };
  }
  const start = (h: ReturnType<typeof skipping>, hours = 8) => h.context.skip.start(hours);
  const disabled = (node: FakeNode) => (node as unknown as { disabled: boolean }).disabled;

  it('offers skipping only when the host can run it', () => {
    const without = build();
    without.open();
    expect(without.spy('household').context.skip.available()).toBe(false);
    without.spy('household').context.skip.start(8);
    expect(without.source.log, 'nothing ends or begins').toEqual(['begin']);
    const withHost = skipping();
    expect(withHost.context.skip.available()).toBe(true);
    expect(withHost.context.skip.limits()).toEqual({ maxHours: 168, defaultHours: 8 });
  });

  it('ends the session, clears Undo and hands the run to the host', () => {
    const h = skipping();
    h.context.apply(HUNGER, { label: 'Change Hunger' });
    h.context.apply(HUNGER, { label: 'Change Energy' });
    expect(h.undo().textContent).toBe('Undo: Change Energy');
    start(h, 6);
    expect(h.source.log.slice(-1), 'the session ends before the run starts').toEqual(['end']);
    expect(h.skip.log).toEqual(['start 6']);
    expect(h.context.skip.state()).toEqual({ running: true, asked: 6, done: 0 });
    expect(h.undo().textContent, 'the history is gone').toBe('Undo');
    expect(disabled(h.undo())).toBe(true);
  });

  it('locks the other controls and says it is skipping, then undoes the lock when it ends', () => {
    const h = skipping();
    start(h);
    expect(disabled(h.q('.admin-close')), 'Close waits').toBe(true);
    for (const tab of h.all('[role="tab"]')) expect(disabled(tab), tab.textContent).toBe(true);
    for (const person of h.pickerButtons()) expect(disabled(person), person.textContent).toBe(true);
    expect(h.q('.admin-pill-label').textContent).toBe('Skipping ahead');
    expect(h.q('.admin-pill-note').textContent).toBe('');
    h.skip.handlers!.finish({ kind: 'done', hours: 8 });
    expect(disabled(h.q('.admin-close'))).toBe(false);
    for (const tab of h.all('[role="tab"]')) expect(disabled(tab)).toBe(false);
    for (const person of h.pickerButtons()) expect(disabled(person)).toBe(false);
    expect(h.q('.admin-pill-label').textContent).toBe('Game paused');
    expect(h.q('.admin-pill-note').textContent).toBe('Closing the panel resumes the game at 1x.');
  });

  it('tells the tabs about progress and keeps the hours run', () => {
    const h = skipping();
    start(h, 8);
    const before = h.spy('household').skipChanges;
    h.skip.handlers!.progress(3);
    expect(h.context.skip.state()).toEqual({ running: true, asked: 8, done: 3 });
    expect(h.spy('household').skipChanges).toBeGreaterThan(before);
  });

  it('begins a new session when it ends, so Undo starts again from here', () => {
    const h = skipping();
    h.context.apply(HUNGER, { label: 'Change Hunger' });
    start(h);
    h.skip.handlers!.finish({ kind: 'done', hours: 8 });
    expect(h.source.log.slice(-3)).toEqual(['apply', 'end', 'begin']);
    expect(h.context.skip.state()).toEqual({ running: false, last: { kind: 'done', hours: 8 } });
    expect(h.undo().textContent).toBe('Undo');
    expect(disabled(h.undo())).toBe(true);
    expect(h.changes.at(-1), 'the HUD is told the world moved').toBe('apply');
  });

  it('re-reads every tab and the roster when it ends, and again for a death', () => {
    const h = skipping();
    start(h);
    const before = h.spy('household').refreshes;
    h.members.current = h.members.current.filter(member => member.name !== 'Bill');
    h.skip.handlers!.finish({ kind: 'died', hours: 3, name: 'Bill' });
    expect(h.spy('household').refreshes).toBeGreaterThan(before);
    expect(h.context.members().map(member => member.name)).toEqual(['Tim', 'Casey']);
    expect(h.context.skip.state()).toEqual({ running: false, last: { kind: 'died', hours: 3, name: 'Bill' } });
  });

  it('forgets the last result when a new skip starts or the panel reopens', () => {
    const h = skipping();
    start(h);
    h.skip.handlers!.finish({ kind: 'stopped', hours: 2 });
    start(h);
    expect(h.context.skip.state()).toMatchObject({ running: true });
    h.skip.handlers!.finish({ kind: 'done', hours: 8 });
    h.panel.close();
    h.open();
    expect(h.context.skip.state()).toEqual({ running: false, last: null });
  });

  it('stops at the frame boundary on Stop and on Escape, and keeps the panel open', () => {
    const h = skipping();
    start(h);
    h.context.skip.stop();
    expect(h.skip.log).toEqual(['start 8', 'stop']);
    const event = h.dialog.dispatch('cancel');
    expect(event.defaultPrevented, 'Escape does not close the dialog').toBe(true);
    expect(h.dialog.open).toBe(true);
    expect(h.skip.log).toEqual(['start 8', 'stop', 'stop']);
    h.skip.handlers!.finish({ kind: 'stopped', hours: 2 });
    h.dialog.dispatch('cancel');
    expect(h.dialog.open, 'after the run, Escape closes as before').toBe(false);
  });

  it('abandons the run when the panel is closed under it, without ending the session twice', () => {
    const h = skipping({ speed: 2 });
    const handlers = () => h.skip.handlers;
    start(h);
    const run = handlers()!;
    h.panel.close();
    expect(h.skip.log).toEqual(['start 8', 'cancel']);
    expect(h.source.log).toEqual(['begin', 'end']);
    expect(h.driver.speeds, 'the game resumes once, at the speed from before').toEqual([0, 2]);
    // A finish that arrives anyway does nothing.
    run.finish({ kind: 'done', hours: 8 });
    expect(h.source.log).toEqual(['begin', 'end']);
  });

  it('closes the panel with the reason when the session cannot begin again', () => {
    const h = skipping({ speed: 3 });
    start(h);
    h.source.begin = 'would-not-reload';
    h.skip.handlers!.finish({ kind: 'done', hours: 8 });
    expect(h.dialog.open).toBe(false);
    expect(h.driver.speeds, 'resumed once').toEqual([0, 3]);
    expect(h.alert()!.querySelector('.admin-alert-message')!.textContent).toBe("This game's state would not reload, so the admin panel can't open.");
  });

  it('sends no change and no Undo while it runs', () => {
    const h = skipping();
    start(h);
    const result = h.context.apply(HUNGER, { label: 'Change Hunger' });
    expect(result.applied).toBe(false);
    expect(h.source.log.filter(entry => entry === 'apply')).toEqual([]);
    h.key(h.dialog, 'z', { ctrlKey: true });
    expect(h.source.log).not.toContain('undo');
  });

  it('ignores a finish or progress from a run that already ended', () => {
    const h = skipping();
    start(h, 8);
    const first = h.skip.handlers!;
    first.finish({ kind: 'done', hours: 8 });
    start(h, 4);
    const begins = h.source.log.filter(entry => entry === 'begin').length;
    first.progress(7);
    first.finish({ kind: 'stopped', hours: 7 });
    expect(h.context.skip.state(), 'the second run is untouched').toEqual({ running: true, asked: 4, done: 0 });
    expect(h.source.log.filter(entry => entry === 'begin')).toHaveLength(begins);
  });

  it('starts one run at a time and only while the session is open', () => {
    const h = skipping();
    start(h);
    start(h, 4);
    expect(h.skip.log).toEqual(['start 8']);
    h.skip.handlers!.finish({ kind: 'done', hours: 8 });
    h.panel.close();
    h.context.skip.start(2);
    expect(h.skip.log).toEqual(['start 8']);
  });
});
