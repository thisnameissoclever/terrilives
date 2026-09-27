import { describe, expect, it } from 'vitest';
import { createObjectIdentity } from '../src/ui/object-identity.js';

class Element {
  className = '';
  textContent = '';
  open = false;
  children: Element[] = [];
  attributes = new Map<string, string>();
  listeners = new Map<string, (event: any) => void>();
  constructor(readonly tag: string) {}
  append(...children: Element[]) { this.children.push(...children); }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  addEventListener(name: string, callback: (event: any) => void) { this.listeners.set(name, callback); }
  removeEventListener(name: string, callback: (event: any) => void) { if (this.listeners.get(name) === callback) this.listeners.delete(name); }
  contains(target: Element | null): boolean { return target === this || this.children.some(child => child.contains(target)); }
  fire(name: string, event: object = {}) { this.listeners.get(name)?.({ preventDefault() {}, ...event }); }
}

function identity() {
  const doc = { activeElement: null as Element | null, createElement: (tag: string) => new Element(tag) };
  const boundary = new Element('div');
  const control = createObjectIdentity(doc as unknown as Document, 'Washing machine', {
    modelName: 'Perpetual Cycle', description: 'Decorative appliance.',
  }, boundary as unknown as HTMLElement);
  const root = control.element as unknown as Element;
  boundary.append(root);
  return { doc, root, boundary, dispose: control.dispose, summary: root.children[0] };
}

describe('object identity disclosure', () => {
  it('keeps type, model and description separate and identifies the control accessibly', () => {
    const { root, summary, boundary } = identity();
    expect(root.tag).toBe('details');
    expect(summary.tag).toBe('summary');
    expect(summary.children.map(child => [child.className, child.textContent])).toEqual([
      ['object-model', 'Perpetual Cycle'], ['object-type', 'Washing machine'],
    ]);
    expect(summary.attributes.get('aria-label')).toBe('Washing machine: Perpetual Cycle. Object description');
    expect(root.children[1].textContent).toBe('Decorative appliance.');
    expect(root.open).toBe(false);
  });

  it('reveals on hover, preserves an activated disclosure, and closes on another activation', () => {
    const { root, summary, boundary } = identity();
    root.fire('pointerenter', { pointerType: 'mouse' });
    expect(root.open).toBe(true);
    boundary.fire('pointerleave');
    expect(root.open).toBe(false);
    root.fire('pointerenter', { pointerType: 'mouse' });
    summary.fire('click');
    boundary.fire('pointerleave');
    expect(root.open).toBe(true);
    summary.fire('click');
    expect(root.open).toBe(false);
  });

  it('keeps the description open when moving to actions and removes boundary listeners on disposal', () => {
    const { root, boundary, dispose } = identity();
    root.fire('pointerenter', { pointerType: 'mouse' });
    root.fire('pointerleave');
    expect(root.open).toBe(true);
    boundary.fire('pointerleave');
    expect(root.open).toBe(false);
    dispose();
    expect(boundary.listeners.has('pointerleave')).toBe(false);
  });

  it('supports keyboard focus and touch activation without relying on hover', () => {
    const { doc, root, summary, boundary } = identity();
    root.fire('pointerenter', { pointerType: 'touch' });
    expect(root.open).toBe(false);
    doc.activeElement = summary;
    root.fire('focusin');
    expect(root.open).toBe(true);
    boundary.fire('pointerleave');
    expect(root.open).toBe(true);
    doc.activeElement = null;
    root.fire('focusout', { relatedTarget: null });
    expect(root.open).toBe(false);
    summary.fire('click');
    expect(root.open).toBe(true);
    root.fire('focusout', { relatedTarget: null });
    expect(root.open).toBe(true);
  });
});
