import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge, type AffinityWord } from '../src/bridge.js';
import { textWriteProbe } from './helpers/text-write-probe.js';
import {
  AffinitiesPanel,
  affinitiesPanelState,
  createAffinitiesPanelSurface,
  type AffinitiesPanelSource,
  type AffinitiesPanelState,
} from '../src/ui/affinities-panel.js';

const INDEX_HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const MAIN_TS = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const PANEL_TS = readFileSync(new URL('../src/ui/affinities-panel.ts', import.meta.url), 'utf8');

const LABELS = ['plants', 'aquarium', 'television', 'radio'];

class Source implements AffinitiesPanelSource {
  selected: number | null = 7;
  value: AffinityWord[] | null = ['Loves', 'Likes', 'Indifferent', 'Hates'];
  readonly asked: number[] = [];
  selectedIndex(): number | null { return this.selected; }
  affinityWordsOf(entity: number): AffinityWord[] | null { this.asked.push(entity); return this.value; }
}

function ready(state: AffinitiesPanelState) {
  if (state.kind !== 'ready') throw new Error(`expected a ready state, got ${state.kind}`);
  return state.rows;
}

describe('affinitiesPanelState', () => {
  it('says nobody is selected without asking the bridge', () => {
    const source = new Source();
    source.selected = null;
    expect(affinitiesPanelState(source, LABELS)).toEqual({ kind: 'unselected' });
    expect(source.asked).toEqual([]);
  });

  it('gives one row per kind in order, the label capitalised and the word from the bridge', () => {
    const source = new Source();
    expect(ready(affinitiesPanelState(source, LABELS))).toEqual([
      { label: 'Plants', word: 'Loves' },
      { label: 'Aquarium', word: 'Likes' },
      { label: 'Television', word: 'Indifferent' },
      { label: 'Radio', word: 'Hates' },
    ]);
    expect(source.asked).toEqual([7]);
    source.value = ['Dislikes', 'Likes', 'Loves', 'Indifferent'];
    expect(ready(affinitiesPanelState(source, LABELS)).map(row => row.word))
      .toEqual(['Dislikes', 'Likes', 'Loves', 'Indifferent']);
  });

  it('is unavailable without a reading, with an empty one, or with one that does not match the labels', () => {
    const source = new Source();
    const words: AffinityWord[][] = [[], ['Likes', 'Likes', 'Likes'], ['Likes', 'Likes', 'Likes', 'Likes', 'Likes']];
    for (const value of [null, ...words]) {
      source.value = value;
      expect(affinitiesPanelState(source, LABELS), JSON.stringify(value)).toEqual({ kind: 'unavailable' });
    }
    source.value = [];
    expect(affinitiesPanelState(source, [])).toEqual({ kind: 'unavailable' });
  });

  it('keeps no thresholds of its own: the words come from the simulation', () => {
    expect(PANEL_TS).not.toMatch(/\b0\.[26]\b/);
    expect(PANEL_TS).not.toContain('function band');
  });
});

describe('AffinitiesPanel', () => {
  it('reads nothing while closed, throttles open reads, and forces a fresh read', () => {
    const source = new Source();
    const rendered: AffinitiesPanelState[] = [];
    let active = false;
    const panel = new AffinitiesPanel(source, LABELS, { render: state => rendered.push(state) }, 100, () => active);
    expect(panel.update(0)).toBe(false);
    expect(source.asked).toEqual([]);
    active = true;
    expect(panel.update(10)).toBe(true);
    expect(panel.update(109)).toBe(false);
    expect(panel.update(110)).toBe(true);
    expect(panel.update(111, true)).toBe(true);
    active = false;
    expect(panel.update(1000)).toBe(false);
    expect(panel.update(1001, true)).toBe(true);
    expect(source.asked).toEqual([7, 7, 7, 7]);
    expect(rendered).toHaveLength(4);
  });

  it.each([0, -1, NaN, Infinity])('refuses a refresh interval of %s', interval => {
    expect(() => new AffinitiesPanel(new Source(), LABELS, { render() {} }, interval, () => true))
      .toThrow('Likes and dislikes panel refresh interval must be a positive finite number');
  });
});

class FakeElement {
  className = '';
  hidden = false;
  readonly dataset: Record<string, string> = {};
  parentElement: FakeElement | null = null;
  readonly nodes: FakeElement[] = [];
  textContent = '';
  constructor(readonly tag = 'div') {}
  append(...children: FakeElement[]): void {
    for (const child of children) { child.remove(); child.parentElement = this; this.nodes.push(child); }
  }
  remove(): void {
    if (this.parentElement === null) return;
    this.parentElement.nodes.splice(this.parentElement.nodes.indexOf(this), 1);
    this.parentElement = null;
  }
}

function surfaceParts() {
  let created = 0;
  const doc = { createElement: (tag: string) => { created += 1; return new FakeElement(tag); } };
  const block = new FakeElement('details');
  const empty = new FakeElement('p');
  const list = new FakeElement('ul');
  const surface = createAffinitiesPanelSurface(doc as unknown as Document, block as unknown as HTMLElement,
    empty as unknown as HTMLElement, list as unknown as HTMLElement);
  return { block, empty, list, surface, created: () => created };
}

describe('createAffinitiesPanelSurface', () => {
  it('asks for a selection, then says when likes and dislikes cannot be read', () => {
    const { block, empty, list, surface } = surfaceParts();
    surface.render({ kind: 'unselected' });
    expect([empty.hidden, list.hidden, empty.textContent])
      .toEqual([false, true, 'Select a person to see their likes and dislikes.']);
    expect(block.hidden).toBe(false);
    expect(block.dataset.state).toBe('unselected');
    surface.render({ kind: 'unavailable' });
    expect([empty.hidden, list.hidden, empty.textContent]).toEqual([false, true, 'Likes and dislikes unavailable']);
    expect(block.dataset.state).toBe('unavailable');
  });

  it('draws one row per kind reading label and word', () => {
    const { block, empty, list, surface } = surfaceParts();
    surface.render(affinitiesPanelState(new Source(), LABELS));
    expect([empty.hidden, list.hidden, block.dataset.state]).toEqual([true, false, 'ready']);
    expect(list.nodes.map(row => [row.tag, row.className, row.textContent])).toEqual([
      ['li', 'affinity-row', 'Plants: Loves'],
      ['li', 'affinity-row', 'Aquarium: Likes'],
      ['li', 'affinity-row', 'Television: Indifferent'],
      ['li', 'affinity-row', 'Radio: Hates'],
    ]);
  });

  it('reuses rows, skips unchanged text, and drops rows once nobody is selected', () => {
    const { list, empty, surface, created } = surfaceParts();
    const source = new Source();
    surface.render(affinitiesPanelState(source, LABELS));
    const rows = [...list.nodes];
    const count = created();
    const leaves = [empty, ...rows];
    const probes = leaves.map(textWriteProbe);
    for (let refresh = 0; refresh < 5; refresh += 1) surface.render(affinitiesPanelState(source, LABELS));
    expect(probes.map(probe => probe.writes)).toEqual(leaves.map(() => 0));
    source.value = ['Loves', 'Likes', 'Hates', 'Hates'];
    surface.render(affinitiesPanelState(source, LABELS));
    expect(probes.reduce((sum, probe) => sum + probe.writes, 0)).toBe(1);
    expect(list.nodes).toEqual(rows);
    expect(created()).toBe(count);
    expect(list.nodes[2].textContent).toBe('Television: Hates');
    source.selected = null;
    surface.render(affinitiesPanelState(source, LABELS));
    expect(list.nodes).toHaveLength(0);
    expect(rows.every(row => row.parentElement === null)).toBe(true);
  });
});

describe('the Likes and dislikes disclosure in the page', () => {
  const IDS = ['affinities-block', 'affinities-empty', 'affinity-list'];

  it.each(IDS)('declares #%s exactly once and main.ts asks for it by that id', id => {
    expect(INDEX_HTML.split(`id="${id}"`)).toHaveLength(2);
    expect(MAIN_TS).toContain(`'#${id}'`);
  });

  it('ships closed directly after Skills inside Overview', () => {
    expect(INDEX_HTML).toContain('<ul id="skill-list" hidden></ul></details>'
      + '<details id="affinities-block"><summary>Likes and dislikes</summary>'
      + '<p id="affinities-empty">Select a person to see their likes and dislikes.</p>'
      + '<ul id="affinity-list" hidden></ul></details></section>');
    const overview = INDEX_HTML.slice(INDEX_HTML.indexOf('id="sim-overview"'), INDEX_HTML.indexOf('id="sim-queue"'));
    expect(overview.indexOf('id="skills-block"')).toBeGreaterThan(-1);
    expect(overview.indexOf('id="affinities-block"')).toBeGreaterThan(overview.indexOf('id="skills-block"'));
  });

  it('refreshes on opening, at start, after Load and an edit, and on visible frames', () => {
    expect(MAIN_TS).toContain('() => affinitiesBlock.open && !simOverview.hidden && !simSheet.hidden');
    const toggle = MAIN_TS.slice(MAIN_TS.indexOf("affinitiesBlock.addEventListener('toggle'"));
    expect(toggle.slice(0, 200)).toContain('if (affinitiesBlock.open) affinitiesPanel.update(performance.now(), true);');
    expect(MAIN_TS).toContain('affinitiesPanel.update(initialHudMs, true);');
    expect(MAIN_TS.split('affinitiesPanel.update(nowMs, true);').length - 1).toBe(2);
    expect(MAIN_TS).toContain('affinitiesPanel.update(nowMs);');
  });
});

describe('the bridge read of likes and dislikes', () => {
  let memory: WebAssembly.Memory;
  beforeAll(async () => {
    memory = (await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') })).memory;
  });

  function fake(words: string[]) {
    let reads = 0;
    const bridge = new SimBridge({
      affinity_words_of: () => { reads += 1; return [...words]; },
    } as unknown as SimHandle, memory);
    return { bridge, reads: () => reads };
  }

  it('copies a reading of the five words', () => {
    expect(fake(['Loves', 'Likes', 'Indifferent', 'Dislikes', 'Hates']).bridge.affinityWordsOf(7))
      .toEqual(['Loves', 'Likes', 'Indifferent', 'Dislikes', 'Hates']);
  });

  it.each([-1, 0.5, NaN, Infinity, 4294967296])('rejects invalid entity %s before calling WASM', entity => {
    const { bridge, reads } = fake(['Likes', 'Likes', 'Likes', 'Likes']);
    expect(bridge.affinityWordsOf(entity)).toBeNull();
    expect(reads()).toBe(0);
  });

  it('rejects an empty reading and one holding any other word', () => {
    for (const words of [[], ['Likes', 'Adores', 'Likes', 'Likes'], ['likes', 'Likes', 'Likes', 'Likes'],
      ['Likes', 'Likes', 'Likes', '']]) {
      expect(fake(words).bridge.affinityWordsOf(7), JSON.stringify(words)).toBeNull();
    }
  });
});
