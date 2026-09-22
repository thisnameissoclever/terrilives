import { beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.js';
import { FurnitureBuilder } from '../src/ui/builder.js';
import { BuilderControls } from '../src/ui/builder-controls.js';
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
    'builder-sale-note', 'builder-rotation-note', 'builder-desktop', 'builder-dock', 'builder-keyboard-help',
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
  return { handle, source, builder, controls, node };
}

it('moves one live control panel between hosts and routes native control events once', () => {
  const { handle, source, builder, controls, node } = fixture();
  controls.setCompact(false);
  expect(node('builder-touch-help').hidden).toBe(true);
  expect(node('builder-keyboard-help').hidden).toBe(false);
  const panel = node('builder-controls');
  expect(panel.hidden).toBe(true);
  node('build-toggle').fire('click');
  expect(panel.hidden).toBe(false);
  expect(node('build-toggle').textContent).toBe('Exit build');
  const selector = node('builder-object');
  expect(selector.children.find(child => child.value === '15')?.textContent).toBe(source.objectName(15));
  selector.value = '15'; selector.fire('change');
  expect(builder.selected).toBe(15);
  expect(node('builder-name').textContent).toBe(source.objectName(15));
  controls.setCompact(true);
  expect(node('builder-touch-help').hidden).toBe(false);
  expect(node('builder-keyboard-help').hidden).toBe(true);
  expect(node('builder-desktop').children).toEqual([]);
  expect(node('builder-dock').children).toEqual([panel]);
  expect(selector.value).toBe('15');
  builder.moveTo(15, 2);
  expect(node('builder-confirm').disabled).toBe(true);
  expect(node('builder-status').attributes.get('data-valid')).toBe('false');
  builder.moveTo(7, 0);
  const revision = source.lotRevision();
  node('builder-confirm').fire('click');
  node('builder-confirm').fire('click');
  expect(builder.pending).toBe(true);
  expect(node('build-toggle').disabled).toBe(true);
  source.flushCommands(); builder.afterCommands();
  expect(source.lotRevision()).toBe(revision + 1);
  expect(node('builder-status').textContent).toBe('Furniture placed.');
  node('builder-cancel').fire('click');
  expect(builder.selected).toBeNull();
  node('build-toggle').fire('click');
  expect(panel.hidden).toBe(true);
  expect(node('build-toggle').attributes.get('aria-pressed')).toBe('false');
  handle.free();
});

it('explains unavailable rotation and rotates only supported directions', () => {
  const { handle, source, builder, node } = fixture();
  // Exercise shell capability presentation independently of the shipped pack.
  source.objectFacingMask = () => 1;
  builder.enter(); builder.select(26);
  expect(node('builder-rotate').disabled).toBe(true);
  expect(node('builder-rotation-note').hidden).toBe(false);
  expect(node('builder-rotation-note').textContent).toMatch(/one direction/);
  node('builder-rotate').fire('click');
  expect(builder.preview?.facing).toBe(0);
  source.objectFacingMask = () => 5;
  builder.cancel();
  builder.select(26);
  node('builder-rotate').fire('click');
  expect(builder.preview?.facing).toBe(2);
  expect(node('builder-facing').textContent).toBe('Facing: North-west');
  expect(node('builder-rotation-note').hidden).toBe(true);
  handle.free();
});

it('keeps dropdown selection synchronized through automatic commit and invalid cancellation', () => {
  const { handle, source, builder, node } = fixture();
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
  const { handle, source, builder, node } = fixture();
  node('build-toggle').fire('click');
  expect([node('builder-sell').disabled, node('builder-sell').textContent]).toEqual([true, 'Sell']);
  const selector = node('builder-object');
  selector.value = '15'; selector.fire('change');
  const { reason, payout } = source.salePreview(15);
  expect(reason).toBeNull();
  expect(payout).toBeGreaterThan(0);
  expect([node('builder-sell').disabled, node('builder-sell').textContent])
    .toEqual([false, `Sell for ${payout.toLocaleString('en-US')}`]);
  const name = source.objectName(15);
  const funds = source.funds();
  node('builder-sell').fire('click');
  expect([builder.pending, node('builder-sell').disabled, node('builder-status').textContent])
    .toEqual([true, true, 'Selling…']);
  node('builder-sell').fire('click');
  source.flushCommands(); builder.afterCommands();
  expect(source.lastSaleResult()).toEqual({ object: 15, reason: null, payout });
  expect(source.funds()).toBe(funds + payout);
  expect([builder.selected, builder.pending, node('builder-status').textContent])
    .toEqual([null, false, `${name} sold.`]);
  expect(builder.objects.some((object) => object.id === 15)).toBe(false);
  expect(selector.children.some((child) => child.value === '15')).toBe(false);
  handle.free();
});

// [SL-shell]: a chosen object that would not sell says why under Sell. The
// shipped house's only stove is the last hob Cook dinner can use, so it is
// refused as the last for a chain, code 16 at the boundary.
it('says why Sell is off for the last furniture a chain needs', () => {
  const { handle, builder, node } = fixture();
  node('build-toggle').fire('click');
  expect(node('builder-sale-note').hidden).toBe(true);
  const stove = builder.objects.find((object) => object.name === 'The Combustible Optimist');
  expect(stove).toBeDefined();
  const selector = node('builder-object');
  selector.value = String(stove!.id); selector.fire('change');
  expect(node('builder-sell').disabled).toBe(true);
  expect([node('builder-sale-note').hidden, node('builder-sale-note').textContent])
    .toEqual([false, 'Cannot sell: Nothing else in the house can do its job.']);
  node('builder-cancel').fire('click');
  expect(node('builder-sale-note').hidden).toBe(true);
  selector.value = '15'; selector.fire('change');
  expect([node('builder-sell').disabled, node('builder-sale-note').hidden]).toEqual([false, true]);
  handle.free();
});
