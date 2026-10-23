import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { setActionIntent } from '../src/ui/action-intent.js';
import { createContextSurface, type ContextModel } from '../src/ui/placement-actions.js';
import { ChoresBoard, type ChoresSource } from '../src/ui/chores-board.js';
import { createBedAssignmentSurface } from '../src/ui/bed-assignment.js';
import { createMenuSurface, NOTHING, type MenuEntry } from '../src/ui/object-menu.js';

/** The surface tests exercise real rendering and events without a browser layout. */
class Element {
  children: Element[] = [];
  parent: Element | null = null;
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  listeners: Record<string, (event: unknown) => void> = {};
  className = ''; type = ''; textContent = ''; disabled = false; hidden = false;
  classList = { add: vi.fn() };
  constructor(readonly tag: string, readonly doc: { activeElement: Element | null }) {}
  get ownerDocument(): Document { return this.doc as unknown as Document; }
  all(): Element[] { return [this, ...this.children.flatMap(child => child.all())]; }
  append(...children: Element[]) { children.forEach(child => { child.parent = this; this.children.push(child); }); }
  replaceChildren() { this.children.forEach(child => { child.parent = null; }); this.children = []; }
  setAttribute(name: string, value: string) { this.attributes[name] = value; }
  removeAttribute(name: string) { delete this.attributes[name]; }
  addEventListener(name: string, listener: (event: unknown) => void) { this.listeners[name] = listener; }
  removeEventListener(name: string) { delete this.listeners[name]; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; }
  contains(node: Element | null): boolean { return node !== null && (this === node || this.children.some(child => child.contains(node))); }
  querySelector(tag: string): Element | null { return this.children.find(child => child.tag === tag) ?? null; }
  focus() { this.doc.activeElement = this; }
  click() { this.listeners.click?.({ stopPropagation() {} }); }
}
function fixture() {
  const doc = { activeElement: null as Element | null, defaultView: null,
    createElement(tag: string): Element { return new Element(tag, doc); },
    createTextNode(text: string): Element { const node = new Element('text', doc); node.textContent = text; return node; },
    getElementById: () => null };
  vi.stubGlobal('HTMLElement', Element); vi.stubGlobal('HTMLButtonElement', Element);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1)); vi.stubGlobal('cancelAnimationFrame', vi.fn());
  return { doc, root: doc.createElement('div') };
}
afterEach(() => vi.unstubAllGlobals());

it.each([
  ['build-exit-confirm', 'affirmative', 'confirm'],
  ['build-exit-discard', 'negative', 'discard'],
])('gives the actual %s exit button its shared action role', (id, intent, value) => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const tag = [...html.matchAll(/<button\b[^>]*>/g)].map(match => match[0])
    .find(button => button.includes(`id="${id}"`));
  expect(tag).toBeDefined();
  expect(tag).toContain(`data-action-intent="${intent}"`);
  expect(tag).toContain(`value="${value}"`);
});

it('keeps the safe Keep building choice neutral', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const button = html.match(/<button id="build-exit-keep"[^>]*>/)![0];
  expect(button).toContain('value="keep"'); expect(button).toContain('autofocus');
  expect(button).not.toContain('data-action-intent');
});

it.each([
  ['work-order-cancel', 'negative'],
  ['work-order-proceed', 'affirmative'],
])('gives the actual %s work confirmation button its shared action role', (id, intent) => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const tag = [...html.matchAll(/<button\b[^>]*>/g)].map(match => match[0])
    .find(button => button.includes(`id="${id}"`));
  expect(tag).toBeDefined();
  expect(tag).toContain(`data-action-intent="${intent}"`);
});

it('removes a previous role when an action becomes neutral', () => {
  const { doc } = fixture(), button = doc.createElement('button');
  setActionIntent(button as unknown as HTMLButtonElement, 'affirmative');
  expect(button.attributes['data-action-intent']).toBe('affirmative');
  setActionIntent(button as unknown as HTMLButtonElement, 'neutral');
  expect(button.attributes['data-action-intent']).toBeUndefined();
});

it('updates reused placement intent independently of labels, prices and capability', () => {
  const { doc, root } = fixture();
  const surface = createContextSurface(doc as unknown as Document, root as unknown as HTMLElement,
    doc.createElement('canvas') as unknown as HTMLCanvasElement,
    () => ({ width: 800, bottom: 600, keepOut: { left: 0, gearLeft: 0, gearBottom: 0 } }), () => {});
  const action = { id: 'confirm', slot: 'top' as const, enabled: true, label: 'Buy', price: 20,
    intent: 'affirmative' as const, invoke() {} };
  const model: ContextModel = { tool: 'buy', x: 0, y: 0, actions: [action] };
  surface.render(model);
  const button = root.children[0].children[0];
  expect(button.attributes['data-action-intent']).toBe('affirmative');
  surface.render({ ...model, actions: [{ ...action, label: 'Place', price: 35, enabled: false }] });
  expect(root.children[0].children[0]).toBe(button);
  expect(button.disabled).toBe(true);
  expect(button.attributes['aria-label']).toBe('Place, $35');
  expect(button.attributes['data-action-intent']).toBe('affirmative');
  surface.render({ ...model, actions: [{ ...action, intent: 'negative' }] });
  expect(button.attributes['data-action-intent']).toBe('negative');
  surface.render({ ...model, actions: [{ ...action, intent: 'neutral' }] });
  expect(button.attributes['data-action-intent']).toBeUndefined();
});

it('colors radial forward and back navigation while preserving ordinary gameplay choices', () => {
  const { doc, root } = fixture();
  const surface = createMenuSurface(doc as unknown as Document, root as unknown as HTMLElement);
  const entries: MenuEntry[] = Array.from({ length: 9 }, (_, interaction) => ({ label: `Action ${interaction}`,
    action: { kind: 'use', object: 1, interaction } }));
  entries.push(NOTHING);
  const find = (label: string) => root.children.find(button => button.querySelector('span')?.textContent === label)!;
  surface.show({ title: 'Chair', entries }, 0, 0, () => {});
  try {
    expect(root.children.find(button => button.className === 'radial-close')!.attributes['data-action-intent']).toBe('negative');
    expect(find('Action 0').attributes['data-action-intent']).toBeUndefined();
    expect(find('More actions').attributes['data-action-intent']).toBe('affirmative');
    find('More actions').click();
    expect(find('Back').attributes['data-action-intent']).toBe('negative');
    expect(find('More actions').attributes['data-action-intent']).toBe('affirmative');
    find('More actions').click();
    expect(find('Nothing').attributes['data-action-intent']).toBe('negative');
    find('Back').click();
    expect(find('Back').attributes['data-action-intent']).toBe('negative');
  } finally { surface.hide(); }
});

it('retains chore execution intent when regenerated rows become unavailable', () => {
  const { doc } = fixture(); let selected: number | null = 7;
  const source: ChoresSource = { choreLocation: () => 'Kitchen', choreRows: () => Uint32Array.of(0, 4, 7, 500, 0),
    choreHistory: () => new Uint32Array(), choreProfileOf: () => Int32Array.of(50, 50, 0, 0, 0, 0),
    choreBoardEnabled: () => true, setChoreBoard: () => true, setChoreProfile: () => true, cleanChore: () => true,
    selectedIndex: () => selected, ids: () => Uint32Array.of(7), simIds: () => Uint32Array.of(7), kinds: () => Uint32Array.of(0),
    positions: () => new Float32Array(), simName: () => 'Tim', entityName: () => 'Kitchen', clockTick: () => 0, dayTicks: () => 100, lotWidth: () => 16 };
  const board = new ChoresBoard(source, doc as unknown as Document);
  const root = board.element() as unknown as Element;
  board.update();
  expect(root.all().find(node => node.textContent === 'Apply preferences')!.attributes['data-action-intent']).toBe('affirmative');
  let button = root.all().find(node => node.textContent === 'Do now')!;
  expect(button.disabled).toBe(false);
  expect(button.attributes['data-action-intent']).toBe('affirmative');
  selected = null; board.update();
  button = root.all().find(node => node.textContent === 'Do now')!;
  expect(button.disabled).toBe(true);
  expect(button.attributes['data-action-intent']).toBe('affirmative');
});

it('keeps assignment roles while the whole bed form is pending', () => {
  const { doc, root } = fixture();
  const render = createBedAssignmentSurface(doc as unknown as Document, root as unknown as HTMLElement,
    { choose() {}, assign() {}, clear() {} });
  render({ agent: 7, places: [], choice: null, pending: false, status: '' });
  const [assign, clear] = root.all().filter(node => node.tag === 'button');
  expect(assign.attributes['data-action-intent']).toBe('affirmative');
  expect(clear.attributes['data-action-intent']).toBe('destructive');
  render({ agent: 7, places: [], choice: null, pending: true, status: 'Applying assignment.' });
  expect(root.all().find(node => node.tag === 'fieldset')!.disabled).toBe(true);
  expect(assign.attributes['data-action-intent']).toBe('affirmative');
  expect(clear.attributes['data-action-intent']).toBe('destructive');
});
