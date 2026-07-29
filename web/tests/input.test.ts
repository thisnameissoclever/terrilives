import { describe, expect, it, vi } from 'vitest';
import {
  clientToCanvas,
  clientToTile,
  dispatch,
  handleLeftClick,
  handleRightClick,
  pickAt,
  pickSprite,
  resolveLeftClick,
  type ClickAction,
  type CommandSink,
  type Pick,
  type PickSource,
} from '../src/input.js';
import { SPRITES } from '../src/render/atlas.js';
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
  spriteName = 'sim',
): PickSource {
  const sprite = SPRITES.findIndex((s) => s.name === spriteName);
  if (sprite < 0) throw new Error(`no atlas sprite named ${spriteName}`);
  return {
    count: entities.length,
    positions: () => new Float32Array(entities.flatMap(([, , x, y]) => [x, y])),
    kinds: () => new Uint32Array(entities.map(([, kind]) => kind)),
    ids: () => new Uint32Array(entities.map(([id]) => id)),
    sprites: () => new Uint32Array(entities.map(() => sprite)),
  };
}

/** The atlas entry for a sprite, by name. */
function atlas(name: string) {
  const found = SPRITES.find((s) => s.name === name);
  if (!found) throw new Error(`no atlas sprite named ${name}`);
  return found;
}

/**
 * Where a sprite is actually DRAWN for an entity on `tile`, in canvas pixels -
 * restated from `sprites.wgsl`'s bottom-centre anchoring rather than imported,
 * so a change in the shader does not silently follow into the expectations.
 */
function drawnBox(tile: readonly [number, number], spriteName: string, originX = 0, originY = 0) {
  const s = atlas(spriteName);
  const anchorX = screenX(tile[0], tile[1], originX);
  const anchorY = screenY(tile[0], tile[1], originY) + 16;
  return {
    left: anchorX - s.w / 2,
    right: anchorX + s.w / 2,
    top: anchorY - s.h,
    bottom: anchorY,
    centreX: anchorX,
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
/**
 * Sprite-space picking: what the player actually aims at.
 */
describe('pickSprite', () => {
  /**
   * **The regression test for the bug a real person found.**
   *
   * Tile picking resolved only about a third of the sim's own sprite to the
   * sim's own tile: the head landed two tiles away, the feet one tile past.
   * Clicking the sim did nothing, and the arithmetic was never wrong - it was
   * answering a question a mouse does not ask.
   *
   * Nine points down the sprite's centre line, every one of which must select
   * it. `pickAt` is asserted to MISS most of them in the same test, because
   * that contrast is the whole finding: without it, this passes for any
   * implementation that happens to be generous.
   */
  it('selects a sim from anywhere on its drawn body, where tile picking did not', () => {
    const tile = [8, 6] as const;
    const rows = source([[7, KIND_AGENT, tile[0], tile[1]]]);
    const box = drawnBox(tile, 'sim');

    let tileHits = 0;
    for (let i = 0; i <= 8; i++) {
      const y = box.top + (i / 8) * (box.bottom - box.top);
      expect(
        pickSprite(rows, box.centreX, y, 0, 0)?.entity,
        `${Math.round((100 * i) / 8)}% down the sprite must select the sim`,
      ).toBe(7);

      const asTile = clientToTile(box.centreX, y, UNSCALED, 1280, 720, 0, 0);
      if (asTile && pickAt(rows, asTile[0], asTile[1]) !== null) tileHits++;
    }
    expect(
      tileHits,
      'tile picking must MISS most of the sprite, or this test is not showing why sprite picking was needed',
    ).toBeLessThan(6);
  });

  it('finds nothing on bare floor far from any entity', () => {
    const rows = source([[1, KIND_AGENT, 8, 6]]);
    const box = drawnBox([8, 6], 'sim');
    expect(pickSprite(rows, box.left - 200, box.top - 200, 0, 0)).toBeNull();
  });

  /** Just outside each edge of the box, so a `<=` / `<` slip is visible. */
  it('does not select from just outside the sprite box', () => {
    const rows = source([[1, KIND_AGENT, 8, 6]]);
    const box = drawnBox([8, 6], 'sim');
    const mid = (box.top + box.bottom) / 2;
    expect(pickSprite(rows, box.left - 1, mid, 0, 0)).toBeNull();
    expect(pickSprite(rows, box.right + 1, mid, 0, 0)).toBeNull();
    expect(pickSprite(rows, box.centreX, box.top - 1, 0, 0)).toBeNull();
    expect(pickSprite(rows, box.centreX, box.bottom + 1, 0, 0)).toBeNull();
  });

  /**
   * The entity index out of `ids`, never the row number - the same property
   * `pickAt` has, restated because this is a different function.
   */
  it('returns the entity index in the row, not the row number', () => {
    const rows = source([
      [4, KIND_AGENT, 2, 2],
      [7, KIND_AGENT, 8, 6],
    ]);
    const box = drawnBox([8, 6], 'sim');
    expect(pickSprite(rows, box.centreX, box.bottom - 4, 0, 0)?.entity).toBe(7);
  });

  /**
   * **Overlapping sprites resolve to whatever is drawn in front**, which is
   * the nearer tile - larger x + y.
   *
   * Two sims one tile apart on the same screen column overlap heavily, because
   * a 78-pixel sprite is far taller than the 16 pixels of screen a tile step
   * moves it. Asserted in both row orders, since a "first match wins"
   * implementation passes one of them by luck.
   */
  it('prefers the nearer entity where two sprites overlap', () => {
    const near = [9, 7] as const;
    const far = [8, 6] as const;
    const box = drawnBox(near, 'sim');
    const px = box.centreX;
    const py = box.top + 8;

    const farRow: [number, number, number, number] = [50, KIND_AGENT, far[0], far[1]];
    const nearRow: [number, number, number, number] = [51, KIND_AGENT, near[0], near[1]];

    // Precondition: the point really is inside both sprites, or "the nearer
    // one won" is satisfied by the far one simply not being there.
    expect(pickSprite(source([farRow]), px, py, 0, 0)?.entity).toBe(50);
    expect(pickSprite(source([nearRow]), px, py, 0, 0)?.entity).toBe(51);

    expect(pickSprite(source([farRow, nearRow]), px, py, 0, 0)?.entity).toBe(51);
    expect(pickSprite(source([nearRow, farRow]), px, py, 0, 0)?.entity).toBe(51);
  });

  /**
   * A sim and an object on the SAME tile resolve to the sim, matching the
   * depth layers `frame.ts` assigns. Both orders, for the same reason as
   * above.
   */
  it('prefers a sim to an object on the same tile', () => {
    const tile = [5, 5] as const;
    const box = drawnBox(tile, 'sim');
    const px = box.centreX;
    const py = box.bottom - 4;
    const simSprite = SPRITES.findIndex((s) => s.name === 'sim');
    const fridgeSprite = SPRITES.findIndex((s) => s.name === 'kitchenFridgeBuiltIn');

    const mixed = (kinds: number[], ids: number[], sprites: number[]): PickSource => ({
      count: 2,
      positions: () => new Float32Array([tile[0], tile[1], tile[0], tile[1]]),
      kinds: () => new Uint32Array(kinds),
      ids: () => new Uint32Array(ids),
      sprites: () => new Uint32Array(sprites),
    });

    expect(
      pickSprite(mixed([KIND_OBJECT, KIND_AGENT], [3, 8], [fridgeSprite, simSprite]), px, py, 0, 0),
    ).toEqual({ entity: 8, isAgent: true });
    expect(
      pickSprite(mixed([KIND_AGENT, KIND_OBJECT], [8, 3], [simSprite, fridgeSprite]), px, py, 0, 0),
    ).toEqual({ entity: 8, isAgent: true });
  });

  /** Rows past `count` are not read. */
  it('ignores rows beyond the live count', () => {
    const rows = source([
      [1, KIND_AGENT, 2, 2],
      [2, KIND_AGENT, 8, 6],
    ]);
    const truncated: PickSource = { ...rows, count: 1 };
    const box = drawnBox([8, 6], 'sim');
    expect(pickSprite(truncated, box.centreX, box.bottom - 4, 0, 0)).toBeNull();
  });

  /** The camera offset is applied, not ignored. */
  it('respects the camera origin', () => {
    const rows = source([[1, KIND_AGENT, 8, 6]]);
    const box = drawnBox([8, 6], 'sim', 300, 120);
    expect(pickSprite(rows, box.centreX, box.bottom - 4, 300, 120)?.entity).toBe(1);
    expect(pickSprite(rows, box.centreX, box.bottom - 4, 0, 0)).toBeNull();
  });

  /**
   * A sprite index the atlas does not hold is skipped rather than throwing. A
   * click is not the place to discover a content mismatch.
   */
  it('skips a row whose sprite index is out of range', () => {
    const rows: PickSource = {
      count: 1,
      positions: () => new Float32Array([8, 6]),
      kinds: () => new Uint32Array([KIND_AGENT]),
      ids: () => new Uint32Array([1]),
      sprites: () => new Uint32Array([9999]),
    };
    expect(() => pickSprite(rows, 0, 0, 0, 0)).not.toThrow();
    expect(pickSprite(rows, 0, 0, 0, 0)).toBeNull();
  });
});

describe('clientToCanvas', () => {
  it('maps a client point into drawing-buffer pixels', () => {
    expect(clientToCanvas(100, 50, UNSCALED, 1280, 720)).toEqual({ x: 100, y: 50 });
  });

  it('scales by the ratio between the rect and the drawing buffer', () => {
    const halved = { left: 0, top: 0, width: 640, height: 360 };
    expect(clientToCanvas(100, 50, halved, 1280, 720)).toEqual({ x: 200, y: 100 });
  });

  it('subtracts the rect offset', () => {
    const offset = { left: 30, top: 17, width: 1280, height: 720 };
    expect(clientToCanvas(130, 117, offset, 1280, 720)).toEqual({ x: 100, y: 100 });
  });

  it('returns null for a canvas with no area', () => {
    expect(clientToCanvas(10, 10, { left: 0, top: 0, width: 0, height: 0 }, 1280, 720)).toBeNull();
  });
});

/**
 * The end-to-end path a click takes, minus the DOM: a canvas point in,
 * commands out. `attachPointerInput` itself is the untested wiring, exactly as
 * `buildTimeControls` is - there is no jsdom here and the project's convention
 * is structural fakes rather than a browser environment.
 */
describe('handleLeftClick', () => {
  function target(selected: number | null, rows: PickSource) {
    return { ...recordingSink(selected), ...rows };
  }
  /** A point on the drawn body of whatever stands on `tile`. */
  function bodyOf(tile: readonly [number, number], spriteName = 'sim') {
    const box = drawnBox(tile, spriteName);
    return { x: box.centreX, y: box.bottom - 6 };
  }

  it('selects the sim whose sprite was clicked', () => {
    const sink = target(null, source([[6, KIND_AGENT, 4, 2]]));
    handleLeftClick(sink, bodyOf([4, 2]), 0, 0);
    expect(sink.calls).toEqual(['select 6']);
  });

  it('directs the selected sim at the object whose sprite was clicked', () => {
    const sink = target(6, source([[9, KIND_OBJECT, 7, 3]]));
    handleLeftClick(sink, bodyOf([7, 3]), 0, 0);
    expect(sink.calls).toEqual(['use 6 9']);
  });

  it('clears the selection when the click lands on bare floor', () => {
    const sink = target(6, source([[9, KIND_OBJECT, 7, 3]]));
    handleLeftClick(sink, { x: -400, y: -400 }, 0, 0);
    expect(sink.calls).toEqual(['select null']);
  });

  /**
   * A point the projection could not place does nothing - it must not fall
   * through to the bare-floor case, or a click on a collapsed canvas would
   * deselect the sim the player is watching.
   */
  it('does nothing at all for an unplaceable click', () => {
    const sink = target(6, source([[9, KIND_OBJECT, 7, 3]]));
    handleLeftClick(sink, null, 0, 0);
    expect(sink.calls).toEqual([]);
  });

  /**
   * The selection is read BEFORE the dispatch, which is the ordering this
   * function exists to pin.
   *
   * Two objects clicked in turn with one sim selected must queue against the
   * same sim both times. An implementation that re-read the selection from a
   * sink it had already written to would still pass the single-click test
   * above; this needs the second click to name sim 6 as well.
   */
  it('queues a second object against the same sim', () => {
    const rows = source([
      [9, KIND_OBJECT, 7, 3],
      [10, KIND_OBJECT, 2, 5],
    ]);
    const sink = target(6, rows);
    handleLeftClick(sink, bodyOf([7, 3]), 0, 0);
    handleLeftClick(sink, bodyOf([2, 5]), 0, 0);
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
