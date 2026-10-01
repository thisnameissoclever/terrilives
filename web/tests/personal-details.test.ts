import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { SimDetails } from '../src/bridge.js';
import { PersonalDetailsPanel, createPersonalDetailsSurface, personalDetailsState, sleepTiming,
  type PersonalDetailsSource, type PersonalDetailsState } from '../src/ui/personal-details.js';

const names = ['Hunger', 'Energy', 'Comfort', 'Fun', 'Social', 'Hygiene', 'Bladder'];
function details(): SimDetails {
  return { sleepOffsetTicks: -75, drain: [0.5, 0.6, 0.7, 0.8, 0.9, 1.1, 1.2],
    refill: [1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9],
    repeated: [{ key: '2:0', object: 'Armchair', activity: 'Rest', repetition: 0.345 }] };
}
class Source implements PersonalDetailsSource {
  selected: number | null = 7;
  value: SimDetails | null = details();
  asked: number[] = [];
  selectedIndex() { return this.selected; }
  simDetailsOf(entity: number) { this.asked.push(entity); return this.value; }
  dayTicks() { return 6000; }
}
function ready(state: PersonalDetailsState) {
  if (state.kind !== 'ready') throw new Error(`Expected ready, got ${state.kind}`);
  return state;
}

describe('personal details values and refresh', () => {
  it('keeps all need columns aligned and shows repetition rather than remaining benefit', () => {
    const source = new Source();
    const state = ready(personalDetailsState(source, names.map(name => name.toLowerCase())));
    expect(source.asked).toEqual([7]);
    expect(state.sleep).toBe('18 game min earlier');
    expect(state.needs).toEqual(names.map((name, index) => ({ name,
      drain: ['50%', '60%', '70%', '80%', '90%', '110%', '120%'][index],
      refill: ['130%', '140%', '150%', '160%', '170%', '180%', '190%'][index] })));
    expect(state.repeated).toMatchObject([{ key: '2:0', object: 'Armchair', activity: 'Rest', percent: 35 }]);
  });

  it('converts signed sleep offsets using content day length, including a saved zero', () => {
    expect(sleepTiming(-125, 6000)).toBe('30 game min earlier');
    expect(sleepTiming(125, 12000)).toBe('15 game min later');
    expect(sleepTiming(0, 6000)).toBe('Usual schedule');
    expect(sleepTiming(7, 6000)).toBe('1.7 game min later');
    for (const [offset, day] of [[NaN, 6000], [Infinity, 6000], [1, 0], [1, -1], [1, NaN], [1, Infinity]]) {
      expect(sleepTiming(offset, day)).toBeNull();
    }
  });

  it('clears missing people and rejects mismatched columns without reading an absent selection', () => {
    const source = new Source();
    source.selected = null;
    expect(personalDetailsState(source, names)).toEqual({ kind: 'unselected' });
    expect(source.asked).toEqual([]);
    source.selected = 42; source.value = null;
    expect(personalDetailsState(source, names)).toEqual({ kind: 'unavailable' });
    source.value = { ...details(), drain: [1] };
    expect(personalDetailsState(source, names)).toEqual({ kind: 'unavailable' });
    source.value = { ...details(), refill: [1] };
    expect(personalDetailsState(source, names)).toEqual({ kind: 'unavailable' });
  });

  it('does no reads while closed, throttles open reads, and forces a fresh same-index load', () => {
    const source = new Source();
    const states: PersonalDetailsState[] = [];
    let active = false;
    const panel = new PersonalDetailsPanel(source, names, { render: state => states.push(state) }, 100, () => active);
    expect(panel.update(0)).toBe(false);
    expect(source.asked).toEqual([]);
    active = true;
    expect(panel.update(10)).toBe(true);
    expect(panel.update(109)).toBe(false);
    expect(panel.update(110)).toBe(true);
    source.value = { ...details(), sleepOffsetTicks: 75, repeated: [] };
    expect(panel.update(111, true)).toBe(true);
    expect(ready(states.at(-1)!)).toMatchObject({ sleep: '18 game min later', repeated: [] });
    source.selected = null;
    expect(panel.update(112, true)).toBe(true);
    expect(states.at(-1)).toEqual({ kind: 'unselected' });
    active = false;
    expect(panel.update(1000)).toBe(false);
    expect(source.asked).toEqual([7, 7, 7]);
  });

  it.each([0, -1, NaN, Infinity])('rejects invalid refresh interval %s', interval => {
    expect(() => new PersonalDetailsPanel(new Source(), names, { render() {} }, interval, () => true)).toThrow();
  });
});

/** DOM ownership matters here: removed rows must not remain readable after Load. */
class Node {
  hidden = false;
  className = '';
  scope = '';
  min = 0;
  max = 0;
  value = 0;
  parent: Node | null = null;
  nodes: Node[] = [];
  attributes = new Map<string, string>();
  private text = '';
  constructor(readonly tag: string) {}
  get parentElement(): Node | null { return this.parent; }
  get textContent(): string { return this.text + this.nodes.map(node => node.textContent).join('|'); }
  set textContent(text: string) { this.replaceChildren(); this.text = text; }
  get children() { return { item: (index: number) => this.nodes[index] ?? null }; }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  remove() { if (this.parent) this.parent.nodes.splice(this.parent.nodes.indexOf(this), 1); this.parent = null; }
  append(...nodes: Node[]) { for (const node of nodes) { node.remove(); node.parent = this; this.nodes.push(node); } }
  replaceChildren(...nodes: Node[]) { for (const node of [...this.nodes]) node.remove(); this.text = ''; this.append(...nodes); }
  insertBefore(node: Node, before: Node | null) {
    node.remove(); node.parent = this;
    const index = before ? this.nodes.indexOf(before) : -1;
    if (index < 0) this.nodes.push(node); else this.nodes.splice(index, 0, node);
  }
  all(tag: string): Node[] { return this.nodes.flatMap(node => [...(node.tag === tag ? [node] : []), ...node.all(tag)]); }
}
function surface() {
  let created = 0;
  const document = { createElement: (tag: string) => { created++; return new Node(tag); } };
  const empty = new Node('p');
  const content = new Node('div');
  const view = createPersonalDetailsSurface(document as unknown as Document, empty as unknown as HTMLElement, content as unknown as HTMLElement);
  return { empty, content, view, created: () => created };
}

describe('personal details surface', () => {
  it('switches between valid people using the selected ID and removes the previous habits', () => {
    const source = new Source();
    const { content, view } = surface();
    const panel = new PersonalDetailsPanel(source, names, view, 100, () => true);
    panel.update(0);
    expect(content.textContent).toContain('Armchair');
    source.selected = 11;
    source.value = { sleepOffsetTicks: 0, drain: names.map(() => 1), refill: names.map(() => 2),
      repeated: [{ key: '8:1', object: 'Bookcase', activity: 'Read', repetition: 0.6 }] };
    panel.update(100);
    expect(source.asked).toEqual([7, 11]);
    expect(content.textContent).not.toContain('Armchair');
    expect(content.textContent).not.toContain('18 game min earlier');
    expect(content.textContent).toContain('Bookcase|Read');
    expect(content.all('td').map(node => node.textContent)).toEqual(names.flatMap(() => ['100%', '200%']));
  });

  it('exposes table headers, text percentages and named meters without live announcements', () => {
    const { content, empty, view } = surface();
    view.render(personalDetailsState(new Source(), names));
    expect(empty.hidden).toBe(true);
    expect(content.hidden).toBe(false);
    expect(content.all('th').map(node => [node.textContent, node.scope])).toEqual([
      ['Need', 'col'], ['Drain', 'col'], ['Refill', 'col'], ...names.map(name => [name, 'row'])]);
    expect(content.textContent).toContain('120%|190%');
    expect(content.textContent).toContain("reduces an activity's appeal");
    expect(content.textContent).toContain('same type');
    const meter = content.all('meter')[0];
    expect([meter.min, meter.max, meter.value]).toEqual([0, 100, 35]);
    expect(meter.attributes.get('aria-label')).toBe('Armchair: Rest, recent repetition');
    expect(content.textContent).toContain('35%');
    expect(content.all('div').every(node => !node.attributes.has('aria-live'))).toBe(true);
  });

  it('reuses activity nodes across updates, changes ordering, and removes stale rows after Load', () => {
    const { content, empty, view, created } = surface();
    const state = ready(personalDetailsState(new Source(), names));
    const other = { key: '3:1', object: '<Bed>', activity: 'Sleep', percent: 62 };
    view.render({ ...state, repeated: [...state.repeated, other] });
    const [first, second] = content.all('li');
    const count = created();
    view.render({ ...state, repeated: [other, { ...state.repeated[0], percent: 20 }] });
    expect(content.all('li')).toEqual([second, first]);
    expect(created()).toBe(count);
    expect(content.all('meter').map(node => node.value)).toEqual([62, 20]);
    expect(content.textContent).toContain('<Bed>');
    view.render({ ...state, repeated: [other] });
    expect(first.parent).toBeNull();
    expect(content.all('li')).toEqual([second]);
    view.render({ kind: 'unavailable' });
    expect(content.hidden).toBe(true);
    expect(empty.hidden).toBe(false);
    expect(empty.textContent).toBe('Personal details unavailable.');
    expect(content.all('td')).toHaveLength(0);
    expect(content.all('li')).toHaveLength(0);
    expect(content.textContent).not.toContain('<Bed>');
    view.render({ kind: 'unselected' });
    expect(empty.textContent).toBe('Select a person to see their personality and habits.');
    view.render({ ...state, repeated: [] });
    expect(content.hidden).toBe(false);
    expect(content.all('ul')[0].hidden).toBe(true);
    expect(content.all('p').find(node => node.textContent === 'No repeated activities recorded.')?.hidden).toBe(false);
  });

  it('ships a closed Overview disclosure and refreshes it on opening, Load and visible frames', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    expect(html.match(/<details\b[^>]*id="personal-details"[^>]*>/)?.[0]).toBe('<details id="personal-details">');
    expect(main).toContain('() => personalDetails.open && !simOverview.hidden && !simSheet.hidden');
    expect(main).toContain("personalDetails.addEventListener('toggle', () => {\n    if (personalDetails.open) personalDetailsPanel.update(performance.now(), true);");
    expect(main).toContain('personalDetailsPanel.update(nowMs, true);');
    expect(main).toContain('personalDetailsPanel.update(nowMs);');
  });
});
