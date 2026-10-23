import { describe, expect, it } from 'vitest';
import { createActivityTooltip } from '../src/ui/activity-tooltip.js';

/** Geometry and observer delivery are fixtures; these tests do not prove browser layout. */
function page() {
  type Handler = (event: any) => void;
  class Target {
    listeners = new Map<string, Handler[]>();
    addEventListener(type: string, handler: Handler) {
      this.listeners.set(type, [...this.listeners.get(type) ?? [], handler]);
    }
    emit(type: string, properties: Record<string, unknown> = {}) {
      const event = { type, target: this, defaultPrevented: false, stopped: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.stopped = true; }, ...properties };
      for (const handler of this.listeners.get(type) ?? []) handler(event);
      return event;
    }
  }
  class Node extends Target {
    id = '';
    hidden = false;
    textContent = '';
    tabIndex = 0;
    parentElement: Node | null = null;
    children: Node[] = [];
    attributes = new Map<string, string>();
    style: Record<string, string> = {};
    clientWidth = 140;
    scrollWidth = 140;
    clientHeight = 20;
    scrollHeight = 20;
    bounds = { left: 30, right: 170, top: 500, bottom: 520, width: 140, height: 20 };
    append(child: Node) { child.parentElement = this; this.children.push(child); }
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    getAttribute(name: string) { return this.attributes.get(name) ?? null; }
    removeAttribute(name: string) { this.attributes.delete(name); }
    contains(node: Node | null): boolean { return !!node && (node === this || this.children.some(child => child.contains(node))); }
    getBoundingClientRect() { return this.bounds; }
    getClientRects(): object[] { return this.hidden || this.parentElement?.getClientRects().length === 0 ? [] : [this.bounds]; }
    querySelector(selector: string): Node | null {
      return this.children.find(child => selector === '[aria-pressed="true"]' && child.getAttribute('aria-pressed') === 'true') ?? null;
    }
  }
  const document = new Target();
  const view = new Target();
  const viewport = Object.assign(new Target(), { width: 800, height: 600, offsetLeft: 0, offsetTop: 0 });
  const mutations: (() => void)[] = [];
  const resizes: (() => void)[] = [];
  const nodes: Node[] = [];
  const create = (id = '') => { const node = new Node(); node.id = id; nodes.push(node); return node; };
  const body = create('body');
  const dock = create('sim-dock'); body.append(dock);
  const trigger = create('dock-activity'); dock.append(trigger);
  trigger.textContent = 'Reading A Very Long Book Title';
  const caption = create('needs-caption'); dock.append(caption); caption.textContent = 'Tim';
  const roster = create('household-roster-members'); dock.append(roster);
  const first = create('first-person'); roster.append(first); first.setAttribute('aria-pressed', 'true');
  const second = create('second-person'); roster.append(second); second.setAttribute('aria-pressed', 'false');
  const doc = Object.assign(document, {
    body,
    documentElement: { clientWidth: 800, clientHeight: 600 },
    defaultView: Object.assign(view, {
      innerWidth: 800, innerHeight: 600, visualViewport: viewport,
      MutationObserver: class {
        constructor(callback: () => void) { mutations.push(callback); }
        observe() {}
      },
      ResizeObserver: class {
        constructor(callback: () => void) { resizes.push(callback); }
        observe() {}
      },
    }),
    getElementById: (id: string) => nodes.find(node => node.id === id) ?? null,
    createElement: () => {
      const node = create();
      node.bounds = { left: 0, right: 320, top: 0, bottom: 80, width: 320, height: 80 };
      return node;
    },
  });
  return { document: doc, trigger, dock, caption, first, second, viewport,
    clip: () => { trigger.scrollWidth = 400; },
    install: () => createActivityTooltip(doc as unknown as Document),
    popup: () => {
      const popup = nodes.find(node => node.getAttribute('role') === 'tooltip');
      expect(popup, 'the controller creates an accessible activity popup').toBeDefined();
      return popup!;
    },
    mutate: () => mutations.forEach(callback => callback()),
    resize: () => resizes.forEach(callback => callback()),
  };
}

describe('clipped selected-person activity', () => {
  it('keeps a fully readable status quiet and outside the tab order', () => {
    const p = page(); p.install();
    p.trigger.emit('pointerenter', { pointerType: 'mouse' });
    p.trigger.emit('focus');
    p.trigger.emit('click');
    expect(p.popup().hidden).toBe(true);
    expect(p.trigger.tabIndex).toBe(-1);
    expect(p.trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('reveals the complete literal text on hover only when measured width clips it', () => {
    const p = page(); p.clip(); p.trigger.textContent = 'Reading <img src=x onerror=alert(1)> & "a title"'; p.install();
    p.trigger.emit('pointerenter', { pointerType: 'mouse' });
    expect(p.popup().hidden).toBe(false);
    expect(p.popup().textContent).toBe('Reading <img src=x onerror=alert(1)> & "a title"');
    expect(p.popup().children).toHaveLength(0);
    expect(p.trigger.getAttribute('aria-describedby')).toBe(p.popup().id);
    expect(p.trigger.getAttribute('aria-controls')).toBe(p.popup().id);
    expect(p.popup().style.maxWidth).toBe('420px');
    expect(p.trigger.tabIndex).toBe(0);
    p.trigger.emit('pointerleave', { relatedTarget: p.popup() });
    expect(p.popup().hidden).toBe(false);
    p.popup().emit('pointerleave', { relatedTarget: null });
    expect(p.popup().hidden).toBe(true);
  });

  it('toggles touch activation after focus and consumes the activity press', () => {
    const p = page(); p.clip(); p.install();
    const down = p.trigger.emit('pointerdown', { pointerType: 'touch' });
    p.trigger.emit('focus');
    const first = p.trigger.emit('click', { pointerType: 'touch' });
    expect(p.popup().hidden).toBe(false);
    expect(down.stopped).toBe(true);
    expect(first.stopped).toBe(true);
    expect(first.defaultPrevented).toBe(true);
    p.trigger.emit('click', { pointerType: 'touch' });
    expect(p.popup().hidden).toBe(true);
    p.trigger.emit('click', { pointerType: 'touch' });
    expect(p.popup().hidden).toBe(false);
    p.document.emit('pointerdown', { target: p.dock });
    expect(p.popup().hidden).toBe(true);
  });

  it('reveals vertical clipping and keeps keyboard Escape dismissed until reentry', () => {
    const p = page(); p.trigger.scrollHeight = 60; p.install();
    p.trigger.emit('focus');
    expect(p.popup().hidden).toBe(false);
    const escaped = p.document.emit('keydown', { key: 'Escape' });
    expect(p.popup().hidden).toBe(true);
    expect(escaped.defaultPrevented).toBe(true);
    expect(escaped.stopped).toBe(true);
    expect(p.trigger.getAttribute('aria-describedby')).toBeNull();
    p.trigger.textContent = 'Reading A Very Long Book Title, 32%';
    p.resize(); p.mutate();
    expect(p.popup().hidden).toBe(true);
    p.trigger.emit('blur'); p.trigger.emit('focus');
    expect(p.popup().hidden).toBe(false);
    p.trigger.emit('keydown', { key: 'Enter' });
    p.trigger.emit('click', { detail: 0 });
    expect(p.popup().hidden).toBe(false);
    p.trigger.emit('click', { detail: 0 });
    expect(p.popup().hidden).toBe(true);
  });

  it.each(['hover', 'pinned'])('updates several same-person reading progress changes while %s remains open', mode => {
    const p = page(); p.clip(); p.install();
    if (mode === 'hover') p.trigger.emit('pointerenter', { pointerType: 'mouse' });
    else p.trigger.emit('click');
    for (const progress of [31, 32, 33]) {
      p.trigger.textContent = `Reading <A Very Long Book Title>, ${progress}%`;
      p.popup().bounds.height = 160;
      p.mutate();
      expect(p.popup().hidden).toBe(false);
      expect(p.popup().textContent).toBe(`Reading <A Very Long Book Title>, ${progress}%`);
      expect(p.popup().children).toHaveLength(0);
      expect(p.popup().style.top).toBe('340px');
    }
    p.document.emit('keydown', { key: 'Escape' });
    p.trigger.textContent = 'Reading <A Very Long Book Title>, 34%'; p.mutate();
    expect(p.popup().hidden).toBe(true);
    p.resize();
    expect(p.popup().hidden).toBe(true);
  });

  it('closes on actual selected-person changes, including identical names and statuses', () => {
    const p = page(); p.clip(); p.install();
    p.trigger.emit('click');
    p.first.setAttribute('aria-pressed', 'false'); p.second.setAttribute('aria-pressed', 'true'); p.mutate();
    expect(p.popup().hidden).toBe(true);
    p.trigger.emit('click');
    p.caption.textContent = 'Someone else'; p.mutate();
    expect(p.popup().hidden).toBe(true);
  });

  it('keeps an open popup within an offset visual viewport as it resizes', () => {
    const p = page(); p.clip(); p.viewport.width = 240; p.viewport.height = 320;
    p.viewport.offsetLeft = 25; p.viewport.offsetTop = 40;
    p.trigger.bounds = { left: 230, right: 260, top: 340, bottom: 360, width: 30, height: 20 };
    p.install(); p.trigger.emit('click');
    expect(p.popup().style.maxWidth).toBe('224px');
    expect(p.popup().style.maxHeight).toBe('304px');
    expect(Number.parseFloat(p.popup().style.left)).toBe(33);
    expect(Number.parseFloat(p.popup().style.top)).toBe(260);
    p.viewport.offsetLeft = 50; p.viewport.offsetTop = 100;
    p.viewport.emit('scroll');
    expect(Number.parseFloat(p.popup().style.left)).toBe(58);
    p.trigger.scrollWidth = p.trigger.clientWidth; p.resize();
    expect(p.popup().hidden).toBe(true);
    expect(p.trigger.tabIndex).toBe(-1);
    p.clip(); p.trigger.emit('click'); p.dock.hidden = true; p.mutate();
    expect(p.popup().hidden).toBe(true);
  });
});
