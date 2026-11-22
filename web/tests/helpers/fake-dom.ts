/**
 * A small DOM model for the interface tests: elements with classes,
 * attributes, a dataset, a style, children, listeners that receive an event
 * object, focus, geometry the test sets, and `<dialog>` open and close.
 * Selectors: `tag`, `.class`, `[attr]`, `[attr="v"]`, `tag.class`, a list
 * separated by commas, and descent with a space.
 */
export type Listener = (event: FakeEvent) => void;

export interface FakeEvent {
  type: string;
  target: FakeNode;
  clientX?: number;
  clientY?: number;
  pointerType?: string;
  key?: string;
  defaultPrevented: boolean;
  propagationStopped: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}

export class FakeNode {
  id = '';
  className = '';
  value = '';
  type = '';
  name = '';
  tabIndex = -1;
  disabled = false;
  checked = false;
  open = false;
  scrollLeft = 0;
  clientWidth = 0;
  parent: FakeNode | null = null;
  nodes: FakeNode[] = [];
  attributes = new Map<string, string>();
  dataset: Record<string, string> = {};
  listeners = new Map<string, Listener[]>();
  style = new FakeStyle();
  rect = { left: 0, top: 0, width: 0, height: 0 };
  /** False models a node inside a hidden ancestor: it has no boxes. */
  rendered = true;
  isConnected = true;
  private text = '';

  constructor(readonly tagName: string, readonly document: FakeDocument) {}

  get textContent(): string {
    return this.nodes.length > 0 ? this.text + this.nodes.map(node => node.textContent).join('') : this.text;
  }
  set textContent(value: string) {
    for (const node of this.nodes) node.parent = null;
    this.nodes = [];
    this.text = value;
  }
  get hidden(): boolean { return this.attributes.has('hidden'); }
  set hidden(value: boolean) { if (value) this.attributes.set('hidden', ''); else this.attributes.delete('hidden'); }
  get children() { return { item: (index: number) => this.nodes[index] ?? null, length: this.nodes.length }; }
  get lastElementChild() { return this.nodes[this.nodes.length - 1] ?? null; }
  get options() { return this.nodes.filter(node => node.tagName === 'option'); }

  append(...items: (FakeNode | string)[]) {
    for (const item of items) {
      if (typeof item === 'string') { this.text += item; continue; }
      item.remove();
      item.parent = this;
      this.nodes.push(item);
    }
  }
  replaceChildren(...items: FakeNode[]) { this.textContent = ''; this.append(...items); }
  remove() { if (this.parent) this.parent.nodes = this.parent.nodes.filter(node => node !== this); this.parent = null; }
  contains(node: FakeNode | null): boolean { return node === this || this.nodes.some(child => child.contains(node)); }
  setAttribute(key: string, value: string) {
    this.attributes.set(key, value);
    if (key === 'class') this.className = value;
    if (key === 'tabindex') this.tabIndex = Number(value);
  }
  getAttribute(key: string) { return this.attributes.get(key) ?? null; }
  hasAttribute(key: string) { return this.attributes.has(key); }
  removeAttribute(key: string) { this.attributes.delete(key); }
  toggleAttribute(key: string, force: boolean) { if (force) this.attributes.set(key, ''); else this.attributes.delete(key); }
  addEventListener(type: string, listener: Listener) { this.listeners.set(type, [...this.listeners.get(type) ?? [], listener]); }
  dispatch(type: string, init: Partial<FakeEvent> = {}): FakeEvent {
    const event: FakeEvent = {
      type, target: this, defaultPrevented: false, propagationStopped: false, ...init,
      preventDefault() { event.defaultPrevented = true; },
      stopPropagation() { event.propagationStopped = true; },
    };
    // Pointer, key and click events rise through the ancestors, as they do in a page.
    const rises = ['click', 'keydown', 'pointermove', 'change'].includes(type);
    for (let node: FakeNode | null = this; node !== null; node = rises && !event.propagationStopped ? node.parent : null) {
      for (const listener of node.listeners.get(type) ?? []) listener(event);
    }
    return event;
  }
  click() { this.dispatch('click'); }
  focus() {
    const previous = this.document.activeElement;
    if (previous === this) return;
    this.document.activeElement = this;
    previous?.dispatch('blur');
    this.dispatch('focus');
  }
  blur() { if (this.document.activeElement === this) { this.document.activeElement = null; this.dispatch('blur'); } }
  getBoundingClientRect() { return { ...this.rect, right: this.rect.left + this.rect.width, bottom: this.rect.top + this.rect.height }; }
  getClientRects() { return this.rendered ? [this.getBoundingClientRect()] : []; }
  showModal() { this.open = true; this.document.modals.push(this); }
  close() {
    if (!this.open) return;
    this.open = false;
    this.document.modals = this.document.modals.filter(node => node !== this);
    this.dispatch('close');
  }
  classes(): string[] { return this.className.split(/\s+/).filter(Boolean); }
  matches(simple: string): boolean {
    const attributes = [...simple.matchAll(/\[([a-z-]+)(?:="([^"]*)")?\]/g)];
    const rest = simple.replace(/\[[^\]]*\]/g, '');
    const [selectorPart, id] = rest.split('#');
    const [tag, ...classes] = selectorPart.split('.');
    if (id !== undefined && id !== this.id) return false;
    if (tag && tag !== this.tagName) return false;
    if (!classes.every(cls => this.classes().includes(cls))) return false;
    return attributes.every(([, key, expected]) =>
      expected === undefined ? this.attributes.has(key) : this.attributes.get(key) === expected);
  }
  all(): FakeNode[] { return [this, ...this.nodes.flatMap(node => node.all())]; }
  querySelectorAll(selector: string): FakeNode[] {
    const found = new Set(selector.split(',').flatMap(part => {
      const [first, second] = part.trim().split(/\s+/);
      const heads = this.all().filter(node => node !== this && node.matches(first));
      if (!second) return heads;
      return heads.flatMap(head => head.all().filter(node => node !== head && node.matches(second)));
    }));
    return this.all().filter(node => found.has(node));
  }
  querySelector(selector: string): FakeNode | null { return this.querySelectorAll(selector)[0] ?? null; }
}

export class FakeStyle {
  readonly properties = new Map<string, string>();
  setProperty(name: string, value: string) { this.properties.set(name, value); }
  getPropertyValue(name: string) { return this.properties.get(name) ?? ''; }
  removeProperty(name: string) { this.properties.delete(name); }
  width = '';
  minWidth = '';
  left = '';
}

export class FakeDocument {
  activeElement: FakeNode | null = null;
  modals: FakeNode[] = [];
  readonly body = new FakeNode('body', this);
  /** Media queries that currently match; the test sets them. */
  readonly media = new Set<string>();
  private readonly mediaListeners = new Map<string, Set<() => void>>();
  defaultView = {
    matchMedia: (query: string) => {
      const media = this.media;
      return {
      get matches() { return media.has(query); },
      addEventListener: (_type: string, listener: () => void) => {
        this.mediaListeners.set(query, (this.mediaListeners.get(query) ?? new Set()).add(listener));
      },
      removeEventListener: (_type: string, listener: () => void) => { this.mediaListeners.get(query)?.delete(listener); },
      };
    },
  };
  /** Makes `query` match or not, and tells whoever listens, as a window resize does. */
  setMedia(query: string, on: boolean): void {
    if (on) this.media.add(query); else this.media.delete(query);
    for (const listener of this.mediaListeners.get(query) ?? []) listener();
  }
  createElement(tag: string) { return new FakeNode(tag, this); }
  createElementNS(_namespace: string, tag: string) { return new FakeNode(tag, this); }
  createTextNode(text: string) { const node = new FakeNode('#text', this); node.textContent = text; return node; }
}

/** A fake document typed as the real one, for the code under test. */
export function fakeDocument(): { fake: FakeDocument; doc: Document } {
  const fake = new FakeDocument();
  return { fake, doc: fake as unknown as Document };
}
