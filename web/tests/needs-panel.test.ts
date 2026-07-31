import { describe, it, expect } from 'vitest';
import {
  NeedsPanel,
  levelPercent,
  type BarFill,
  type NeedsSource,
  type PanelRoot,
} from '../src/ui/needs-panel.js';

// What this file guards is [D-5]: the panel renders simulation state and
// owns none of it, and the only state it may hold is a throttle timestamp.
// Two things follow, and both are tested here rather than asserted in a
// comment - that every read goes back to the source, and that the throttle
// is a rate rather than a latch.

/** A bar whose width is readable, standing in for an `HTMLElement`. */
function bar(): BarFill {
  return { style: { width: '' } };
}

function bars(n: number): BarFill[] {
  return Array.from({ length: n }, bar);
}

function widths(fills: readonly BarFill[]): string[] {
  return fills.map((fill) => fill.style.width);
}

/**
 * A source that counts its reads and can change its answer between them.
 *
 * Counting is what makes the throttle observable at all: the panel's
 * whole job on a skipped frame is to touch nothing, and "touched nothing"
 * is only visible from the source's side.
 */
class CountingSource implements NeedsSource {
  selectionReads = 0;
  needsReads = 0;
  nameReads = 0;
  lastIndexAsked: number | null = null;

  constructor(
    public selected: number | null,
    public levels: Float32Array,
    public name = 'Terri',
  ) {}

  selectedIndex(): number | null {
    this.selectionReads++;
    return this.selected;
  }

  needsOf(entityIndex: number): Float32Array {
    this.needsReads++;
    this.lastIndexAsked = entityIndex;
    return this.levels;
  }

  simName(_entityIndex: number): string {
    this.nameReads++;
    return this.name;
  }
}

/** A caption whose text is readable, standing in for an element. */
function caption(): { textContent: string | null } {
  return { textContent: null };
}

const SEVEN = new Float32Array([100, 90, 80, 70, 60, 50, 40]);

describe('levelPercent', () => {
  it('scales a level against the simulation ceiling rather than assuming 100', () => {
    // The denominator comes across the boundary from `need_max`, so this
    // has to be a real division and not a pass-through that happens to be
    // right while the ceiling is 100. A ceiling of 200 is what tells them
    // apart: a pass-through reports 50 for a level of 50, the division
    // reports 25.
    expect(levelPercent(50, 100)).toBe(50);
    expect(levelPercent(50, 200)).toBe(25);
    expect(levelPercent(50, 50)).toBe(100);
  });

  it('clamps out of range levels instead of producing a width CSS cannot use', () => {
    expect(levelPercent(-10, 100)).toBe(0);
    expect(levelPercent(140, 100)).toBe(100);
    // NaN maps to empty rather than through. `NaN%` is not a width, so
    // the browser would keep whatever the bar last showed - a bar frozen
    // at a stale value, which is indistinguishable from a need that has
    // stopped changing, and mid-interaction that is a real thing.
    expect(levelPercent(NaN, 100)).toBe(0);
    expect(levelPercent(50, 0)).toBe(0);
  });

  it('rounds to a tenth so an unchanged bar writes an unchanged string', () => {
    expect(levelPercent(1 / 3, 1)).toBe(33.3);
  });
});

describe('NeedsPanel', () => {
  it('reads at the throttled rate rather than every frame or once', () => {
    // Two degenerate alternatives, and the samples below are chosen to
    // exclude both (docs/testing-protocol.md rule 7). A panel that reads
    // EVERY frame and one that reads ONCE and never again would each be
    // green against a single "did it read" assertion. The full read
    // pattern over twenty frames disagrees with both.
    const fills = bars(7);
    const panel = new NeedsPanel({ hidden: false }, caption(), fills, 100, 100);
    const source = new CountingSource(3, SEVEN);

    const readAt: number[] = [];
    const FRAME_MS = 16;
    for (let frame = 0; frame < 20; frame++) {
      const nowMs = frame * FRAME_MS;
      if (panel.update(nowMs, source)) readAt.push(nowMs);
    }

    // The first frame always reads - there is nothing on screen yet - and
    // afterwards a read happens on the first frame at or past 100 ms
    // since the last one. At 16 ms frames that is frames 0, 7, 14 and
    // nothing else in twenty.
    expect(readAt).toEqual([0, 112, 224]);
    expect(source.needsReads).toBe(3);
    // Stated as inequalities too, because the exact list above is what
    // fails if the frame interval is ever retuned, and these two are the
    // properties that must hold regardless.
    expect(source.needsReads).toBeLessThan(20);
    expect(source.needsReads).toBeGreaterThan(1);
  });

  it('touches neither the source nor the bars on a throttled frame', () => {
    // The throttle's real claim. A panel that read the simulation and
    // then decided not to redraw would produce the same picture and the
    // same test result on every assertion about widths, while making
    // every boundary call the throttle exists to avoid.
    const fills = bars(7);
    const panel = new NeedsPanel({ hidden: false }, caption(), fills, 100, 100);
    const source = new CountingSource(3, SEVEN);

    expect(panel.update(0, source)).toBe(true);
    const afterFirst = widths(fills);

    // The source's answer changes underneath, so a panel that read again
    // would visibly disagree with the frame before it.
    source.levels = new Float32Array([0, 0, 0, 0, 0, 0, 0]);
    expect(panel.update(50, source)).toBe(false);

    expect(source.selectionReads).toBe(1);
    expect(source.needsReads).toBe(1);
    expect(widths(fills)).toEqual(afterFirst);
  });

  it('re-reads the selection every time rather than remembering it', () => {
    // [D-5] in one assertion. Selection is simulation state, so a panel
    // holding its own copy would keep drawing the sim the player stopped
    // watching - and would be a second source of truth the simulation
    // cannot see, which is what stops a session being replayable.
    const fills = bars(7);
    const panel = new NeedsPanel({ hidden: false }, caption(), fills, 0, 100);
    const source = new CountingSource(3, SEVEN);

    panel.update(0, source);
    expect(source.lastIndexAsked).toBe(3);

    source.selected = 9;
    panel.update(1, source);
    expect(source.lastIndexAsked).toBe(9);
    expect(source.selectionReads).toBe(2);
  });

  it('hides itself for a selection with no needs to show', () => {
    // Nothing selected, a sim that despawned between the click and this
    // frame, and a click that landed on a fridge all arrive as an empty
    // array. All three draw no bars, and all three are asserted, because
    // the null branch and the empty-array branch are different code.
    const fills = bars(7);
    const root: PanelRoot = { hidden: false };
    const panel = new NeedsPanel(root, caption(), fills, 0, 100);

    const nothingSelected = new CountingSource(null, SEVEN);
    panel.update(0, nothingSelected);
    expect(root.hidden).toBe(true);
    // And it did not ask for the needs of a sim that is not there.
    expect(nothingSelected.needsReads).toBe(0);

    const anObject = new CountingSource(4, new Float32Array(0));
    panel.update(1, anObject);
    expect(root.hidden).toBe(true);
    expect(anObject.needsReads).toBe(1);

    // Then back, because a panel that hides and never returns is the
    // failure this test would otherwise be blind to.
    panel.update(2, new CountingSource(4, SEVEN));
    expect(root.hidden).toBe(false);
  });

  it('draws one bar per need in the order the simulation reports them', () => {
    // The levels are pairwise distinct, so a panel writing one level into
    // every bar, or reversing them, is visible. A fixture where the seven
    // agreed could not tell those apart ([L34]).
    const fills = bars(7);
    const panel = new NeedsPanel({ hidden: false }, caption(), fills, 0, 100);
    panel.update(0, new CountingSource(1, SEVEN));

    expect(widths(fills)).toEqual([
      '100%',
      '90%',
      '80%',
      '70%',
      '60%',
      '50%',
      '40%',
    ]);
  });

  it('empties a bar the simulation reported no level for', () => {
    // A short read must not leave the trailing bars showing the previous
    // frame's numbers. A stale bar is worse than an empty one: it is
    // indistinguishable from a need that stopped changing.
    const fills = bars(7);
    const panel = new NeedsPanel({ hidden: false }, caption(), fills, 0, 100);
    panel.update(0, new CountingSource(1, SEVEN));
    expect(widths(fills)[6]).toBe('40%');

    panel.update(1, new CountingSource(1, new Float32Array([10, 20, 30])));
    expect(widths(fills)).toEqual(['10%', '20%', '30%', '0%', '0%', '0%', '0%']);
  });

  it('captions the bars with the selected sims name, re-read like everything else', () => {
    // Whose bars these are stopped being obvious when the household grew
    // past one sim. Re-read rather than cached on selection change, so a
    // rename reaches the caption without the panel being told - the same
    // [D-5] rule as the selection itself, and the same failure if broken:
    // a caption frozen on the sim the player stopped watching.
    const title = caption();
    const panel = new NeedsPanel({ hidden: false }, title, bars(7), 0, 100);
    const source = new CountingSource(3, SEVEN, 'Terri');

    panel.update(0, source);
    expect(title.textContent).toBe('Terri');

    // The name changes underneath - a different sim selected, or the same
    // one renamed; the panel cannot tell and must not need to.
    source.name = 'Doug';
    panel.update(1, source);
    expect(title.textContent).toBe('Doug');
  });

  it('captions a nameless sim as empty rather than keeping the previous name', () => {
    // A stress filler agent has needs and no name. The stale caption is
    // the bug: bars switching to the filler while the caption still says
    // Terri is a panel lying about whose crisis is on screen.
    const title = caption();
    const panel = new NeedsPanel({ hidden: false }, title, bars(7), 0, 100);
    panel.update(0, new CountingSource(3, SEVEN, 'Terri'));
    expect(title.textContent).toBe('Terri');

    panel.update(1, new CountingSource(8, SEVEN, ''));
    expect(title.textContent).toBe('');
  });
});
