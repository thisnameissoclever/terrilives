import { furnitureLabel } from '../src/ui/furniture-label.js';
import { beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.js';
import { FurnitureBuilder } from '../src/ui/builder.js';
import { BuilderControls } from '../src/ui/builder-controls.js';
import { contextModel, type ContextTools } from '../src/ui/placement-actions.js';
import { OverlayPauseController } from '../src/ui/overlay-pause.js';

let memory: WebAssembly.Memory;
beforeAll(async () => {
  memory = (await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') })).memory;
});

/** Minimal DOM port; placement and control event handlers remain the real ones. */
class ElementPort {
  hidden = false;
  disabled = false;
  textContent = '';
  value = '';
  title = '';
  parent: ElementPort | null = null;
  get parentElement() { return this.parent; }
  contains(element: ElementPort | null): boolean {
    return element === this || this.children.some(child => child.contains(element));
  }
  children: ElementPort[] = [];
  attributes = new Map<string, string>();
  listeners = new Map<string, (() => void)[]>();
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  addEventListener(name: string, listener: () => void) {
    this.listeners.set(name, [...this.listeners.get(name) ?? [], listener]);
  }
  fire(name: string) { if (!this.disabled) for (const listener of this.listeners.get(name) ?? []) listener(); }
  replaceChildren() { this.children = []; }
  append(child: ElementPort) {
    if (child.parent) child.parent.children = child.parent.children.filter(item => item !== child);
    child.parent = this;
    this.children.push(child);
  }
}

function fixture() {
  const nodes = new Map<string, ElementPort>();
  for (const id of ['builder-controls', 'build-toggle', 'builder-object', 'builder-name',
    'builder-facing', 'builder-status', 'builder-rotate', 'builder-confirm', 'builder-cancel', 'builder-sell',
    'builder-sale-note', 'builder-colour', 'builder-rotation-note', 'builder-desktop', 'builder-dock', 'builder-keyboard-help',
    'builder-touch-help']) nodes.set(`#${id}`, new ElementPort());
  const doc = {
    body: new ElementPort(),
    querySelector: (selector: string) => nodes.get(selector),
    createElement: () => new ElementPort(),
  } as unknown as Document;
  const node = (id: string) => nodes.get(`#${id}`)!;
  const handle = SimHandle.from_lot();
  const source = new SimBridge(handle, memory);
  let controls: BuilderControls;
  const builder = new FurnitureBuilder(source,
    new OverlayPauseController({ setSpeed() {} }, () => {}, 1),
    { enter() {}, exit() {}, changed: () => controls?.render() });
  controls = new BuilderControls(doc, builder);
  const model = () => contextModel({ furniture: builder, buy: { active: false },
    walls: { active: false }, room: { active: false }, floors: { active: false }, focusCatalogue() {} } as ContextTools);
  const action = (id: string) => model()?.actions.find(a => a.id === id);
  return { handle, source, builder, controls, node, action };
}

it('moves one live control panel between hosts and routes native control events once', () => {
  const { handle, source, builder, controls, node, action } = fixture();
  controls.setCompact(false);
  expect(node('builder-touch-help').hidden).toBe(false);
  expect(node('builder-keyboard-help').hidden).toBe(false);
  const panel = node('builder-controls');
  expect(panel.hidden).toBe(true);
  node('build-toggle').fire('click');
  expect(panel.hidden).toBe(false);
  expect(node('build-toggle').textContent).toBe('Exit build');
  const selector = node('builder-object');
  expect(selector.children.find(child => child.value === '15')?.textContent).toBe(furnitureLabel(source, 15));
  selector.value = '15'; selector.fire('change');
  expect(builder.selected).toBe(15);
  expect(node('builder-name').textContent).toBe('Build mode');
  controls.setCompact(true);
  expect(node('builder-touch-help').hidden).toBe(false);
  expect(node('builder-keyboard-help').hidden).toBe(false);
  expect(node('builder-desktop').children).toEqual([]);
  expect(node('builder-dock').children).toEqual([panel]);
  expect(selector.value).toBe('15');
  builder.moveTo(15, 2);
  expect(!action('confirm')?.enabled).toBe(true);
  expect(node('builder-status').attributes.get('data-valid')).toBe('false');
  builder.moveTo(7, 0);
  const revision = source.lotRevision();
  action('confirm')?.invoke();
  action('confirm')?.invoke();
  expect(builder.pending).toBe(true);
  expect(node('build-toggle').disabled).toBe(true);
  source.flushCommands(); builder.afterCommands();
  expect(source.lotRevision()).toBe(revision + 1);
  expect(node('builder-status').textContent).toBe('Furniture placed.');
  action('cancel')?.invoke();
  expect(builder.selected).toBeNull();
  node('build-toggle').fire('click');
  expect(panel.hidden).toBe(true);
  expect(node('build-toggle').attributes.get('aria-pressed')).toBe('false');
  handle.free();
});

it('explains unavailable rotation and rotates only supported directions', () => {
  const { handle, source, builder, node, action } = fixture();
  // Exercise shell capability presentation independently of the shipped pack.
  source.objectFacingMask = () => 1;
  builder.enter(); builder.select(26);
  expect(!action('right')?.enabled).toBe(true);
  expect(node('builder-rotation-note').hidden).toBe(false);
  expect(node('builder-rotation-note').textContent).toMatch(/one direction/);
  action('right')?.invoke();
  expect(builder.preview?.facing).toBe(0);
  source.objectFacingMask = () => 5;
  builder.cancel();
  builder.select(26);
  action('right')?.invoke();
  expect(builder.preview?.facing).toBe(2);
  expect(node('builder-facing').textContent).toBe('Facing: North-west');
  expect(node('builder-rotation-note').hidden).toBe(true);
  handle.free();
});

it('keeps dropdown selection synchronized through automatic commit and invalid cancellation', () => {
  const { handle, source, builder, node, action } = fixture();
  builder.enter(); builder.select(15); builder.moveTo(7, 0);
  const selector = node('builder-object');
  selector.value = '22'; selector.fire('change');
  expect(selector.value).toBe('15');
  expect(selector.disabled).toBe(true);
  source.flushCommands(); builder.afterCommands();
  expect(selector.value).toBe('22');
  expect(selector.disabled).toBe(false);
  expect(source.lotRevision()).toBe(1);
  builder.moveTo(-1, 0);
  selector.value = '7'; selector.fire('change');
  expect(selector.value).toBe('7');
  expect(builder.pending).toBe(false);
  source.flushCommands(); builder.afterCommands();
  expect(source.lotRevision()).toBe(1);
  handle.free();
});

// [SL-shell] in docs/specs/2026-09-22-selling-furniture.md: the Sell button
// names what the sale pays, sells through the drain, and clears the choice.
it('sells the chosen furniture for part of its price and clears the choice', () => {
  const { handle, source, builder, node, action } = fixture();
  node('build-toggle').fire('click');
  expect([!action('sell')?.enabled, action('sell')?.label]).toEqual([true, undefined]);
  const selector = node('builder-object');
  selector.value = '15'; selector.fire('change');
  const { reason, payout } = source.salePreview(15);
  expect(reason).toBeNull();
  expect(payout).toBeGreaterThan(0);
  expect([!action('sell')?.enabled, action('sell')?.label])
    .toEqual([false, `Sell for ${payout.toLocaleString('en-US')}`]);
  const name = furnitureLabel(source, 15);
  const funds = source.funds();
  action('sell')?.invoke();
  expect([builder.pending, !action('sell')?.enabled, node('builder-status').textContent])
    .toEqual([true, true, 'Selling…']);
  action('sell')?.invoke();
  source.flushCommands(); builder.afterCommands();
  expect(source.lastSaleResult()).toEqual({ object: 15, reason: null, payout });
  expect(source.funds()).toBe(funds + payout);
  expect([builder.selected, builder.pending, node('builder-status').textContent])
    .toEqual([null, false, `${name} sold.`]);
  expect(builder.objects.some((object) => object.id === 15)).toBe(false);
  expect(selector.children.some((child) => child.value === '15')).toBe(false);
  handle.free();
});

it('lets the player sell the only stove and refrigerator', () => {
  const { handle, source, builder, node, action } = fixture();
  try {
    node('build-toggle').fire('click');
    for (const name of ['Stove', 'Fridge']) {
      const object = builder.objects.find((object) => source.objectName(object.id) === name);
      expect(object).toBeDefined();
      const selector = node('builder-object');
      selector.value = String(object!.id); selector.fire('change');
      expect(!action('sell')?.enabled).toBe(false);
      expect(node('builder-sale-note').hidden).toBe(true);
      action('sell')?.invoke();
      source.flushCommands(); builder.afterCommands();
      expect(source.lastSaleResult()?.reason).toBeNull();
      expect(builder.selected).toBeNull();
      expect(builder.objects.some((candidate) => candidate.id === object!.id)).toBe(false);
    }
  } finally {
    handle.free();
  }
});

// [RC-ui] in docs/specs/2026-09-22-colourways.md: the Colour list names every
// colourway, shows the chosen object's, and recolours it through the drain.
it('recolours the chosen furniture from the Colour list', () => {
  const { handle, source, builder, node, action } = fixture();
  const colour = node('builder-colour');
  expect(colour.children.map((option) => option.textContent)).toEqual(source.colourwayNames());
  expect(colour.children[0].textContent).toBe('As drawn');
  expect(colour.disabled).toBe(true);
  node('build-toggle').fire('click');
  const selector = node('builder-object');
  selector.value = '15'; selector.fire('change');
  expect([colour.disabled, colour.value]).toEqual([false, '0']);
  colour.value = '2'; colour.fire('change');
  // The list stays enabled, so keyboard focus stays on it, and shows the
  // choice rather than jumping back while the change is on its way.
  expect([builder.pending, colour.disabled, colour.value, node('builder-status').textContent])
    .toEqual([true, false, '2', 'Recolouring…']);
  source.flushCommands(); builder.afterCommands();
  expect(source.lastColourwayResult()).toEqual({ object: 15, reason: null, colourway: 2 });
  expect([builder.pending, builder.selected, colour.value, node('builder-status').textContent])
    .toEqual([false, 15, '2', `${furnitureLabel(source, 15)} recoloured.`]);
  expect(source.objectColourway(15)).toBe(2);
  action('cancel')?.invoke();
  expect([colour.disabled, colour.value]).toEqual([true, '0']);
  selector.value = '15'; selector.fire('change');
  expect(colour.value).toBe('2');
  handle.free();
});
