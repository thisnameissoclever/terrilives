import { describe, expect, it } from 'vitest';

import {
  HouseholdRoster,
  createHouseholdRosterSurface,
  householdMembers,
  type HouseholdMember,
  type HouseholdRosterSource,
  type HouseholdRosterSurface,
} from '../src/ui/household-roster.js';

class FakeButton {
  type = '';
  className = '';
  textContent: string | null = null;
  private readonly attributes = new Map<string, string>();
  private clickListener: (() => void) | null = null;

  constructor(private readonly root: FakeRoot) {}

  addEventListener(type: string, listener: () => void): void {
    if (type === 'click') this.clickListener = listener;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  click(): void {
    this.clickListener?.();
  }

  focus(): void {
    this.root.doc.activeElement = this;
  }

  remove(): void {
    this.root.remove(this);
  }
}

class FakeDocument {
  activeElement: FakeButton | null = null;
  root!: FakeRoot;

  createElement(): FakeButton {
    return new FakeButton(this.root);
  }
}

class FakeRoot {
  readonly items: FakeButton[] = [];
  insertions = 0;

  constructor(readonly doc: FakeDocument) {
    doc.root = this;
  }

  get children(): { item: (index: number) => FakeButton | null } {
    return { item: (index) => this.items[index] ?? null };
  }

  insertBefore(button: FakeButton, before: FakeButton | null): void {
    this.insertions++;
    const oldIndex = this.items.indexOf(button);
    if (oldIndex >= 0) {
      this.items.splice(oldIndex, 1);
      if (this.doc.activeElement === button) this.doc.activeElement = null;
    }
    const nextIndex = before === null ? this.items.length : this.items.indexOf(before);
    this.items.splice(nextIndex < 0 ? this.items.length : nextIndex, 0, button);
  }

  remove(button: FakeButton): void {
    const index = this.items.indexOf(button);
    if (index >= 0) this.items.splice(index, 1);
    if (this.doc.activeElement === button) this.doc.activeElement = null;
  }
}

class MutableSource implements HouseholdRosterSource {
  idsValue = new Uint32Array([10, 3, 8, 2, 5]);
  kindsValue = new Uint32Array([0, 0, 1, 0, 0]);
  simIdsByEntity = new Map([
    [10, 2],
    [3, 0],
    [2, 1],
  ]);
  names = new Map([
    [10, 'Nadia'],
    [3, 'Terri'],
    [2, 'Doug'],
  ]);
  selected: number | null = 3;
  acceptSelection = true;
  readonly selections: number[] = [];

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

  select(entityIndex: number): boolean {
    this.selections.push(entityIndex);
    return this.acceptSelection;
  }
}

class RecordingSurface implements HouseholdRosterSurface {
  members: readonly HouseholdMember[] = [];
  selectedSimId: number | null = null;
  private pick: ((simId: number) => void) | null = null;

  render(
    members: readonly HouseholdMember[],
    selectedSimId: number | null,
    onSelect: (simId: number) => void,
  ): void {
    this.members = members;
    this.selectedSimId = selectedSimId;
    this.pick = onSelect;
  }

  select(simId: number): void {
    if (this.pick === null) throw new Error('roster has not rendered');
    this.pick(simId);
  }
}

describe('householdMembers', () => {
  it('returns only named household people in stable declaration order', () => {
    const source = new MutableSource();
    expect(householdMembers(source)).toEqual([
      { simId: 0, entity: 3, name: 'Terri' },
      { simId: 1, entity: 2, name: 'Doug' },
      { simId: 2, entity: 10, name: 'Nadia' },
    ]);
  });

  it('represents all six members allowed by the M1 household contract', () => {
    const source = new MutableSource();
    source.idsValue = new Uint32Array([16, 11, 15, 12, 14, 13]);
    source.kindsValue = new Uint32Array([0, 0, 0, 0, 0, 0]);
    source.simIdsByEntity = new Map([
      [11, 0],
      [12, 1],
      [13, 2],
      [14, 3],
      [15, 4],
      [16, 5],
    ]);
    source.names = new Map(
      Array.from({ length: 6 }, (_, index) => [11 + index, `Person ${index + 1}`]),
    );

    expect(householdMembers(source).map((member) => member.name)).toEqual([
      'Person 1',
      'Person 2',
      'Person 3',
      'Person 4',
      'Person 5',
      'Person 6',
    ]);
  });

  it('copies WASM views before a name lookup can detach linear memory', () => {
    const memory = new WebAssembly.Memory({ initial: 1 });
    const ids = new Uint32Array(memory.buffer, 0, 3);
    const simIds = new Uint32Array(memory.buffer, 32, 3);
    ids.set([3, 7, 9]);
    simIds.set([0, 1, 2]);
    let grew = false;

    const source: HouseholdRosterSource = {
      count: 3,
      ids: () => ids,
      simIds: () => simIds,
      simName: (entity) => {
        if (!grew) {
          memory.grow(1);
          grew = true;
        }
        return new Map([[3, 'Terri'], [7, 'Doug'], [9, 'Nadia']]).get(entity) ?? '';
      },
      selectedIndex: () => null,
      select: () => true,
    };

    expect(householdMembers(source)).toEqual([
      { simId: 0, entity: 3, name: 'Terri' },
      { simId: 1, entity: 7, name: 'Doug' },
      { simId: 2, entity: 9, name: 'Nadia' },
    ]);
    expect(ids.byteLength).toBe(0);
    expect(simIds.byteLength).toBe(0);
  });
});

describe('HouseholdRoster', () => {
  it('renders selected state from simulation truth and respects its cadence', () => {
    const source = new MutableSource();
    const surface = new RecordingSurface();
    const roster = new HouseholdRoster(source, surface, 100);

    expect(roster.update(0)).toBe(true);
    expect(surface.selectedSimId).toBe(0);
    source.selected = 10;
    expect(roster.update(50)).toBe(false);
    expect(surface.selectedSimId).toBe(0);
    expect(roster.update(100)).toBe(true);
    expect(surface.selectedSimId).toBe(2);
  });

  it('resolves a button through stable SimId after a loaded world replaces entity indices', () => {
    const source = new MutableSource();
    const surface = new RecordingSurface();
    const roster = new HouseholdRoster(source, surface, 100);
    roster.update(0);

    surface.select(0);
    expect(source.selections).toEqual([3]);

    source.idsValue = new Uint32Array([41, 42, 43]);
    source.kindsValue = new Uint32Array([0, 0, 0]);
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

    // No redraw between load and click. The old button still resolves the
    // current entity instead of sending stale index 3.
    surface.select(0);
    expect(source.selections).toEqual([3, 41]);
  });

  it('force-refreshes immediately after load and removes departed members', () => {
    const source = new MutableSource();
    const surface = new RecordingSurface();
    const roster = new HouseholdRoster(source, surface, 100);
    roster.update(0);

    source.idsValue = new Uint32Array([91]);
    source.kindsValue = new Uint32Array([0]);
    source.simIdsByEntity = new Map([[91, 0]]);
    source.names = new Map([[91, 'Terri']]);
    source.selected = 91;

    expect(roster.update(1, true)).toBe(true);
    expect(surface.members).toEqual([{ simId: 0, entity: 91, name: 'Terri' }]);
    expect(surface.selectedSimId).toBe(0);
  });

  it('reports a command-queue rejection instead of silently dropping a click', () => {
    const source = new MutableSource();
    source.acceptSelection = false;
    const surface = new RecordingSurface();
    let failures = 0;
    const roster = new HouseholdRoster(source, surface, 100, () => failures++);
    roster.update(0);

    surface.select(1);

    expect(source.selections).toEqual([2]);
    expect(failures).toBe(1);
  });

  it('reports a successfully staged selection exactly once', () => {
    const source = new MutableSource();
    const surface = new RecordingSurface();
    let failures = 0;
    let staged = 0;
    const roster = new HouseholdRoster(
      source,
      surface,
      100,
      () => failures++,
      () => staged++,
    );
    roster.update(0);

    surface.select(1);

    expect(source.selections).toEqual([2]);
    expect(failures).toBe(0);
    expect(staged).toBe(1);
  });
});

describe('createHouseholdRosterSurface', () => {
  it('reuses correctly ordered buttons without moving or blurring focus', () => {
    const doc = new FakeDocument();
    const root = new FakeRoot(doc);
    const surface = createHouseholdRosterSurface(
      doc as unknown as Document,
      root as unknown as HTMLElement,
    );
    const members: HouseholdMember[] = [
      { simId: 0, entity: 3, name: 'Terri' },
      { simId: 1, entity: 7, name: 'Doug' },
      { simId: 2, entity: 9, name: 'Nadia' },
    ];
    const selected: number[] = [];

    surface.render(members, 0, (simId) => selected.push(simId));
    const doug = root.items[1];
    doug.focus();
    root.insertions = 0;

    surface.render(members, 1, (simId) => selected.push(simId));

    expect(root.insertions).toBe(0);
    expect(root.items[1]).toBe(doug);
    expect(doc.activeElement).toBe(doug);
    expect(doug.getAttribute('aria-pressed')).toBe('true');
    doug.click();
    expect(selected).toEqual([1]);
  });

  it('removes departed buttons and resolves a reused button against the replaced world', () => {
    const doc = new FakeDocument();
    const root = new FakeRoot(doc);
    const source = new MutableSource();
    const roster = new HouseholdRoster(
      source,
      createHouseholdRosterSurface(
        doc as unknown as Document,
        root as unknown as HTMLElement,
      ),
      100,
    );
    roster.update(0);

    const doug = root.items[1];
    doug.focus();
    source.idsValue = new Uint32Array([42, 43]);
    source.kindsValue = new Uint32Array([0, 0]);
    source.simIdsByEntity = new Map([
      [42, 1],
      [43, 2],
    ]);
    source.names = new Map([
      [42, 'Doug'],
      [43, 'Nadia'],
    ]);
    source.selected = 43;

    roster.update(1, true);

    expect(root.items.map((button) => button.textContent)).toEqual([
      'Doug',
      'Nadia',
    ]);
    expect(root.items[0]).toBe(doug);
    expect(doc.activeElement).toBe(doug);
    expect(doug.getAttribute('aria-pressed')).toBe('false');
    expect(root.items[1].getAttribute('aria-pressed')).toBe('true');

    doug.click();
    expect(source.selections).toEqual([42]);
  });
});
