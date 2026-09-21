import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  TraitsPanel,
  createTraitsPanelSurface,
  traitsPanelState,
  type TraitLibrary,
  type TraitsPanelSource,
  type TraitsPanelState,
} from '../src/ui/traits-panel.js';

const INDEX_HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const MAIN_TS = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

const LIBRARY: TraitLibrary = {
  labels: ['Television devotee', "Can't cook", 'Low spirits'],
  kinds: ['disposition', 'capability', 'condition'],
  descriptions: [
    'More drawn to watching television.',
    'Often ruins a meal, and gets better with every attempt.',
    'Gets less satisfaction from everything; attending to correspondence eases it.',
  ],
};

class MutableTraitsSource implements TraitsPanelSource {
  selected: number | null = 7;
  worn: Float32Array = new Float32Array([]);
  readonly asked: number[] = [];

  selectedIndex(): number | null {
    return this.selected;
  }

  traitsOf(entity: number): Float32Array {
    this.asked.push(entity);
    return this.worn;
  }
}

class FakeElement {
  className = '';
  hidden = false;
  parentElement: FakeElement | null = null;
  readonly nodes: FakeElement[] = [];
  private value = '';

  get textContent(): string {
    if (this.nodes.length > 0) {
      return this.nodes.map((node) => node.textContent).join('|');
    }
    return this.value;
  }

  set textContent(value: string) {
    for (const node of this.nodes) {
      node.parentElement = null;
    }
    this.nodes.length = 0;
    this.value = value;
  }

  get children(): { item(index: number): FakeElement | null } {
    return { item: (index) => this.nodes[index] ?? null };
  }

  append(...children: FakeElement[]): void {
    for (const child of children) {
      child.remove();
      child.parentElement = this;
      this.nodes.push(child);
    }
  }

  insertBefore(child: FakeElement, before: FakeElement | null): FakeElement {
    child.remove();
    child.parentElement = this;
    const index = before === null ? -1 : this.nodes.indexOf(before);
    if (index < 0) {
      this.nodes.push(child);
    } else {
      this.nodes.splice(index, 0, child);
    }
    return child;
  }

  remove(): void {
    const parent = this.parentElement;
    if (parent === null) {
      return;
    }
    parent.nodes.splice(parent.nodes.indexOf(this), 1);
    this.parentElement = null;
  }
}

class FakeDocument {
  created = 0;

  createElement(): FakeElement {
    this.created += 1;
    return new FakeElement();
  }
}

function surfaceParts() {
  const doc = new FakeDocument();
  const root = new FakeElement();
  const empty = new FakeElement();
  const list = new FakeElement();
  const surface = createTraitsPanelSurface(
    doc as unknown as Document,
    root as unknown as HTMLElement,
    empty as unknown as HTMLElement,
    list as unknown as HTMLElement,
  );
  return { doc, root, empty, list, surface };
}

function ready(state: TraitsPanelState) {
  if (state.kind !== 'ready') {
    throw new Error(`expected a ready state, got ${state.kind}`);
  }
  return state.traits;
}

describe('traitsPanelState', () => {
  it('says nobody is selected without asking the bridge for traits', () => {
    const source = new MutableTraitsSource();
    source.selected = null;
    expect(traitsPanelState(source, LIBRARY)).toEqual({ kind: 'unselected' });
    expect(source.asked).toEqual([]);
  });

  it('asks for the selected entity and words each kind of state its own way', () => {
    const source = new MutableTraitsSource();
    source.worn = new Float32Array([0, 0, 1, 0.25, 2, 0.6]);
    const traits = ready(traitsPanelState(source, LIBRARY));
    expect(source.asked).toEqual([7]);
    expect(traits).toEqual([
      {
        key: 0,
        label: 'Television devotee',
        description: 'More drawn to watching television.',
        state: '',
      },
      {
        key: 1,
        label: "Can't cook",
        description: 'Often ruins a meal, and gets better with every attempt.',
        state: 'Skill 25%',
      },
      {
        key: 2,
        label: 'Low spirits',
        description:
          'Gets less satisfaction from everything; attending to correspondence eases it.',
        state: 'Severity 60%',
      },
    ]);
  });

  it('rounds to a whole percentage and keeps it inside 0 to 100', () => {
    const source = new MutableTraitsSource();
    const stateOf = (value: number) => {
      source.worn = new Float32Array([1, value]);
      return ready(traitsPanelState(source, LIBRARY))[0].state;
    };
    expect(stateOf(0.424)).toBe('Skill 42%');
    expect(stateOf(0.425)).toBe('Skill 43%');
    expect(stateOf(1)).toBe('Skill 100%');
    expect(stateOf(0)).toBe('Skill 0%');
    expect(stateOf(1.5)).toBe('Skill 100%');
    expect(stateOf(-0.5)).toBe('Skill 0%');
  });

  it('is ready and empty for a person with no traits', () => {
    const source = new MutableTraitsSource();
    expect(traitsPanelState(source, LIBRARY)).toEqual({ kind: 'ready', traits: [] });
  });

  it('makes exactly one bridge read per refresh', () => {
    const source = new MutableTraitsSource();
    source.worn = new Float32Array([0, 0, 1, 0.25, 2, 0.6]);
    traitsPanelState(source, LIBRARY);
    expect(source.asked).toHaveLength(1);
  });

  it.each([
    ['an odd number of values', [0, 0, 1]],
    ['an index past the library', [3, 0.5]],
    ['a negative index', [-1, 0.5]],
    ['a fractional index', [0.5, 0.5]],
    ['a state that is not a number', [1, Number.NaN]],
    ['an infinite state', [1, Number.POSITIVE_INFINITY]],
    ['a disposition whose unused state slot is not a number', [0, Number.NaN]],
  ])('is unavailable for %s', (_name, values) => {
    const source = new MutableTraitsSource();
    source.worn = new Float32Array(values);
    expect(traitsPanelState(source, LIBRARY)).toEqual({ kind: 'unavailable' });
  });

  it.each([
    ['labels', { ...LIBRARY, labels: LIBRARY.labels.slice(1) }],
    ['kinds', { ...LIBRARY, kinds: LIBRARY.kinds.slice(1) }],
    ['descriptions', { ...LIBRARY, descriptions: LIBRARY.descriptions.slice(1) }],
  ])('is unavailable when the %s column is a different length', (_name, library) => {
    const source = new MutableTraitsSource();
    source.worn = new Float32Array([0, 0]);
    expect(traitsPanelState(source, library)).toEqual({ kind: 'unavailable' });
  });

  it('is unavailable for a kind it does not know how to word', () => {
    const source = new MutableTraitsSource();
    source.worn = new Float32Array([1, 0.25]);
    const library = { ...LIBRARY, kinds: ['disposition', 'talent', 'condition'] };
    expect(traitsPanelState(source, library)).toEqual({ kind: 'unavailable' });
  });
});

describe('createTraitsPanelSurface', () => {
  it('hides the whole block while nobody is selected, and shows it again after', () => {
    const { root, list, surface } = surfaceParts();
    surface.render({ kind: 'unselected' });
    expect(root.hidden).toBe(true);
    expect(list.hidden).toBe(true);
    surface.render({ kind: 'ready', traits: [] });
    expect(root.hidden).toBe(false);
    surface.render({ kind: 'unselected' });
    expect(root.hidden).toBe(true);
  });

  it('says traits are unavailable in plain words', () => {
    const { root, empty, list, surface } = surfaceParts();
    surface.render({ kind: 'unavailable' });
    expect(root.hidden).toBe(false);
    expect(empty.hidden).toBe(false);
    expect(empty.textContent).toBe('Traits unavailable');
    expect(list.hidden).toBe(true);
  });

  it('says so when the person has no traits', () => {
    const { root, empty, list, surface } = surfaceParts();
    surface.render({ kind: 'ready', traits: [] });
    expect(root.hidden).toBe(false);
    expect(empty.hidden).toBe(false);
    expect(empty.textContent).toBe('No traits.');
    expect(list.hidden).toBe(true);
  });

  it('draws one row per trait: label, state, then the sentence', () => {
    const { root, empty, list, surface } = surfaceParts();
    surface.render({
      kind: 'ready',
      traits: [
        { key: 1, label: "Can't cook", description: 'Often ruins a meal.', state: 'Skill 25%' },
        { key: 0, label: 'Television devotee', description: 'More drawn to it.', state: '' },
      ],
    });
    expect(root.hidden).toBe(false);
    expect(empty.hidden).toBe(true);
    expect(list.hidden).toBe(false);
    expect(list.nodes.map((row) => row.className)).toEqual(['trait-row', 'trait-row']);
    expect(list.nodes[0].textContent).toBe("Can't cook|Skill 25%|Often ruins a meal.");
    expect(list.nodes[1].textContent).toBe('Television devotee||More drawn to it.');
    const state = list.nodes[1].nodes[0].nodes[1];
    expect(state.className).toBe('trait-state');
    expect(state.hidden).toBe(true);
    expect(list.nodes[0].nodes[0].nodes[1].hidden).toBe(false);
  });

  it('updates a row in place, and drops the rows of whoever was selected before', () => {
    const { doc, list, surface } = surfaceParts();
    const cook = { key: 1, label: "Can't cook", description: 'Often ruins a meal.' };
    surface.render({
      kind: 'ready',
      traits: [
        { ...cook, state: 'Skill 25%' },
        { key: 2, label: 'Low spirits', description: 'Eases.', state: 'Severity 60%' },
      ],
    });
    const cookRow = list.nodes[0];
    const created = doc.created;

    surface.render({ kind: 'ready', traits: [{ ...cook, state: 'Skill 27%' }] });
    expect(list.nodes).toEqual([cookRow]);
    expect(cookRow.textContent).toBe("Can't cook|Skill 27%|Often ruins a meal.");
    expect(doc.created).toBe(created);

    surface.render({ kind: 'unselected' });
    expect(list.nodes).toEqual([]);
  });

  it('puts rows in the order given even when a kept row has to move', () => {
    const { list, surface } = surfaceParts();
    const a = { key: 0, label: 'A', description: 'a.', state: '' };
    const b = { key: 1, label: 'B', description: 'b.', state: '' };
    surface.render({ kind: 'ready', traits: [a, b] });
    surface.render({ kind: 'ready', traits: [b, a] });
    expect(list.nodes.map((row) => row.nodes[0].nodes[0].textContent)).toEqual(['B', 'A']);
  });
});

describe('TraitsPanel', () => {
  function panelWith(refreshMs: number) {
    const source = new MutableTraitsSource();
    const rendered: TraitsPanelState[] = [];
    const panel = new TraitsPanel(
      source,
      LIBRARY,
      { render: (state) => rendered.push(state) },
      refreshMs,
    );
    return { source, rendered, panel };
  }

  it('renders at once, then only after the refresh interval or when forced', () => {
    const { rendered, panel } = panelWith(250);
    expect(panel.update(1000)).toBe(true);
    expect(panel.update(1249)).toBe(false);
    expect(panel.update(1250)).toBe(true);
    expect(panel.update(1251)).toBe(false);
    expect(panel.update(1251, true)).toBe(true);
    expect(rendered).toHaveLength(3);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses a refresh interval of %s',
    (refreshMs) => {
      expect(() => panelWith(refreshMs)).toThrow(
        'Traits panel refresh interval must be a positive finite number',
      );
    },
  );
});

describe('the Traits block in the page', () => {
  // main.ts throws when any of these is missing, and nothing else would say
  // why the page stopped starting. The markup and the wiring are two files
  // that have to agree on three ids.
  const IDS = ['traits-block', 'traits-empty', 'trait-list'];

  it.each(IDS)('declares #%s exactly once and main.ts asks for it by that id', (id) => {
    expect(INDEX_HTML.split(`id="${id}"`)).toHaveLength(2);
    expect(MAIN_TS).toContain(`'#${id}'`);
  });

  it('starts hidden, is named for assistive technology, and sits below the need bars', () => {
    expect(INDEX_HTML).toContain('<section id="traits-block" aria-label="Traits" hidden>');
    const needs = INDEX_HTML.indexOf('id="needs-content"');
    const traits = INDEX_HTML.indexOf('id="traits-block"');
    const people = INDEX_HTML.indexOf('id="people-panel"');
    expect(needs).toBeGreaterThan(-1);
    expect(traits).toBeGreaterThan(needs);
    expect(people).toBeGreaterThan(traits);

    // The need bars are appended to the END of #needs-content at runtime, so
    // "below the bars" means OUTSIDE that div and after it. Between the two
    // ids every div that opens must close, plus one more: #needs-content's.
    const between = INDEX_HTML.slice(needs, traits);
    const opened = between.split('<div').length - 1;
    const closed = between.split('</div>').length - 1;
    expect(closed - opened).toBe(1);
  });

  it('is not a heading, so it does not file itself under the household roster', () => {
    const block = INDEX_HTML.slice(
      INDEX_HTML.indexOf('id="traits-block"'),
      INDEX_HTML.indexOf('id="people-panel"'),
    );
    expect(block).not.toMatch(/<h[1-6]/);
  });
});
