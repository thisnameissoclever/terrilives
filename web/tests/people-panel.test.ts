import { describe, expect, it } from 'vitest';

import {
  PeoplePanel,
  createPeoplePanelSurface,
  describeRelationship,
  peoplePanelView,
  type PeoplePanelSource,
  type PeoplePanelSurface,
  type PeoplePanelView,
  type PersonRelationship,
} from '../src/ui/people-panel.js';

class MutableSource implements PeoplePanelSource {
  idsValue = new Uint32Array([10, 3, 2]);
  kindsValue = new Uint32Array([0, 0, 0]);
  simIdsByEntity = new Map([
    [3, 0],
    [2, 1],
    [10, 2],
  ]);
  names = new Map([
    [3, 'Terri'],
    [2, 'Doug'],
    [10, 'Nadia'],
  ]);
  relationships = new Map<number, Float32Array>([
    [3, new Float32Array([2, 0.15, 1, -0.3, 99, 0.9])],
    [2, new Float32Array([0, 0.45])],
  ]);
  selected: number | null = 3;

  get count(): number {
    return this.idsValue.length;
  }

  ids(): Uint32Array {
    return this.idsValue;
  }

  simIds(): Uint32Array {
    return Uint32Array.from(
      this.idsValue,
      (entity) => this.simIdsByEntity.get(entity) ?? 0xffff_ffff,
    );
  }

  simName(entityIndex: number): string {
    return this.names.get(entityIndex) ?? '';
  }

  selectedIndex(): number | null {
    return this.selected;
  }

  select(): boolean {
    return true;
  }

  relationshipsOf(entityIndex: number): Float32Array {
    return this.relationships.get(entityIndex) ?? new Float32Array(0);
  }
}

class RecordingSurface implements PeoplePanelSurface {
  views: Array<PeoplePanelView | null> = [];

  render(view: PeoplePanelView | null): void {
    this.views.push(view);
  }
}

class FakeElement {
  className = '';
  textContent: string | null = null;
  hidden = false;
  readonly dataset: Record<string, string> = {};
  readonly style: Record<string, string> = {};
  readonly nodes: FakeElement[] = [];
  private readonly attributes = new Map<string, string>();
  private parent: FakeElement | null = null;

  get children(): { item: (index: number) => FakeElement | null } {
    return { item: (index) => this.nodes[index] ?? null };
  }

  appendChild(child: FakeElement): FakeElement {
    this.insertBefore(child, null);
    return child;
  }

  insertBefore(child: FakeElement, before: FakeElement | null): void {
    child.remove();
    const index = before === null ? this.nodes.length : this.nodes.indexOf(before);
    this.nodes.splice(index < 0 ? this.nodes.length : index, 0, child);
    child.parent = this;
  }

  remove(): void {
    if (this.parent === null) return;
    const index = this.parent.nodes.indexOf(this);
    if (index >= 0) this.parent.nodes.splice(index, 1);
    this.parent = null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  find(className: string): FakeElement {
    if (this.className === className) return this;
    for (const child of this.nodes) {
      try {
        return child.find(className);
      } catch {
        // Keep searching this small fake tree.
      }
    }
    throw new Error(`missing .${className}`);
  }
}

class FakeDocument {
  createElement(): FakeElement {
    return new FakeElement();
  }
}

function person(
  simId: number,
  name: string,
  feeling: number,
): PersonRelationship {
  return {
    simId,
    entity: simId + 10,
    name,
    ...describeRelationship(feeling),
  };
}

describe('describeRelationship', () => {
  it('uses bounded bands that make one authored Chat visible', () => {
    expect(describeRelationship(-2)).toMatchObject({
      feeling: -1,
      percent: 0,
      label: 'Hostile',
      tone: 'negative',
    });
    expect(describeRelationship(-0.3).label).toBe('Dislikes');
    expect(describeRelationship(-0.1).label).toBe('Wary');
    expect(describeRelationship(0).label).toBe('Stranger');
    expect(describeRelationship(0.15).label).toBe('Warm');
    expect(describeRelationship(0.4).label).toBe('Friendly');
    expect(describeRelationship(0.8)).toMatchObject({
      percent: 90,
      label: 'Close',
      tone: 'positive',
    });
    expect(describeRelationship(Number.NaN)).toMatchObject({
      feeling: 0,
      percent: 50,
      label: 'Stranger',
    });
  });
});

describe('peoplePanelView', () => {
  it('merges sparse directional feelings with every other live household member', () => {
    const view = peoplePanelView(new MutableSource());

    expect(view?.selectedName).toBe('Terri');
    expect(view?.people.map(({ simId, name, label }) => ({ simId, name, label }))).toEqual([
      { simId: 1, name: 'Doug', label: 'Dislikes' },
      { simId: 2, name: 'Nadia', label: 'Warm' },
    ]);
    expect(view?.people[0].feeling).toBeCloseTo(-0.3);
    expect(view?.people[1].feeling).toBeCloseTo(0.15);
  });

  it('shows missing pairs as strangers and ignores relationships to absent sims', () => {
    const source = new MutableSource();
    source.relationships.set(3, new Float32Array([99, 0.9]));

    expect(peoplePanelView(source)?.people.map((entry) => entry.label)).toEqual([
      'Stranger',
      'Stranger',
    ]);
  });

  it('returns no selected-person view for deselection or a stale entity index', () => {
    const source = new MutableSource();
    source.selected = null;
    expect(peoplePanelView(source)).toBeNull();
    source.selected = 404;
    expect(peoplePanelView(source)).toBeNull();
  });

  it('keeps each direction independent and treats malformed sparse data as neutral', () => {
    const source = new MutableSource();
    source.selected = 2;
    expect(peoplePanelView(source)?.people.map(({ name, label }) => ({ name, label }))).toEqual([
      { name: 'Terri', label: 'Friendly' },
      { name: 'Nadia', label: 'Stranger' },
    ]);

    source.selected = 3;
    source.relationships.set(
      3,
      new Float32Array([1, Number.NaN, Number.NaN, 0.7, 1.5, 0.4, 2]),
    );
    expect(peoplePanelView(source)?.people.map((entry) => entry.label)).toEqual([
      'Stranger',
      'Stranger',
    ]);
  });
});

describe('PeoplePanel', () => {
  it('reads at HUD cadence and force-refreshes after a loaded world swaps entities', () => {
    const source = new MutableSource();
    const surface = new RecordingSurface();
    const panel = new PeoplePanel(source, surface, 100);

    expect(panel.update(0)).toBe(true);
    expect(panel.update(50)).toBe(false);
    expect(surface.views).toHaveLength(1);

    source.idsValue = new Uint32Array([41, 42, 43]);
    source.simIdsByEntity = new Map([
      [41, 0],
      [42, 1],
      [43, 2],
    ]);
    source.names = new Map([
      [41, 'Terri'],
      [42, 'Doug'],
      [43, 'Nadia'],
    ]);
    source.relationships = new Map([[41, new Float32Array([1, 0.7])]]);
    source.selected = 41;

    expect(panel.update(51, true)).toBe(true);
    expect(surface.views.at(-1)?.people[0]).toMatchObject({
      simId: 1,
      entity: 42,
      label: 'Close',
    });
  });
});

describe('createPeoplePanelSurface', () => {
  it('renders directional accessible meters, reuses rows, and removes stale people', () => {
    const doc = new FakeDocument();
    const caption = new FakeElement();
    const empty = new FakeElement();
    const list = new FakeElement();
    const surface = createPeoplePanelSurface(
      doc as unknown as Document,
      caption as unknown as HTMLElement,
      empty as unknown as HTMLElement,
      list as unknown as HTMLElement,
    );

    surface.render({
      selectedName: 'Terri',
      people: [person(1, 'Doug', -0.3), person(2, 'Nadia', 0.15)],
    });

    expect(caption.textContent).toBe('How Terri feels');
    expect(empty.hidden).toBe(true);
    expect(list.hidden).toBe(false);
    expect(list.nodes).toHaveLength(2);
    const doug = list.nodes[0];
    expect(doug.dataset.tone).toBe('negative');
    expect(doug.find('relationship-name').textContent).toBe('Doug');
    expect(doug.find('relationship-state').textContent).toBe('Dislikes');
    expect(doug.find('relationship-track').getAttribute('aria-label')).toBe(
      "Terri's feeling about Doug",
    );
    expect(doug.find('relationship-track').getAttribute('aria-valuetext')).toBe(
      'Dislikes',
    );
    expect(doug.find('relationship-marker').style.left).toBe('35%');

    surface.render({
      selectedName: 'Terri',
      people: [person(1, 'Douglas', 0.4)],
    });

    expect(list.nodes).toHaveLength(1);
    expect(list.nodes[0]).toBe(doug);
    expect(doug.dataset.tone).toBe('positive');
    expect(doug.find('relationship-name').textContent).toBe('Douglas');
    expect(doug.find('relationship-state').textContent).toBe('Friendly');
    expect(doug.find('relationship-marker').style.left).toBe('70%');

    surface.render(null);
    expect(caption.textContent).toBe('People');
    expect(empty.hidden).toBe(false);
    expect(empty.textContent).toBe(
      'Select a person to see how they feel about the household.',
    );
    expect(list.hidden).toBe(true);
    expect(list.nodes).toHaveLength(0);
  });
});
