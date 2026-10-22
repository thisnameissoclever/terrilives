import {afterEach, expect, it, vi} from 'vitest';
import {createMenuSurface, ObjectMenu, type Menu} from '../src/ui/object-menu.js';

/** Structural surface model; browser CSS and pixels remain a separate acceptance gate. */
class Element {
  children: Element[] = []; parentElement: Element | null = null;
  dataset: Record<string, string> = {}; style: Record<string, string> = {};
  attributes = new Map<string, string>(); listeners = new Map<string, ((event: any) => void)[]>();
  className = ''; hidden = false; disabled = false; open = false; type = ''; id = ''; scrollLeft = 0; revealCount = 0;
  private text = '';
  classList = {add: (name: string) => {this.className = name;}};
  constructor(readonly tag: string, readonly ownerDocument: DocumentModel) {}
  get textContent(): string {return this.text + this.children.map(child => child.textContent).join('');}
  set textContent(value: string) {this.text = value; this.replaceChildren();}
  get offsetWidth(): number {
    return Number.parseFloat(this.style.width) || (this.className === 'radial-identity' ? 150 : this.className === 'radial-description' ? 304
      : this.className === 'radial-close' ? 44 : this.tag === 'button' ? 136 : 0);
  }
  get offsetHeight(): number {
    const natural = this.className === 'radial-description' ? 140 : this.className === 'radial-close' ? 44 : this.className === 'radial-identity' || this.tag === 'button' ? 50 : 0;
    return Math.min(Number.parseFloat(this.style.height) || natural, Number.parseFloat(this.style.maxHeight) || Infinity);
  }
  get clientWidth(): number {return this.offsetWidth;}
  get clientHeight(): number {return this.offsetHeight - (this.className === 'object-action-rail' ? 6 : 0);}
  get scrollWidth(): number {return this.children.filter(child => !child.hidden).reduce((total, child) => total + child.offsetWidth + 8, 0);}
  get scrollHeight(): number {return this.className === 'radial-description' ? 140 : this.offsetHeight;}
  append(...children: Element[]): void {for (const child of children) {child.remove(); child.parentElement = this; this.children.push(child);}}
  insertBefore(child: Element, before: Element | null): void {child.remove(); child.parentElement = this; const at = before ? this.children.indexOf(before) : -1; if (at < 0) this.children.push(child); else this.children.splice(at, 0, child);}
  replaceChildren(...children: Element[]): void {this.children.forEach(child => {child.parentElement = null;}); this.children = []; this.append(...children);}
  remove(): void {if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null;}
  contains(node: Element | null): boolean {return node !== null && (node === this || this.children.some(child => child.contains(node)));}
  all(): Element[] {return [this, ...this.children.flatMap(child => child.all())];}
  querySelector(selector: string): Element | null {return this.all().slice(1).find(child => selector.startsWith('.') ? child.className === selector.slice(1) : child.tag === selector) ?? null;}
  setAttribute(name: string, value: string): void {this.attributes.set(name, value);}
  removeAttribute(name: string): void {this.attributes.delete(name);}
  addEventListener(name: string, callback: (event: any) => void): void {this.listeners.set(name, [...this.listeners.get(name) ?? [], callback]);}
  removeEventListener(name: string, callback: (event: any) => void): void {this.listeners.set(name, this.listeners.get(name)?.filter(fn => fn !== callback) ?? []);}
  fire(name: string, extra: object = {}): void {for (const callback of this.listeners.get(name) ?? []) callback({target: this, preventDefault() {}, stopPropagation() {}, ...extra});}
  click(): void {this.fire('click', {ctrlKey: false, metaKey: false});}
  focus(): void {this.ownerDocument.activeElement = this; for (let parent: Element | null = this; parent; parent = parent.parentElement) parent.fire('focusin', {target: this});}
  scrollIntoView(): void {
    this.revealCount++;
    const rail = this.parentElement;
    if (rail?.className !== 'object-action-rail') return;
    const preceding = rail.children.slice(0, rail.children.indexOf(this)).filter(child => !child.hidden).reduce((total, child) => total + child.offsetWidth + 8, 0);
    rail.scrollLeft = Math.max(0, Math.min(preceding, preceding + this.offsetWidth - rail.clientWidth));
    rail.fire('scroll');
  }
  getBoundingClientRect(): {left: number; top: number; right: number; bottom: number; width: number; height: number} {
    let left = Number.parseFloat(this.style.left) || 0, top = Number.parseFloat(this.style.top) || 0;
    if (this.parentElement && this.style.position !== 'fixed') {
      const parent = this.parentElement.getBoundingClientRect(); left += parent.left; top += parent.top;
      if (this.parentElement.className === 'object-action-rail') {
        left += this.parentElement.children.slice(0, this.parentElement.children.indexOf(this)).filter(child => !child.hidden).reduce((total, child) => total + child.offsetWidth + 8, 0) - this.parentElement.scrollLeft;
      }
    }
    return {left, top, right: left + this.offsetWidth, bottom: top + this.offsetHeight, width: this.offsetWidth, height: this.offsetHeight};
  }
}
class DocumentModel {
  activeElement: Element | null = null;
  defaultView = {innerWidth: 320, innerHeight: 568, getComputedStyle: () => ({fontSize: '13px'})};
  createElement(tag: string): Element {return new Element(tag, this);}
  getElementById(): null {return null;}
}
afterEach(() => vi.unstubAllGlobals());

it('keeps the actual crowded Bookcase menu, separate description and every paginated action reachable', () => {
  vi.stubGlobal('HTMLElement', Element); vi.stubGlobal('HTMLButtonElement', Element);
  const resizes: (() => void)[] = [];
  vi.stubGlobal('ResizeObserver', class {constructor(callback: () => void) {resizes.push(callback);} observe() {} disconnect() {}});
  vi.stubGlobal('requestAnimationFrame', () => 1); vi.stubGlobal('cancelAnimationFrame', () => {});
  const doc = new DocumentModel(), root = doc.createElement('div'); root.hidden = true;
  const opener = doc.createElement('button'); opener.focus();
  const actions = vi.fn(), dismiss = vi.fn();
  const keepouts = [{left: 8, top: 8, right: 190, bottom: 285.578125}, {left: 8, top: 386.578125, right: 312, bottom: 560}];
  const surface = createMenuSurface(doc as never, root as never, {keepouts: () => keepouts, dismiss: () => {dismiss(); controller.close();}});
  const controller = new ObjectMenu(surface, actions);
  const menu: Menu = {title: 'Bookcase', details: {modelName: 'Oakline 24', description: 'The complete existing model description remains available through this separate scrolling panel.'}, entries: [
    {label: 'Read book', action: {kind: 'use', object: 42, interaction: 0}},
    {label: 'Buy book', action: {kind: 'buy-book', quote: null}},
    {label: 'Sell book', action: {kind: 'sell-book', quote: null}},
    {label: 'Enter build mode', action: {kind: 'build', object: 42}},
  ]};
  const open = () => controller.open(menu, 210, 140);
  open();
  expect(root.hidden).toBe(false); expect(dismiss).not.toHaveBeenCalled();
  expect(root.dataset.rail).toBe('true');
  const rail = root.querySelector('.object-action-rail')!, close = root.querySelector('.radial-close')!;
  expect(rail.dataset.sceneClip).toBe('true');
  expect(rail.getBoundingClientRect()).toMatchObject({left: 8, top: 293.578125, width: 252});
  expect(rail.clientHeight).toBeGreaterThanOrEqual(44);
  expect(close.getBoundingClientRect().left).toBe(268);
  expect(close.getBoundingClientRect().height).toBe(44);
  expect(root.querySelector('.object-action-scroll-hint')!.textContent).toContain('Scroll');
  const summary = root.querySelector('summary')!; summary.focus(); summary.click();
  const description = root.querySelector('.radial-description')!;
  expect(description.parentElement).toBe(rail); expect(description.hidden).toBe(false);
  expect(doc.activeElement).toBe(description); expect(description.revealCount).toBeGreaterThan(0);
  expect(description.scrollHeight).toBeGreaterThan(description.clientHeight);
  expect(description.style.overflowY).toBe('auto');
  expect(description.textContent).toContain('complete existing model description');
  summary.focus(); summary.click(); expect(description.hidden).toBe(true); expect(doc.activeElement).toBe(summary);
  summary.click(); expect(description.hidden).toBe(false); expect(doc.activeElement).toBe(description);
  doc.defaultView.innerWidth = 1280; doc.defaultView.innerHeight = 720;
  keepouts[1] = {left: 8, top: 550, right: 1272, bottom: 712}; resizes[0]();
  expect(root.dataset.rail).toBe('false'); expect(rail.hidden).toBe(true);
  expect(description.parentElement).toBe(root); expect(description.hidden).toBe(false); expect(doc.activeElement).toBe(description);
  doc.defaultView.innerWidth = 320; doc.defaultView.innerHeight = 568;
  keepouts[1] = {left: 8, top: 386.578125, right: 312, bottom: 560}; resizes[0]();
  expect(root.dataset.rail).toBe('true'); expect(description.parentElement).toBe(rail);
  expect(doc.activeElement).toBe(description);
  const seen = new Set(root.all().filter(node => node.dataset.menuIndex !== undefined).map(node => node.dataset.menuIndex));
  const button = (label: string) => root.all().find(node => node.tag === 'button' && node.textContent === label)!;
  button('More actions').click(); expect(button('Back')).toBeDefined();
  root.all().filter(node => node.dataset.menuIndex !== undefined).forEach(node => seen.add(node.dataset.menuIndex));
  expect(button('Sell book').dataset.menuIndex).toBe('2');
  button('More actions').click();
  root.all().filter(node => node.dataset.menuIndex !== undefined).forEach(node => seen.add(node.dataset.menuIndex));
  expect([...seen].sort()).toEqual(['0', '1', '2', '3']);
  button('Back').click(); button('Back').click();
  button('Read book').focus(); root.fire('keydown', {key: 'ArrowRight'});
  expect(doc.activeElement).toBe(button('Buy book'));
  expect(actions).not.toHaveBeenCalled();
  button('More actions').click(); button('More actions').click();
  const final = button('Enter build mode'); expect(final.dataset.menuIndex).toBe('3');
  final.focus(); expect(final.revealCount).toBeGreaterThan(0);
  final.click(); expect(actions).toHaveBeenCalledExactlyOnceWith({kind: 'build', object: 42}, false);
  open(); root.querySelector('.radial-close')!.click(); expect(actions).toHaveBeenCalledTimes(1);
  expect(root.hidden).toBe(true); expect(doc.activeElement).toBe(opener);
  open(); controller.handleKey('Escape'); expect(actions).toHaveBeenCalledTimes(1);
  open(); controller.pointerDown(false); expect(actions).toHaveBeenCalledTimes(1);
});
