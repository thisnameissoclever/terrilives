import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CompactHud, createCompactHud, householdWarningText, COMPACT_HUD_MEDIA_QUERY, type CompactHudState, type SimPanel } from '../src/ui/compact-hud.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/ui/compact-hud.css', import.meta.url), 'utf8');
const source = readFileSync(new URL('../src/ui/compact-hud.ts', import.meta.url), 'utf8');
const panels: SimPanel[] = ['overview', 'queue', 'people', 'traits'];

function setup() {
  let state: Readonly<CompactHudState>;
  const hud = new CompactHud(next => { state = next; });
  return { hud, state: () => state };
}

describe('compact HUD access and presentation', () => {
  it('starts with all detail panels closed, including Traits', () => {
    const { hud, state } = setup();
    expect(state()).toEqual({ panel: null, collapsed: false, compact: false, editing: false });
    hud.setCompact(true);
    expect(state().panel).toBeNull();
  });

  it.each(panels)('can reach %s from either responsive mode and a collapsed dock', panel => {
    for (const compact of [false, true]) {
      const { hud, state } = setup();
      hud.setCompact(compact);
      hud.toggleCollapsed();
      hud.show(panel);
      expect(state().panel).toBe(panel);
      expect(hud.close()).toBe(true);
      expect(state().panel).toBeNull();
      expect(hud.close()).toBe(false);
    }
    expect(html).toContain(`data-open-sim-panel="${panel}"`);
    expect(html).toContain(`data-sim-panel="${panel}"`);
  });

  it('restores the chosen panel after Build while retaining a resize during editing', () => {
    const { hud, state } = setup();
    hud.show('traits');
    hud.beginEditing();
    hud.beginEditing();
    hud.show('queue');
    hud.toggleCollapsed();
    expect(state()).toMatchObject({ panel: null, editing: true, collapsed: false });
    hud.setCompact(true);
    hud.endEditing();
    expect(state()).toEqual({ panel: 'traits', editing: false, collapsed: false, compact: true });
    hud.endEditing();
    expect(state().panel).toBe('traits');
  });

  it('preserves collapsed state through Build and closes the sheet when folding', () => {
    const { hud, state } = setup();
    hud.show('people'); hud.toggleCollapsed();
    expect(state().panel).toBeNull();
    hud.beginEditing(); hud.endEditing();
    expect(state().collapsed).toBe(true);
    hud.toggleCollapsed();
    expect(state().collapsed).toBe(false);
  });

  it('uses one set of controls and moves the same need meters on compact screens', () => {
    for (const id of ['needs-panel', 'household-roster-members', 'queue-mode', 'stop-orders', 'new-housemate']) {
      expect(html.split(`id="${id}"`)).toHaveLength(2);
    }
    expect(source).toContain('host.append(needs)');
    expect(css).toContain(`@media ${COMPACT_HUD_MEDIA_QUERY}`);
    expect(css).toContain('#sim-dock [hidden], #sim-dock[hidden] { display: none !important; }');
  });
});

/** Small DOM surface for the presentation controller, with real parent ownership. */
function page() {
  let focused = '';
  let modal = false;
  let refreshed = 0;
  const listeners = new Map<string, (event: KeyboardEvent) => void>();
  class Node {
    hidden = false;
    open = false;
    textContent = '';
    parentElement: Node | null = null;
    dataset: Record<string, string> = {};
    attributes = new Map<string, string>();
    events = new Map<string, () => void>();
    constructor(readonly id: string) {}
    append(child: Node) { child.parentElement = this; }
    contains(child: Node): boolean { return child === this || !!child.parentElement && this.contains(child.parentElement); }
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    addEventListener(name: string, callback: () => void) { this.events.set(name, callback); }
    focus() { focused = this.id; }
    getClientRects(): number[] { return this.hidden || this.parentElement && !this.parentElement.getClientRects().length ? [] : [1]; }
    querySelector(selector: string) { return buttons.find(button => this.contains(button) && selector.includes(`"${button.dataset.openSimPanel}"`)); }
    click() { this.events.get('click')?.(); }
  }
  const nodes = new Map<string, Node>();
  const node = (id: string): Node => {
    if (!nodes.has(id)) nodes.set(id, new Node(id));
    return nodes.get(id)!;
  };
  const sections = panels.map(panel => {
    const section = node(`sim-${panel}`); section.dataset.simPanel = panel;
    node('sim-sheet').append(section); return section;
  });
  const buttons = panels.map(panel => {
    const button = node(`tab-${panel}`); button.dataset.openSimPanel = panel;
    node('sim-sheet').append(button); return button;
  });
  node('sim-details').dataset.openSimPanel = 'overview'; buttons.push(node('sim-details'));
  node('dock-queue').dataset.openSimPanel = 'queue'; buttons.push(node('dock-queue'));
  node('sim-dock').append(node('sim-sheet'));
  node('sim-dock').append(node('sim-dock-body'));
  node('sim-dock-body').append(node('dock-needs'));
  node('sim-overview').append(node('overview-needs'));
  node('options-panel').hidden = true; node('object-menu').hidden = true;
  const document = {
    getElementById: node,
    querySelectorAll: (selector: string) => selector === '[data-sim-panel]' ? sections : buttons,
    querySelector: () => modal ? {} : null,
    addEventListener: (name: string, callback: (event: KeyboardEvent) => void) => listeners.set(name, callback),
  };
  const hud = createCompactHud(document as unknown as Document, () => { refreshed++; }, () => { node('options-panel').hidden = true; });
  return { hud, node, focus: () => focused, refreshed: () => refreshed,
    modal: (value: boolean) => { modal = value; },
    escape: () => listeners.get('keydown')!({ key: 'Escape', defaultPrevented: false, preventDefault() {}, stopPropagation() {} } as KeyboardEvent) };
}

it('keeps all meters reachable after collapse and moves the original nodes across resize', () => {
  const { hud, node } = page();
  const needs = node('needs-panel');
  expect(needs.parentElement?.id).toBe('dock-needs');
  hud.toggleCollapsed(); hud.show('overview');
  expect(needs.parentElement?.id).toBe('overview-needs');
  expect(needs.getClientRects()).toHaveLength(1);
  hud.toggleCollapsed(); hud.setCompact(true); hud.show('overview');
  expect(needs.parentElement?.id).toBe('overview-needs');
  hud.setCompact(false);
  expect(needs.parentElement?.id).toBe('dock-needs');
});

it('opens only the chosen section, exposes Traits on request, and refreshes queue capacity', () => {
  const { hud, node, refreshed } = page();
  expect(node('traits-block').open).toBe(false);
  hud.show('traits');
  expect(node('traits-block').open).toBe(true);
  expect(node('sim-details').attributes.get('aria-expanded')).toBe('true');
  expect(node('sim-traits').hidden).toBe(false);
  hud.show('queue');
  expect(node('sim-traits').hidden).toBe(true);
  expect(node('traits-block').open).toBe(false);
  expect(node('sim-queue').hidden).toBe(false);
  expect(refreshed()).toBe(1);
});

it('gives dialogs, Options and object menus Escape priority and returns focus to a visible opener', () => {
  const p = page();
  p.node('dock-queue').click();
  expect(p.focus()).toBe('tab-queue');
  p.modal(true); p.escape();
  expect(p.node('sim-sheet').hidden).toBe(false);
  p.modal(false); p.node('object-menu').hidden = false; p.escape();
  expect(p.node('sim-sheet').hidden).toBe(false);
  p.node('object-menu').hidden = true; p.node('options-panel').hidden = false; p.escape();
  expect(p.node('sim-sheet').hidden).toBe(false);
  p.node('options-panel').hidden = true; p.node('dock-queue').hidden = true; p.escape();
  expect(p.node('sim-sheet').hidden).toBe(true);
  expect(p.focus()).toBe('sim-details');
});

it('closes Options on Sim activation without relying on pointerdown', () => {
  const p = page(); p.node('options-panel').hidden = false;
  p.node('sim-details').click();
  expect(p.node('options-panel').hidden).toBe(true);
  expect(p.node('sim-sheet').hidden).toBe(false);
});

it('keeps non-selected household death warnings outside the collapsed roster', () => {
  const members = [
    { textContent: 'Tim', getAttribute: () => 'false' },
    { textContent: 'Bill is at risk of dying from hunger', getAttribute: () => 'true' },
    { textContent: 'Casey is at risk of dying from exhaustion', getAttribute: () => 'true' },
  ];
  expect(householdWarningText(members)).toBe('Bill is at risk of dying from hunger / Casey is at risk of dying from exhaustion');
  expect(householdWarningText([])).toBe('');
  const alert = html.indexOf('id="dock-alert"');
  expect(alert).toBeGreaterThan(html.indexOf('id="sim-dock"'));
  expect(alert).toBeLessThan(html.indexOf('id="sim-dock-body"'));
  expect(html.slice(alert, alert + 80)).toContain('aria-live="polite"');
});

it('keeps the current activity on the dock and lists critical needs on their own line', () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  expect(html).toContain('<span id="dock-activity"></span><span id="dock-critical"></span>');
  expect(main).toContain("const activity = activityValue.textContent ?? '';");
  expect(main).toContain('dockCritical.textContent = urgent');
  expect(main).toContain('dockActivity.textContent = activity');
});

it('wires household warnings into the frame refresh outside the selected-person projection', () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  expect(main).toContain("householdWarningText(householdRosterRoot.querySelectorAll<HTMLElement>('.household-member'))");
  expect(main).toContain('dockAlert.textContent = warning');
  expect(main).toContain('if (needsUpdated) syncDockSummary();');
});
