import { describe, expect, it } from 'vitest';

import {
  MoodPanel,
  createMoodPanelSurface,
  moodPanelState,
  type MoodPanelSource,
  type MoodPanelState,
  type MoodPanelView,
} from '../src/ui/mood-panel.js';

class MutableMoodSource implements MoodPanelSource {
  selected: number | null = 0;
  snapshot: Float32Array = new Float32Array([0]);
  summary = ['Neutral'];
  selectedReads = 0;
  snapshotReads = 0;
  summaryReads = 0;

  selectedIndex(): number | null {
    this.selectedReads += 1;
    return this.selected;
  }

  moodSnapshotOf(): Float32Array {
    this.snapshotReads += 1;
    return this.snapshot;
  }

  moodSummaryOf(): string[] {
    this.summaryReads += 1;
    return this.summary;
  }
}

class FakeElement {
  className = '';
  dataset: Record<string, string> = {};
  hidden = false;
  parentElement: FakeElement | null = null;
  readonly nodes: FakeElement[] = [];
  readonly style: Record<string, string> = {};
  private readonly attributes = new Map<string, string>();
  private value = '';

  get textContent(): string {
    if (this.nodes.length > 0) {
      return this.nodes.map((node) => node.textContent).join('');
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
      this.detach(child);
      child.parentElement = this;
      this.nodes.push(child);
    }
  }

  appendChild(child: FakeElement): FakeElement {
    this.append(child);
    return child;
  }

  insertBefore(child: FakeElement, before: FakeElement | null): FakeElement {
    this.detach(child);
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
    this.parentElement?.detach(this);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  find(className: string): FakeElement | null {
    if (this.className === className) {
      return this;
    }
    for (const child of this.nodes) {
      const found = child.find(className);
      if (found !== null) {
        return found;
      }
    }
    return null;
  }

  detach(child: FakeElement): void {
    const currentParent = child.parentElement;
    if (currentParent === null) {
      return;
    }
    const index = currentParent.nodes.indexOf(child);
    if (index >= 0) {
      currentParent.nodes.splice(index, 1);
    }
    child.parentElement = null;
  }
}

class FakeDocument {
  createElement(): FakeElement {
    return new FakeElement();
  }
}

function asDocument(doc: FakeDocument): Document {
  return doc as unknown as Document;
}

function asElement(element: FakeElement): HTMLElement {
  return element as unknown as HTMLElement;
}

function view(
  overallLabel: string,
  overallScore: number,
  moodlets: Array<{ key: string; label: string; score: number }>,
): MoodPanelView {
  const describe = (label: string, score: number) => {
    const tone: 'negative' | 'neutral' | 'positive' =
      score < 0 ? 'negative' : score > 0 ? 'positive' : 'neutral';
    return {
      label,
      score,
      percent: Math.round(((Math.min(100, Math.max(-100, score)) + 100) / 2) * 10) / 10,
      tone,
    };
  };

  return {
    overall: describe(overallLabel, overallScore),
    moodlets: moodlets.map((moodlet) => ({
      key: moodlet.key,
      ...describe(moodlet.label, moodlet.score),
    })),
  };
}

function ready(
  overallLabel: string,
  overallScore: number,
  moodlets: Array<{ key: string; label: string; score: number }>,
): MoodPanelState {
  return { kind: 'ready', view: view(overallLabel, overallScore, moodlets) };
}

function createFixture() {
  const doc = new FakeDocument();
  const empty = new FakeElement();
  const content = new FakeElement();
  const overallLabel = new FakeElement();
  const overallMeter = new FakeElement();
  const marker = new FakeElement();
  const list = new FakeElement();
  const surface = createMoodPanelSurface(
    asDocument(doc),
    asElement(empty),
    asElement(content),
    asElement(overallLabel),
    asElement(overallMeter),
    asElement(marker),
    asElement(list),
  );
  return { surface, empty, content, overallLabel, overallMeter, marker, list };
}

describe('moodPanelState', () => {
  it('builds an overall bipolar mood and signed moodlet tones', () => {
    const source = new MutableMoodSource();
    source.selected = 3;
    source.snapshot = new Float32Array([35, 25, -15, 0]);
    source.summary = ['Content', 'Good meal', 'Awkward chat', 'Quiet moment'];

    const result = moodPanelState(source);

    expect(result).toEqual({
      kind: 'ready',
      view: {
        overall: { label: 'Content', score: 35, percent: 67.5, tone: 'positive' },
        moodlets: [
          {
            key: 'Good meal\u00000',
            label: 'Good meal',
            score: 25,
            percent: 62.5,
            tone: 'positive',
          },
          {
            key: 'Awkward chat\u00000',
            label: 'Awkward chat',
            score: -15,
            percent: 42.5,
            tone: 'negative',
          },
          {
            key: 'Quiet moment\u00000',
            label: 'Quiet moment',
            score: 0,
            percent: 50,
            tone: 'neutral',
          },
        ],
      },
    });
    expect(source.snapshotReads).toBe(1);
    expect(source.summaryReads).toBe(1);
  });

  it('returns unselected without downstream reads when no person is selected', () => {
    const source = new MutableMoodSource();
    source.selected = null;

    expect(moodPanelState(source)).toEqual({ kind: 'unselected' });
    expect(source.snapshotReads).toBe(0);
    expect(source.summaryReads).toBe(0);
  });

  it('accepts an overall-only payload as a valid zero-moodlet view', () => {
    const source = new MutableMoodSource();
    source.snapshot = new Float32Array([-20]);
    source.summary = ['Uneasy'];

    expect(moodPanelState(source)).toEqual({
      kind: 'ready',
      view: {
        overall: { label: 'Uneasy', score: -20, percent: 40, tone: 'negative' },
        moodlets: [],
      },
    });
  });

  it('short-circuits before the text boundary when the numeric projection is empty', () => {
    const source = new MutableMoodSource();
    source.snapshot = new Float32Array();

    expect(moodPanelState(source)).toEqual({ kind: 'unavailable' });
    expect(source.snapshotReads).toBe(1);
    expect(source.summaryReads).toBe(0);
  });

  it('rejects misaligned, blank, and non-finite payloads', () => {
    const cases: Array<{ snapshot: Float32Array; summary: string[] }> = [
      { snapshot: new Float32Array([0, 5]), summary: ['Neutral'] },
      { snapshot: new Float32Array([0]), summary: ['   '] },
      { snapshot: new Float32Array([0, 5]), summary: ['Neutral', '  '] },
      { snapshot: new Float32Array([Number.NaN]), summary: ['Neutral'] },
      { snapshot: new Float32Array([0, Number.POSITIVE_INFINITY]), summary: ['Neutral', 'Hopeful'] },
    ];

    for (const current of cases) {
      const source = new MutableMoodSource();
      source.snapshot = current.snapshot;
      source.summary = current.summary;
      expect(moodPanelState(source)).toEqual({ kind: 'unavailable' });
    }
  });

  it('clamps only finite scores and creates distinct duplicate-label keys', () => {
    const source = new MutableMoodSource();
    source.snapshot = new Float32Array([150, -125, 40]);
    source.summary = ['Elated', 'Recent event', 'Recent event'];

    const result = moodPanelState(source);

    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') throw new Error('finite aligned mood must be ready');
    expect(result.view.overall).toEqual({
      label: 'Elated',
      score: 100,
      percent: 100,
      tone: 'positive',
    });
    expect(
      result.view.moodlets.map((moodlet) => [moodlet.key, moodlet.score, moodlet.percent]),
    ).toEqual([
      ['Recent event\u00000', -100, 0],
      ['Recent event\u00001', 40, 70],
    ]);
  });

  it('copies the numeric snapshot before the summary bridge call', () => {
    const snapshot = new Float32Array([10, 20]);
    const source: MoodPanelSource = {
      selectedIndex: () => 2,
      moodSnapshotOf: () => snapshot,
      moodSummaryOf: () => {
        snapshot.fill(Number.NaN);
        return ['Steady', 'Warm meal'];
      },
    };

    expect(moodPanelState(source)).toMatchObject({
      kind: 'ready',
      view: {
        overall: { score: 10 },
        moodlets: [{ score: 20 }],
      },
    });
  });
});

describe('MoodPanel', () => {
  it('throttles source reads and refreshes again at the interval', () => {
    const source = new MutableMoodSource();
    const renders: MoodPanelState[] = [];
    const panel = new MoodPanel(source, { render: (result) => renders.push(result) }, 100);

    expect(panel.update(0)).toBe(true);
    expect(panel.update(50)).toBe(false);
    expect(panel.update(99)).toBe(false);
    expect(panel.update(100)).toBe(true);

    expect(renders).toHaveLength(2);
    expect(source.selectedReads).toBe(2);
    expect(source.snapshotReads).toBe(2);
    expect(source.summaryReads).toBe(2);
  });

  it('observes selection changes on refresh and force-refreshes post-load state', () => {
    const source = new MutableMoodSource();
    const renders: MoodPanelState[] = [];
    const panel = new MoodPanel(source, { render: (result) => renders.push(result) }, 100);

    panel.update(0);
    source.selected = null;
    expect(panel.update(10, true)).toBe(true);
    source.selected = 4;
    source.snapshot = new Float32Array([45]);
    source.summary = ['Restored'];
    expect(panel.update(11, true)).toBe(true);

    expect(renders[1]).toEqual({ kind: 'unselected' });
    expect(renders[2]).toMatchObject({
      kind: 'ready',
      view: { overall: { label: 'Restored' } },
    });
    expect(source.selectedReads).toBe(3);
  });

  it('rejects invalid refresh intervals', () => {
    const source = new MutableMoodSource();
    const surface = { render: () => undefined };

    expect(() => new MoodPanel(source, surface, 0)).toThrow(/positive finite/);
    expect(() => new MoodPanel(source, surface, Number.NaN)).toThrow(/positive finite/);
  });
});

describe('createMoodPanelSurface', () => {
  it('renders the overall accessible meter and moodlet tone rows', () => {
    const fixture = createFixture();

    fixture.surface.render(
      ready('Content', 35, [
        { key: 'meal', label: 'Good meal', score: 25 },
        { key: 'chat', label: 'Awkward chat', score: -15 },
        { key: 'quiet', label: 'Quiet moment', score: 0 },
      ]),
    );

    expect(fixture.empty.hidden).toBe(true);
    expect(fixture.content.hidden).toBe(false);
    expect(fixture.overallLabel.textContent).toBe('Content');
    expect(fixture.overallMeter.getAttribute('role')).toBe('meter');
    expect(fixture.overallMeter.getAttribute('aria-valuemin')).toBe('-100');
    expect(fixture.overallMeter.getAttribute('aria-valuemax')).toBe('100');
    expect(fixture.overallMeter.getAttribute('aria-valuenow')).toBe('35');
    expect(fixture.overallMeter.getAttribute('aria-valuetext')).toBe('Content');
    expect(fixture.overallMeter.dataset.tone).toBe('positive');
    expect(fixture.marker.style.left).toBe('67.5%');
    expect(fixture.list.nodes.map((row) => row.dataset.tone)).toEqual([
      'positive',
      'negative',
      'neutral',
    ]);
    expect(fixture.list.nodes.map((row) => row.find('moodlet-score')?.textContent)).toEqual([
      '+25',
      '-15',
      '0',
    ]);
  });

  it('reuses keyed rows while reordering and removes stale rows', () => {
    const fixture = createFixture();
    fixture.surface.render(
      ready('Content', 10, [
        { key: 'meal', label: 'Good meal', score: 20 },
        { key: 'chat', label: 'Awkward chat', score: -20 },
      ]),
    );
    const mealRow = fixture.list.nodes[0];
    const chatRow = fixture.list.nodes[1];

    fixture.surface.render(
      ready('Uneasy', -5, [
        { key: 'chat', label: 'Awkward chat', score: -30 },
        { key: 'quiet', label: 'Quiet moment', score: 0 },
      ]),
    );

    expect(fixture.list.nodes[0]).toBe(chatRow);
    expect(fixture.list.nodes[0].find('moodlet-score')?.textContent).toBe('-30');
    expect(fixture.list.nodes[1]).not.toBe(mealRow);
    expect(mealRow.parentElement).toBeNull();
    expect(fixture.list.nodes).toHaveLength(2);
  });

  it('shows a functional empty-moodlet message for a valid overall-only view', () => {
    const fixture = createFixture();

    fixture.surface.render(ready('Calm', 0, []));

    expect(fixture.content.hidden).toBe(false);
    expect(fixture.overallLabel.textContent).toBe('Calm');
    expect(fixture.list.hidden).toBe(false);
    expect(fixture.list.nodes).toHaveLength(1);
    expect(fixture.list.nodes[0].className).toBe('moodlet-empty');
    expect(fixture.list.nodes[0].textContent).toBe('No active moodlets.');
  });

  it('clears stale rows and resets the meter when data becomes unavailable', () => {
    const fixture = createFixture();
    fixture.surface.render(
      ready('Content', 35, [{ key: 'meal', label: 'Good meal', score: 25 }]),
    );
    const oldRow = fixture.list.nodes[0];

    fixture.surface.render({ kind: 'unavailable' });

    expect(fixture.empty.hidden).toBe(false);
    expect(fixture.empty.textContent).toBe('Mood unavailable');
    expect(fixture.content.hidden).toBe(true);
    expect(fixture.overallLabel.textContent).toBe('');
    expect(fixture.overallMeter.getAttribute('aria-valuenow')).toBe('0');
    expect(fixture.overallMeter.getAttribute('aria-valuetext')).toBe('Mood unavailable');
    expect(fixture.marker.style.left).toBe('50%');
    expect(fixture.list.hidden).toBe(true);
    expect(fixture.list.nodes).toHaveLength(0);
    expect(oldRow.parentElement).toBeNull();

    fixture.surface.render(
      ready('Restored', 5, [{ key: 'visit', label: 'Friendly visit', score: 15 }]),
    );
    expect(fixture.list.nodes).toHaveLength(1);
    expect(fixture.list.textContent).not.toContain('Good meal');
  });

  it('keeps the selection prompt distinct from unavailable boundary data', () => {
    const fixture = createFixture();

    fixture.surface.render({ kind: 'unselected' });
    expect(fixture.empty.textContent).toBe('Select a person to see their mood.');

    fixture.surface.render({ kind: 'unavailable' });
    expect(fixture.empty.textContent).toBe('Mood unavailable');
  });
});
