import { describe, expect, it, vi } from 'vitest';
import {
  clientToTile,
  dispatch,
  handleLeftClick,
  handleRightClick,
  pickAt,
  resolveLeftClick,
  type ClickAction,
  type CommandSink,
  type Pick,
  type PickSource,
} from '../src/input.js';
import { KIND_AGENT } from '../src/render/instances.js';
import { screenX, screenY } from '../src/render/iso.js';

const KIND_OBJECT = 1;

/** A canvas rect at 1:1 CSS scale, anchored at the page origin. */
const UNSCALED = { left: 0, top: 0, width: 1280, height: 720 };

/**
 * A `PickSource` over literal rows. `entities` is `[entityIndex, kind, x, y]`
 * per row, in the order the render buffer would hold them.
 *
 * The entity index is given per row rather than derived, because the whole
 * point of the `ids` column is that a row is not its entity index.
 */
function source(
  entities: readonly [number, number, number, number][],
): PickSource {
  return {
    count: entities.length,
    positions: () => new Float32Array(entities.flatMap(([, , x, y]) => [x, y])),
    kinds: () => new Uint32Array(entities.map(([, kind]) => kind)),
    ids: () => new Uint32Array(entities.map(([id]) => id)),
  };
}

function recordingSink(selected: number | null = null): CommandSink & {
  readonly calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    select: (index) => (calls.push(`select ${index}`), true),
    useObject: (agent, object) => (calls.push(`use ${agent} ${object}`), true),
    cancelIntents: (agent) => (calls.push(`cancel ${agent}`), true),
    selectedIndex: () => selected,
  };
}

describe('clientToTile', () => {
  /**
   * Round-trip against the projection itself, at every tile of a small
   * grid: project a tile to screen, feed that pixel back, get the tile.
   *
   * This is the assertion that pins `Math.round` against `Math.floor`.
   * Flooring is off by half a tile in both axes, so it fails here on
   * roughly every tile rather than on a hand-picked edge case - which is
   * the point, because a single-tile test with an unlucky origin can pass
   * under both.
   */
  it('inverts the projection for every tile in the lot', () => {
    const originX = 544;
    const originY = 40;
    for (let ty = 0; ty < 8; ty++) {
      for (let tx = 0; tx < 8; tx++) {
        const tile = clientToTile(
          screenX(tx, ty, originX),
          screenY(tx, ty, originY),
          UNSCALED,
          1280,
          720,
          originX,
          originY,
        );
        expect(tile, `tile ${tx},${ty}`).toEqual([tx, ty]);
      }
    }
  });

  /**
   * The point half a tile down-screen from a tile centre - the diamond's
   * SOUTH CORNER - must not resolve to that tile.
   *
   * This is the specific pixel `Math.floor` gets right and `Math.round`
   * gets right too, but for different tiles, and it is where the two
   * disagree most cleanly: the south corner is the shared vertex of four
   * diamonds, so it belongs to a neighbour rather than to the tile whose
   * sprite is anchored there. Stated as "not the origin tile" rather than
   * as one exact answer because a shared vertex has no single right owner.
   */
  it('does not award a diamond corner to the tile it is anchored on', () => {
    const tile = clientToTile(
      screenX(4, 4, 0),
      screenY(4, 4, 0) + 16,
      UNSCALED,
      1280,
      720,
      0,
      0,
    );
    expect(tile).not.toEqual([4, 4]);
  });

  /**
   * CSS scaling. A canvas laid out at half its drawing-buffer size means
   * every client pixel is two buffer pixels, and ignoring the ratio would
   * halve every coordinate - which lands on a real tile, just the wrong
   * one, near the top-left of the lot.
   */
  it('scales client pixels by the ratio between the rect and the drawing buffer', () => {
    const originX = 100;
    const originY = 50;
    const bufferX = screenX(5, 3, originX);
    const bufferY = screenY(5, 3, originY);
    const halved = { left: 0, top: 0, width: 640, height: 360 };

    expect(
      clientToTile(bufferX / 2, bufferY / 2, halved, 1280, 720, originX, originY),
    ).toEqual([5, 3]);
  });

  /**
   * An offset rect: the canvas is not always at the page origin.
   *
   * **The offset has to be big enough to change the answer, and the first
   * version of this test was not.** `screenToWorld` halves both terms, so an
   * x offset of 30 px moves `wx` by only 30/32/2 = 0.47 tiles - inside the
   * rounding window, so the tile came out right whether or not the offset
   * was subtracted. The test asserted exactly the right thing against an
   * input domain that could not express the bug, which is [L34] committed in
   * a test written to prevent it; a manual sweep replacing
   * `clientX - rect.left` with `clientX` found it surviving.
   *
   * 200 x 100 is several tiles in both axes, and the precondition below is
   * what keeps that true: it asserts that ignoring the offset lands on a
   * DIFFERENT tile, so if anyone shrinks these numbers the test says so
   * instead of going quietly green.
   */
  it('subtracts the rect offset before inverting', () => {
    const LEFT = 200;
    const TOP = 100;
    const offset = { left: LEFT, top: TOP, width: 1280, height: 720 };
    const clientX = screenX(2, 6, 0) + LEFT;
    const clientY = screenY(2, 6, 0) + TOP;

    expect(
      clientToTile(clientX, clientY, offset, 1280, 720, 0, 0),
    ).toEqual([2, 6]);

    // The precondition. An offset small enough to round away makes the
    // assertion above pass for the wrong reason.
    const unoffset = { left: 0, top: 0, width: 1280, height: 720 };
    expect(
      clientToTile(clientX, clientY, unoffset, 1280, 720, 0, 0),
      'the offset must be large enough that ignoring it changes the tile',
    ).not.toEqual([2, 6]);
  });

  /**
   * A zero-sized rect returns null rather than dividing by it. Without the
   * guard the quotient is Infinity, `Math.round(Infinity)` is Infinity, no
   * row's position equals it, and the click reads as bare floor - so a
   * hidden canvas would silently clear the selection instead of doing
   * nothing.
   */
  it('returns null for a canvas with no area', () => {
    const collapsed = { left: 0, top: 0, width: 0, height: 0 };
    expect(clientToTile(10, 10, collapsed, 1280, 720, 0, 0)).toBeNull();
  });
});

describe('pickAt', () => {
  it('finds nothing on bare floor', () => {
    const rows = source([[0, KIND_OBJECT, 3, 3]]);
    expect(pickAt(rows, 7, 7)).toBeNull();
  });

  it('finds an object on its tile', () => {
    const rows = source([[9, KIND_OBJECT, 3, 4]]);
    expect(pickAt(rows, 3, 4)).toEqual({ entity: 9, isAgent: false });
  });

  /**
   * The whole reason the `ids` column exists.
   *
   * Row 1 holds entity 7, so returning the row number would give 1 - which
   * is a live entity, just the wrong one. The two rows deliberately hold
   * non-consecutive indices, because with entities 0 and 1 in rows 0 and 1
   * this test would pass with `row` returned in place of `ids[row]`
   * ([L34]).
   */
  it('returns the entity index in the row, not the row number', () => {
    const rows = source([
      [4, KIND_OBJECT, 1, 1],
      [7, KIND_OBJECT, 2, 2],
    ]);
    expect(pickAt(rows, 2, 2)?.entity).toBe(7);
    expect(pickAt(rows, 1, 1)?.entity).toBe(4);
  });

  /**
   * A sim standing on an object. It is drawn in front of the object - that
   * is what `LAYER_SIM` is for, and [V12] recorded what happens without it
   * - so it is what a click on that tile must resolve to.
   *
   * Asserted in BOTH row orders. The sim-first case passes even on an
   * implementation that simply returns the first match, so on its own it
   * proves nothing about the preference; the object-first case is the one
   * that requires the scan to keep looking.
   */
  it('prefers a sim to the object it is standing on, whichever row comes first', () => {
    const objectFirst = source([
      [3, KIND_OBJECT, 5, 5],
      [8, KIND_AGENT, 5, 5],
    ]);
    expect(pickAt(objectFirst, 5, 5)).toEqual({ entity: 8, isAgent: true });

    const simFirst = source([
      [8, KIND_AGENT, 5, 5],
      [3, KIND_OBJECT, 5, 5],
    ]);
    expect(pickAt(simFirst, 5, 5)).toEqual({ entity: 8, isAgent: true });
  });

  /**
   * Two sims on one tile resolve to the earlier row, because that is the
   * one that keeps the pixel: they share a layer and therefore a depth,
   * and `depthCompare: 'less'` rejects the second draw at an equal depth.
   */
  it('picks the earlier row when two sims share a tile', () => {
    const rows = source([
      [11, KIND_AGENT, 2, 2],
      [12, KIND_AGENT, 2, 2],
    ]);
    expect(pickAt(rows, 2, 2)?.entity).toBe(11);
  });

  /**
   * The same rule for two OBJECTS, and it needs saying separately.
   *
   * The agent case above returns on its first match, so it cannot see the
   * object branch at all - a sweep replacing that branch's `??=` with a
   * plain `=`, which makes the LAST object on a tile win, survived every
   * other test in this file. Two objects on a tile is not something the
   * shipped lot contains, but nothing validates against it either, and
   * "whichever the loop saw last" is not a rule anybody chose.
   */
  it('picks the earlier row when two objects share a tile', () => {
    const rows = source([
      [21, KIND_OBJECT, 4, 4],
      [22, KIND_OBJECT, 4, 4],
    ]);
    expect(pickAt(rows, 4, 4)?.entity).toBe(21);
  });

  /**
   * A walking sim sits between tiles. Its position rounds to the nearer
   * one, which is the tile its sprite is drawn nearest to.
   */
  it('rounds a sim mid-stride to the tile it is nearest', () => {
    const rows = source([[5, KIND_AGENT, 3.4, 6.6]]);
    expect(pickAt(rows, 3, 7)?.entity).toBe(5);
    expect(pickAt(rows, 3, 6)).toBeNull();
  });

  /**
   * Rows past `count` are not read. The bridge hands out views sized to
   * `count`, but the scratch-buffer pattern elsewhere in the renderer means
   * a stale longer array is a realistic mistake, and reading past the live
   * rows would resolve clicks to despawned entities.
   */
  it('ignores rows beyond the live count', () => {
    const rows = source([
      [1, KIND_OBJECT, 1, 1],
      [2, KIND_OBJECT, 9, 9],
    ]);
    const truncated: PickSource = { ...rows, count: 1 };
    expect(pickAt(truncated, 9, 9)).toBeNull();
    expect(pickAt(truncated, 1, 1)?.entity).toBe(1);
  });
});

describe('resolveLeftClick', () => {
  const sim: Pick = { entity: 4, isAgent: true };
  const object: Pick = { entity: 9, isAgent: false };

  it('selects a clicked sim', () => {
    expect(resolveLeftClick(sim, null)).toEqual({ kind: 'select', entity: 4 });
  });

  it('selects a clicked sim even when another is already selected', () => {
    expect(resolveLeftClick(sim, 2)).toEqual({ kind: 'select', entity: 4 });
  });

  it('directs the selected sim at a clicked object', () => {
    expect(resolveLeftClick(object, 4)).toEqual({
      kind: 'use',
      agent: 4,
      object: 9,
    });
  });

  /**
   * Entity 0 is a legitimate selection and `0` is falsy. A `if (!selected)`
   * check would refuse to direct the first sim in the world, which is the
   * only sim the game currently has.
   */
  it('directs sim zero, which a falsy check would refuse', () => {
    expect(resolveLeftClick(object, 0)).toEqual({
      kind: 'use',
      agent: 0,
      object: 9,
    });
  });

  it('does nothing when an object is clicked with nothing selected', () => {
    expect(resolveLeftClick(object, null)).toEqual({ kind: 'none' });
  });

  it('clears the selection on bare floor', () => {
    expect(resolveLeftClick(null, 4)).toEqual({ kind: 'select', entity: null });
  });

  /**
   * Directing must not change the selection, or the second click of a
   * queued pair would have nothing to queue against.
   */
  it('leaves the selection alone when directing', () => {
    const action = resolveLeftClick(object, 4);
    expect(action.kind).toBe('use');
  });
});

describe('dispatch', () => {
  it('sends a select', () => {
    const sink = recordingSink();
    dispatch(sink, { kind: 'select', entity: 3 });
    expect(sink.calls).toEqual(['select 3']);
  });

  it('sends a clear as select null, not as a dropped call', () => {
    const sink = recordingSink();
    dispatch(sink, { kind: 'select', entity: null });
    expect(sink.calls).toEqual(['select null']);
  });

  it('sends a use', () => {
    const sink = recordingSink();
    dispatch(sink, { kind: 'use', agent: 1, object: 6 });
    expect(sink.calls).toEqual(['use 1 6']);
  });

  it('sends nothing at all for none', () => {
    const sink = recordingSink();
    dispatch(sink, { kind: 'none' } satisfies ClickAction);
    expect(sink.calls).toEqual([]);
  });
});

/**
 * The end-to-end path a click takes, minus the DOM: a tile in, commands
 * out. `attachPointerInput` itself is the untested wiring, exactly as
 * `buildTimeControls` is - there is no jsdom here and the project's
 * convention is structural fakes rather than a browser environment.
 */
describe('handleLeftClick', () => {
  function target(selected: number | null, rows: PickSource) {
    return { ...recordingSink(selected), ...rows };
  }

  it('selects the sim on the clicked tile', () => {
    const sink = target(null, source([[6, KIND_AGENT, 4, 2]]));
    handleLeftClick(sink, [4, 2]);
    expect(sink.calls).toEqual(['select 6']);
  });

  it('directs the selected sim at the object on the clicked tile', () => {
    const sink = target(6, source([[9, KIND_OBJECT, 7, 3]]));
    handleLeftClick(sink, [7, 3]);
    expect(sink.calls).toEqual(['use 6 9']);
  });

  it('clears the selection when the tile is bare floor', () => {
    const sink = target(6, source([[9, KIND_OBJECT, 7, 3]]));
    handleLeftClick(sink, [1, 1]);
    expect(sink.calls).toEqual(['select null']);
  });

  /**
   * A tile the projection could not place does nothing - it must not fall
   * through to the bare-floor case, or a click on a collapsed canvas would
   * deselect the sim the player is watching.
   */
  it('does nothing at all for an unplaceable click', () => {
    const sink = target(6, source([[9, KIND_OBJECT, 7, 3]]));
    handleLeftClick(sink, null);
    expect(sink.calls).toEqual([]);
  });

  /**
   * The selection is read BEFORE the dispatch, which is the ordering this
   * function exists to pin.
   *
   * Two objects clicked in turn with one sim selected must queue against
   * the same sim both times. An implementation that re-read the selection
   * from a sink it had already written to would still pass the single-click
   * test above; this needs the second click to name sim 6 as well.
   */
  it('queues a second object against the same sim', () => {
    const rows = source([
      [9, KIND_OBJECT, 7, 3],
      [10, KIND_OBJECT, 2, 5],
    ]);
    const sink = target(6, rows);
    handleLeftClick(sink, [7, 3]);
    handleLeftClick(sink, [2, 5]);
    expect(sink.calls).toEqual(['use 6 9', 'use 6 10']);
  });
});

describe('handleRightClick', () => {
  /** A `Cancellable` that records whether it was cancelled. */
  function event() {
    const calls = vi.fn();
    return { preventDefault: calls, prevented: calls };
  }

  it('cancels the selected sim and eats the context menu', () => {
    const sink = { ...recordingSink(6), ...source([]) };
    const e = event();
    handleRightClick(sink, e);
    expect(sink.calls).toEqual(['cancel 6']);
    expect(e.prevented).toHaveBeenCalled();
  });

  /**
   * With nothing selected there is nobody to release, so no command is
   * sent - but the menu is still suppressed. The suppression comes first
   * and unconditionally, and this is the case that tells the two orderings
   * apart: check the selection first and the browser menu opens over the
   * lot on every right click made with nothing selected.
   */
  it('suppresses the context menu even with nothing selected', () => {
    const sink = { ...recordingSink(null), ...source([]) };
    const e = event();
    handleRightClick(sink, e);
    expect(sink.calls).toEqual([]);
    expect(e.prevented).toHaveBeenCalled();
  });

  /** Sim zero is a real selection; a falsy check would refuse to release it. */
  it('cancels sim zero, which a falsy check would refuse', () => {
    const sink = { ...recordingSink(0), ...source([]) };
    handleRightClick(sink, event());
    expect(sink.calls).toEqual(['cancel 0']);
  });
});
