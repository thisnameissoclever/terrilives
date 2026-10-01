import { describe, expect, it } from 'vitest';
import { createBedAssignmentSurface, type BedAssignmentState } from '../src/ui/bed-assignment.js';

/** Small DOM model for event wiring, keyed option retention and focus ownership. */
class Element {
  textContent = '';
  className = '';
  value = '';
  hidden = false;
  disabled = false;
  tabIndex = 0;
  type = '';
  parent: Element | null = null;
  nodes: Element[] = [];
  attributes = new Map<string, string>();
  listeners = new Map<string, (() => void)[]>();
  constructor(readonly tagName: string, readonly document: DocumentModel) {}
  get children() { return { item: (index: number) => this.nodes[index] ?? null }; }
  append(...nodes: Element[]) { for (const node of nodes) { node.remove(); node.parent = this; this.nodes.push(node); } }
  insertBefore(node: Element, at: Element | null) {
    node.remove(); node.parent = this;
    if (at === null) this.nodes.push(node); else this.nodes.splice(this.nodes.indexOf(at), 0, node);
  }
  remove() { if (this.parent) this.parent.nodes = this.parent.nodes.filter(node => node !== this); this.parent = null; }
  contains(node: Element | null): boolean { return node === this || this.nodes.some(child => child.contains(node)); }
  setAttribute(key: string, value: string) { this.attributes.set(key, value); }
  addEventListener(event: string, listener: () => void) { this.listeners.set(event, [...this.listeners.get(event) ?? [], listener]); }
  dispatch(event: string) { this.listeners.get(event)?.forEach(listener => listener()); }
  focus() { this.document.activeElement = this; }
  all(tag: string): Element[] { return [...(this.tagName === tag ? [this] : []), ...this.nodes.flatMap(node => node.all(tag))]; }
}
class DocumentModel {
  activeElement: Element | null = null;
  createElement(tag: string) { return new Element(tag, this); }
}
const initial: BedAssignmentState = { agent: 7, choice: null, pending: false, status: '', places: [
  { bed: 10, ordinal: 0, label: 'Bed at (4, 6), place 1', assignee: null, assigneeName: null, occupant: 8, occupantName: 'Bill' },
  { bed: 10, ordinal: 1, label: 'Bed at (4, 6), place 2', assignee: 8, assigneeName: 'Bill', occupant: null, occupantName: null },
] };
function fixture() {
  const doc = new DocumentModel();
  const parent = doc.createElement('details');
  const calls: unknown[] = [];
  const render = createBedAssignmentSurface(doc as unknown as Document, parent as unknown as HTMLElement, {
    choose: place => calls.push(place), assign: () => calls.push('assign'), clear: () => calls.push('clear'),
  });
  render(initial);
  return { doc, parent, calls, render, root: parent.all('section')[0], select: parent.all('select')[0],
    assign: parent.all('button')[0], clear: parent.all('button')[1], fieldset: parent.all('fieldset')[0] };
}

describe('bed assignment DOM surface', () => {
  it('wires exact place identities and explicit Assign/Clear controls', () => {
    const { select, assign, clear, calls } = fixture();
    select.value = '10:0'; select.dispatch('change');
    assign.dispatch('click'); clear.dispatch('click');
    select.value = ''; select.dispatch('change');
    expect(calls).toEqual([{ bed: 10, ordinal: 0 }, 'assign', 'clear', null]);
    expect(assign.type).toBe('button'); expect(clear.type).toBe('button');
    expect(select.attributes.get('aria-label')).toBe('Choose a sleeping place');
  });

  it('retains option nodes and selection, disables conflicts, and removes sold beds', () => {
    const { render, select, assign, clear, parent } = fixture();
    const options = select.all('option');
    expect(options[2].disabled).toBe(true);
    const chosen = { ...initial, choice: { bed: 10, ordinal: 0 } };
    render(chosen);
    expect(assign.disabled).toBe(false); expect(clear.disabled).toBe(true);
    expect(parent.all('p').some(node => node.textContent === 'In use or reserved by Bill.')).toBe(true);
    render(chosen);
    expect(select.all('option')).toEqual(options);
    expect(select.value).toBe('10:0');
    render({ ...chosen, choice: null, places: [] });
    expect(select.all('option')).toEqual([options[0]]);
    expect(select.value).toBe(''); expect(select.disabled).toBe(true);
    expect(assign.disabled).toBe(true); expect(clear.disabled).toBe(true);
  });

  it('holds keyboard focus during a pending command and returns it to the chooser afterwards', () => {
    const { doc, root, select, assign, clear, render, fieldset } = fixture();
    const chosen = { ...initial, choice: { bed: 10, ordinal: 0 } };
    render(chosen); assign.focus();
    render({ ...chosen, pending: true, status: 'Applying assignment…' });
    expect(fieldset.disabled).toBe(true); expect(doc.activeElement).toBe(root);
    const applied = { ...chosen, places: initial.places!.map(row => row.ordinal === 0 ? { ...row, assignee: 7, assigneeName: 'Tim' } : row) };
    render({ ...applied, status: 'Sleeping place assigned.' });
    expect(doc.activeElement).toBe(select); expect(assign.disabled).toBe(true); expect(clear.disabled).toBe(false);
    clear.focus(); render({ ...applied, pending: true, status: 'Applying assignment…' });
    expect(doc.activeElement).toBe(root);
    render({ ...chosen, status: 'Assignment cleared.' });
    expect(doc.activeElement).toBe(select); expect(clear.disabled).toBe(true);
  });

  it('does not take focus back after the user leaves, and clears missing-selection controls', () => {
    const { doc, parent, select, render, fieldset } = fixture();
    select.focus(); render({ ...initial, pending: true });
    const outside = doc.createElement('button'); outside.focus();
    render(initial);
    expect(doc.activeElement).toBe(outside);
    render({ ...initial, agent: null, places: null });
    expect(fieldset.disabled).toBe(true);
    expect(select.all('option')).toHaveLength(1);
    expect(parent.all('p').some(node => node.textContent === 'Select a Sim to assign a place.')).toBe(true);
  });
});
