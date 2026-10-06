import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge, type SkillStanding } from '../src/bridge.js';
import { textWriteProbe } from './helpers/text-write-probe.js';
import {
  SkillsPanel,
  createSkillsPanelSurface,
  skillsPanelState,
  type SkillLibrary,
  type SkillsPanelSource,
  type SkillsPanelState,
} from '../src/ui/skills-panel.js';

const INDEX_HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const MAIN_TS = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

const LIBRARY: SkillLibrary = {
  labels: ['Cooking', 'Fitness', 'Reading'],
  descriptions: [
    'Turning ingredients into a meal somebody will eat.',
    'Getting more out of a workout each time.',
    'Getting through a book, and getting something from it.',
  ],
  levels: [10, 10, 10],
};

function standing(level: number, progress: number, mastery: number): SkillStanding {
  return { level, progress, mastery };
}

class Source implements SkillsPanelSource {
  selected: number | null = 7;
  value: SkillStanding[] | null = [standing(0, 0, 0), standing(2, 0.5, 0.25), standing(10, 0, 1)];
  readonly asked: number[] = [];
  selectedIndex(): number | null { return this.selected; }
  skillsOf(entity: number): SkillStanding[] | null { this.asked.push(entity); return this.value; }
}

function ready(state: SkillsPanelState) {
  if (state.kind !== 'ready') throw new Error(`expected a ready state, got ${state.kind}`);
  return state.skills;
}

describe('skillsPanelState', () => {
  it('says nobody is selected without asking the bridge', () => {
    const source = new Source();
    source.selected = null;
    expect(skillsPanelState(source, LIBRARY)).toEqual({ kind: 'unselected' });
    expect(source.asked).toEqual([]);
  });

  it('words level 0, a level part way up, and the top of the ladder', () => {
    const source = new Source();
    expect(ready(skillsPanelState(source, LIBRARY))).toEqual([
      { label: 'Cooking', description: LIBRARY.descriptions[0], standing: 'Level 0 of 10, 0% to the next level' },
      { label: 'Fitness', description: LIBRARY.descriptions[1], standing: 'Level 2 of 10, 50% to the next level' },
      { label: 'Reading', description: LIBRARY.descriptions[2], standing: 'Level 10 of 10' },
    ]);
    expect(source.asked).toEqual([7]);
  });

  it('floors progress to a whole percentage and reads each skill against its own ladder', () => {
    const source = new Source();
    source.value = [standing(3, 0.259, 0.3259), standing(0, 0.996, 0.0996), standing(4, 0, 1)];
    expect(ready(skillsPanelState(source, { ...LIBRARY, levels: [10, 10, 4] })).map(skill => skill.standing))
      .toEqual(['Level 3 of 10, 25% to the next level', 'Level 0 of 10, 99% to the next level', 'Level 4 of 4']);
  });

  it('never reads 100% while the person is still on the lower level', () => {
    const source = new Source();
    source.value = [standing(5, 0.995, 0.5995), standing(9, 0.99999994, 0.99999994), standing(10, 0, 1)];
    expect(ready(skillsPanelState(source, LIBRARY)).map(skill => skill.standing)).toEqual([
      'Level 5 of 10, 99% to the next level', 'Level 9 of 10, 99% to the next level', 'Level 10 of 10']);
  });

  it('is unavailable when the library columns do not line up', () => {
    for (const library of [
      { ...LIBRARY, descriptions: LIBRARY.descriptions.slice(1) },
      { ...LIBRARY, levels: [10, 10] },
      { ...LIBRARY, labels: [...LIBRARY.labels, 'Extra'] },
    ]) {
      expect(skillsPanelState(new Source(), library)).toEqual({ kind: 'unavailable' });
    }
  });

  it('is unavailable when the person has no reading or one that does not match the library', () => {
    const source = new Source();
    source.value = null;
    expect(skillsPanelState(source, LIBRARY)).toEqual({ kind: 'unavailable' });
    source.value = [standing(0, 0, 0), standing(1, 0, 0.1)];
    expect(skillsPanelState(source, LIBRARY)).toEqual({ kind: 'unavailable' });
    source.value = [standing(0, 0, 0), standing(1, 0, 0.1), standing(11, 0, 1)];
    expect(skillsPanelState(source, LIBRARY)).toEqual({ kind: 'unavailable' });
    source.value = [];
    expect(skillsPanelState(source, { labels: [], descriptions: [], levels: [] })).toEqual({ kind: 'unavailable' });
  });
});

describe('SkillsPanel', () => {
  it('reads nothing while closed, throttles open reads, and forces a fresh read', () => {
    const source = new Source();
    const rendered: SkillsPanelState[] = [];
    let active = false;
    const panel = new SkillsPanel(source, LIBRARY, { render: state => rendered.push(state) }, 100, () => active);
    expect(panel.update(0)).toBe(false);
    expect(source.asked).toEqual([]);
    active = true;
    expect(panel.update(10)).toBe(true);
    expect(panel.update(109)).toBe(false);
    expect(panel.update(110)).toBe(true);
    expect(panel.update(111, true)).toBe(true);
    active = false;
    expect(panel.update(1000)).toBe(false);
    expect(source.asked).toEqual([7, 7, 7]);
    expect(rendered).toHaveLength(3);
  });

  it.each([0, -1, NaN, Infinity])('refuses a refresh interval of %s', interval => {
    expect(() => new SkillsPanel(new Source(), LIBRARY, { render() {} }, interval, () => true))
      .toThrow('Skills panel refresh interval must be a positive finite number');
  });
});

class FakeElement {
  className = '';
  hidden = false;
  readonly dataset: Record<string, string> = {};
  parentElement: FakeElement | null = null;
  readonly nodes: FakeElement[] = [];
  private value = '';
  constructor(readonly tag = 'div') {}
  get textContent(): string {
    return this.nodes.length > 0 ? this.nodes.map(node => node.textContent).join('|') : this.value;
  }
  set textContent(value: string) {
    for (const node of this.nodes) node.parentElement = null;
    this.nodes.length = 0;
    this.value = value;
  }
  get children(): { item(index: number): FakeElement | null } {
    return { item: index => this.nodes[index] ?? null };
  }
  append(...children: FakeElement[]): void {
    for (const child of children) { child.remove(); child.parentElement = this; this.nodes.push(child); }
  }
  insertBefore(child: FakeElement, before: FakeElement | null): FakeElement {
    child.remove();
    child.parentElement = this;
    const index = before === null ? -1 : this.nodes.indexOf(before);
    if (index < 0) this.nodes.push(child); else this.nodes.splice(index, 0, child);
    return child;
  }
  remove(): void {
    if (this.parentElement === null) return;
    this.parentElement.nodes.splice(this.parentElement.nodes.indexOf(this), 1);
    this.parentElement = null;
  }
  all(className: string): FakeElement[] {
    return this.nodes.flatMap(node => [...(node.className === className ? [node] : []), ...node.all(className)]);
  }
}

function surfaceParts() {
  let created = 0;
  const doc = { createElement: (tag: string) => { created += 1; return new FakeElement(tag); } };
  const block = new FakeElement('details');
  const empty = new FakeElement('p');
  const list = new FakeElement('ul');
  const surface = createSkillsPanelSurface(doc as unknown as Document, block as unknown as HTMLElement,
    empty as unknown as HTMLElement, list as unknown as HTMLElement);
  return { block, empty, list, surface, created: () => created };
}

describe('createSkillsPanelSurface', () => {
  it('asks for a selection, then says when skills cannot be read', () => {
    const { block, empty, list, surface } = surfaceParts();
    surface.render({ kind: 'unselected' });
    expect([empty.hidden, list.hidden, empty.textContent]).toEqual([false, true, 'Select a person to see their skills.']);
    expect(block.hidden).toBe(false);
    expect(block.dataset.state).toBe('unselected');
    surface.render({ kind: 'unavailable' });
    expect([empty.hidden, list.hidden, empty.textContent]).toEqual([false, true, 'Skills unavailable']);
    expect(block.dataset.state).toBe('unavailable');
  });

  it('draws one row per skill: label, standing, then the sentence', () => {
    const { block, empty, list, surface } = surfaceParts();
    surface.render(skillsPanelState(new Source(), LIBRARY));
    expect([empty.hidden, list.hidden, block.dataset.state]).toEqual([true, false, 'ready']);
    expect(list.nodes.map(row => [row.tag, row.className])).toEqual([
      ['li', 'skill-row'], ['li', 'skill-row'], ['li', 'skill-row']]);
    expect(list.nodes[1].textContent)
      .toBe('Fitness|Level 2 of 10, 50% to the next level|Getting more out of a workout each time.');
    expect(list.nodes[2].all('skill-standing')[0].textContent).toBe('Level 10 of 10');
  });

  it('reuses rows, skips unchanged text, and drops rows once nobody is selected', () => {
    const { list, empty, surface, created } = surfaceParts();
    const source = new Source();
    surface.render(skillsPanelState(source, LIBRARY));
    const rows = [...list.nodes];
    const count = created();
    const leaves = [empty, ...['skill-label', 'skill-standing', 'skill-description'].flatMap(name => list.all(name))];
    const probes = leaves.map(textWriteProbe);
    for (let refresh = 0; refresh < 5; refresh += 1) surface.render(skillsPanelState(source, LIBRARY));
    expect(probes.map(probe => probe.writes)).toEqual(leaves.map(() => 0));
    source.value = [standing(1, 0, 0.1), standing(2, 0.5, 0.25), standing(10, 0, 1)];
    surface.render(skillsPanelState(source, LIBRARY));
    expect(probes.reduce((sum, probe) => sum + probe.writes, 0)).toBe(1);
    expect(list.nodes).toEqual(rows);
    expect(created()).toBe(count);
    expect(list.nodes[0].all('skill-standing')[0].textContent).toBe('Level 1 of 10, 0% to the next level');
    source.selected = null;
    surface.render(skillsPanelState(source, LIBRARY));
    expect(list.nodes).toHaveLength(0);
    expect(rows.every(row => row.parentElement === null)).toBe(true);
  });
});

describe('the Skills disclosure in the page', () => {
  const IDS = ['skills-block', 'skills-empty', 'skill-list'];

  it.each(IDS)('declares #%s exactly once and main.ts asks for it by that id', id => {
    expect(INDEX_HTML.split(`id="${id}"`)).toHaveLength(2);
    expect(MAIN_TS).toContain(`'#${id}'`);
  });

  it('ships closed directly after the personal details inside Overview', () => {
    expect(INDEX_HTML).toContain('</details><details id="skills-block"><summary>Skills</summary>'
      + '<p id="skills-empty">Select a person to see their skills.</p><ul id="skill-list" hidden></ul></details><details id="affinities-block">');
    const overview = INDEX_HTML.slice(INDEX_HTML.indexOf('id="sim-overview"'), INDEX_HTML.indexOf('id="sim-queue"'));
    expect(overview.indexOf('id="personal-details"')).toBeGreaterThan(-1);
    expect(overview.indexOf('id="skills-block"')).toBeGreaterThan(overview.indexOf('id="personal-details"'));
  });

  it('refreshes on opening, at start, after Load and an edit, and on visible frames', () => {
    expect(MAIN_TS).toContain('() => skillsBlock.open && !simOverview.hidden && !simSheet.hidden');
    const toggle = MAIN_TS.slice(MAIN_TS.indexOf("skillsBlock.addEventListener('toggle'"));
    expect(toggle.slice(0, 200)).toContain('if (skillsBlock.open) skillsPanel.update(performance.now(), true);');
    expect(MAIN_TS).toContain('skillsPanel.update(initialHudMs, true);');
    expect(MAIN_TS.split('skillsPanel.update(nowMs, true);').length - 1).toBe(2);
    expect(MAIN_TS).toContain('skillsPanel.update(nowMs);');
  });
});

describe('skills through release WASM', () => {
  let memory: WebAssembly.Memory;
  beforeAll(async () => {
    memory = (await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') })).memory;
  });

  it('reads the cooking skill Casey starts with as level 2 of 10, half way, without changing saves', () => {
    const handle = SimHandle.from_lot();
    try {
      const bridge = new SimBridge(handle, memory);
      const library: SkillLibrary = {
        labels: bridge.skillLabels(), descriptions: bridge.skillDescriptions(), levels: bridge.skillLevels() };
      expect(library.labels).toEqual(['Cooking', 'Fitness', 'Reading']);
      expect(library.levels).toEqual([10, 10, 10]);
      const ids = Array.from(bridge.ids());
      const kinds = bridge.kinds();
      const people = ids.filter((_, index) => kinds[index] === 0);
      const casey = people.find(id => bridge.simName(id) === 'Casey');
      expect(casey).toBeDefined();
      const before = handle.save_bytes();
      for (const person of people) {
        expect(bridge.skillsOf(person)).toHaveLength(3);
      }
      const skills = bridge.skillsOf(casey!)!;
      expect(skills[0].level).toBe(2);
      expect(skills[0].mastery).toBeCloseTo(0.25, 6);
      const state = skillsPanelState({ selectedIndex: () => casey!, skillsOf: entity => bridge.skillsOf(entity) }, library);
      expect(ready(state)[0]).toEqual({ label: 'Cooking', description: library.descriptions[0],
        standing: 'Level 2 of 10, 50% to the next level' });
      const object = ids.find((_, index) => kinds[index] !== 0)!;
      expect(object).toBeDefined();
      expect(bridge.skillsOf(object)).toBeNull();
      expect(bridge.skillsOf(0xffffffff)).toBeNull();
      expect(handle.save_bytes()).toEqual(before);
    } finally { handle.free(); }
  });

  function fake(values: number[], levels = [10, 10]) {
    let reads = 0;
    const bridge = new SimBridge({
      skills_of: () => { reads += 1; return new Float32Array(values); },
      skill_levels: () => new Uint32Array(levels),
    } as unknown as SimHandle, memory);
    return { bridge, reads: () => reads };
  }

  it('turns aligned triples into standings', () => {
    expect(fake([0, 0, 0, 10, 0, 1]).bridge.skillsOf(7)).toEqual([standing(0, 0, 0), standing(10, 0, 1)]);
  });

  it.each([-1, 0.5, NaN, Infinity, 4294967296])('rejects invalid entity %s before calling WASM', entity => {
    const { bridge, reads } = fake([0, 0, 0, 10, 0, 1]);
    expect(bridge.skillsOf(entity)).toBeNull();
    expect(reads()).toBe(0);
  });

  it('rejects empty, truncated, misaligned and out-of-range readings', () => {
    for (const values of [[], [0, 0, 0], [0, 0, 0, 1, 0], [0, 0, 0, 1, 0, 0.1, 2, 0, 0.2],
      [0.5, 0, 0, 1, 0, 0.1], [-1, 0, 0, 1, 0, 0.1], [11, 0, 1, 1, 0, 0.1],
      [0, 1, 0, 1, 0, 0.1], [0, -0.1, 0, 1, 0, 0.1], [0, NaN, 0, 1, 0, 0.1],
      [0, 0, 1.1, 1, 0, 0.1], [0, 0, -0.1, 1, 0, 0.1], [0, 0, NaN, 1, 0, 0.1]]) {
      expect(fake(values).bridge.skillsOf(7), JSON.stringify(values)).toBeNull();
    }
  });
});
