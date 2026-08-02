import { describe, expect, it, vi } from 'vitest';
import {
  clientToCanvas,
  clientToTile,
  dispatch,
  dispatchMenuAction,
  handleLeftClick,
  handleRightClick,
  LongPressGesture,
  pickAt,
  pickSprite,
  resolveLeftClick,
  resolveRightClick,
  type ClickAction,
  type CommandSink,
  type InteractionSource,
  type MenuController,
  type Pick,
  type PickSource,
} from '../src/input.js';
import { NEVER_MIND, type MenuEntry } from '../src/ui/object-menu.js';
import { SPRITES } from '../src/render/atlas.js';
import { KIND_AGENT } from '../src/render/instances.js';
import { TILE_HALF_HEIGHT, screenX, screenY } from '../src/render/iso.js';

const KIND_OBJECT = 1;

describe('LongPressGesture', () => {
  function manualScheduler() {
    let callback: (() => void) | null = null;
    const cancelled: unknown[] = [];
    return {
      scheduler: {
        after(_delayMs: number, run: () => void) {
          callback = run;
          return 'timer';
        },
        cancel(handle: unknown) {
          cancelled.push(handle);
          callback = null;
        },
      },
      fire() {
        const run = callback as (() => void) | null;
        callback = null;
        run?.();
      },
      cancelled,
    };
  }

  it('opens at the original touch point after the hold', () => {
    const timer = manualScheduler();
    const fired: Array<[number, number]> = [];
    const gesture = new LongPressGesture(
      (x, y) => fired.push([x, y]),
      timer.scheduler,
      500,
      6,
    );

    gesture.begin(7, 120, 240);
    gesture.move(7, 123, 242);
    timer.fire();

    expect(fired).toEqual([[120, 240]]);
  });

  it('ignores another pointer and cancels after a drag, lift, or cancellation', () => {
    const timer = manualScheduler();
    const fired = vi.fn();
    const gesture = new LongPressGesture(fired, timer.scheduler, 500, 6);

    gesture.begin(1, 10, 10);
    gesture.move(2, 100, 100);
    timer.fire();
    expect(fired).toHaveBeenCalledTimes(1);

    gesture.begin(1, 10, 10);
    gesture.move(1, 17, 10);
    timer.fire();
    gesture.begin(1, 10, 10);
    gesture.end(1);
    timer.fire();
    gesture.begin(1, 10, 10);
    gesture.cancel();
    timer.fire();

    expect(fired).toHaveBeenCalledTimes(1);
    expect(timer.cancelled).toEqual(['timer', 'timer', 'timer']);
  });
});

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
    // Everybody home: the at-work pick skip has its own fixtures.
    activities: () => new Uint32Array(entities.length),
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
function drawnBox(
  tile: readonly [number, number],
  spriteName: string,
  originX = 0,
  originY = 0,
  scale = 1,
) {
  const s = atlas(spriteName);
  const anchorX = screenX(tile[0], tile[1], originX, scale);
  const anchorY =
    screenY(tile[0], tile[1], originY, scale) + TILE_HALF_HEIGHT * scale;
  return {
    left: anchorX - (s.w / 2) * scale,
    right: anchorX + (s.w / 2) * scale,
    top: anchorY - s.h * scale,
    bottom: anchorY,
    centreX: anchorX,
  };
}

/**
 * A `CommandSink` that records the commands it was sent AND models what
 * they would leave in the sim's intent queue.
 *
 * **The model is the point, and it is three lines of `drain_commands`
 * rather than a guess**: a `CancelIntents` empties the named agent's
 * queue, a `UseObject` pushes one intent onto it, and a batch is applied
 * in issue order. That is exactly what
 * `a_cancel_then_a_use_in_one_batch_replaces_the_queue_rather_than_appending_to_it`
 * and `the_reverse_order_does_not_replace_and_is_why_the_shell_sends_cancel_first`
 * pin on the Rust side, which is what keeps this from being a fake that
 * merely agrees with itself.
 *
 * It exists because "replace" and "append" are claims about the QUEUE, and
 * a list of emitted commands cannot state them: `cancel, use, cancel, use`
 * and `use, use` are both four-symbol strings, and only one of them leaves
 * the sim with one instruction. `queue` is what makes the difference
 * countable.
 *
 * The cap is deliberately not modelled. `max_queued_intents` refuses
 * anything past it, and every fixture here queues two at most.
 */
function recordingSink(selected: number | null = null): CommandSink & {
  readonly calls: string[];
  /**
   * The intents the sim would be holding, oldest first, as
   * `[object, interaction]`.
   *
   * The pair rather than the object alone, because an intent IS a pair -
   * `Intent { object, interaction }` in Rust - and a model that recorded
   * only the object could not tell two rows of one object's flyout apart.
   */
  readonly queue: [number, number][];
} {
  const calls: string[] = [];
  const queue: [number, number][] = [];
  return {
    calls,
    queue,
    select: (index) => (calls.push(`select ${index}`), true),
    // The interaction is in the recorded string, so a dispatcher that
    // dropped it or substituted 0 shows up in `calls` and not only in the
    // queue model.
    useObject: (agent, object, interaction) => (
      calls.push(`use ${agent} ${object} ${interaction}`),
      queue.push([object, interaction]),
      true
    ),
    talkTo: (agent, target, interaction) => (
      calls.push(`talk ${agent} ${target} ${interaction}`),
      queue.push([target, interaction]),
      true
    ),
    cancelIntents: (agent) => (
      calls.push(`cancel ${agent}`), (queue.length = 0), true
    ),
    selectedIndex: () => selected,
  };
}

/**
 * The labels a fake object offers, keyed by entity index. Anything not in
 * the table reports none, which is what a sim and a stale index both look
 * like across the boundary.
 */
function labelsFrom(
  table: Readonly<Record<number, readonly string[]>>,
): InteractionSource {
  return {
    interactionLabels: (entity) => table[entity] ?? [],
    socialLabels: () => ['Chat'],
  };
}

/** A flyout that records what it was asked to do and nothing else. */
function recordingMenu(): MenuController & {
  readonly calls: string[];
  opened: readonly MenuEntry[] | null;
} {
  const calls: string[] = [];
  const menu = {
    calls,
    opened: null as readonly MenuEntry[] | null,
    open(entries: readonly MenuEntry[], clientX: number, clientY: number) {
      calls.push(`open ${clientX},${clientY}`);
      menu.opened = entries;
    },
    close() {
      calls.push('close');
      menu.opened = null;
    },
  };
  return menu;
}

/** A right click at a page position, recording whether it was suppressed. */
function rightClick(clientX = 0, clientY = 0) {
  const prevented = vi.fn();
  return { clientX, clientY, preventDefault: prevented, prevented };
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
      screenY(4, 4, 0) + TILE_HALF_HEIGHT,
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

  /**
   * A worker frozen at the door tile must not swallow a tile click -
   * pickSprite's at-work skip, restated for the tile picker. The same
   * row with the flag cleared DOES pick.
   */
  it('skips a sim that is at work', () => {
    const rows = source([[5, KIND_AGENT, 15, 2]]);
    expect(pickAt(rows, 15, 2)?.entity).toBe(5);
    const atWork: PickSource = { ...rows, activities: () => Uint32Array.from([6]) };
    expect(pickAt(atWork, 15, 2)).toBeNull();
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
  /** A plain click, which is [I3]'s redirect. */
  const PLAIN = false;
  /** Ctrl or cmd held, which is [I3]'s queue. */
  const ADDITIVE = true;

  it('selects a clicked sim', () => {
    expect(resolveLeftClick(sim, null, PLAIN)).toEqual({
      kind: 'select',
      entity: 4,
    });
  });

  it('selects a clicked sim even when another is already selected', () => {
    expect(resolveLeftClick(sim, 2, PLAIN)).toEqual({
      kind: 'select',
      entity: 4,
    });
  });

  /**
   * **The modifier must not change what a click on a SIM means.**
   *
   * Ctrl-click is the queue gesture and a sim is not something to queue,
   * so it has to stay a plain selection. A resolution that branched on the
   * modifier before it branched on what was picked would swallow the
   * ctrl-click entirely, and the player would find that holding ctrl made
   * sims unclickable with nothing on screen to say why.
   */
  it('selects a clicked sim whether or not the queue modifier is held', () => {
    expect(resolveLeftClick(sim, 2, ADDITIVE)).toEqual({
      kind: 'select',
      entity: 4,
    });
  });

  /**
   * **The decision [I3] reversed**, stated as the two actions it produces.
   *
   * A plain click carries `replace`; a ctrl-click does not. Asserted as a
   * pair in one test rather than two, because either one alone passes on
   * an implementation that ignores the modifier and hardcodes its own
   * answer - which is precisely the code that was here before.
   */
  it('replaces on a plain click and appends when the modifier is held', () => {
    expect(resolveLeftClick(object, 4, PLAIN)).toEqual({
      kind: 'use',
      agent: 4,
      object: 9,
      interaction: 0,
      replace: true,
    });
    expect(resolveLeftClick(object, 4, ADDITIVE)).toEqual({
      kind: 'use',
      agent: 4,
      object: 9,
      interaction: 0,
      replace: false,
    });
  });

  /**
   * **A left click names interaction 0, and that has to be asserted rather
   * than assumed.** `toEqual` above is exhaustive over the object's own
   * keys, so it already fails if the field goes missing - but it would also
   * pass if the field arrived as `undefined` from a source that had stopped
   * setting it, and `undefined` is what `pushVarint` would turn into `NaN`
   * and `isU32` would then refuse. Reading the number back explicitly says
   * what the gesture means: a click picks an OBJECT, so it takes that
   * object's first interaction, and choosing among several is the flyout's
   * job.
   *
   * The modifier is asserted not to change it either. Ctrl-click alters
   * whether the instruction replaces or appends, not which verb it names.
   */
  it('names the objects first interaction, whatever the modifier', () => {
    for (const additive of [PLAIN, ADDITIVE]) {
      const action = resolveLeftClick(object, 4, additive);
      expect(action.kind).toBe('use');
      if (action.kind !== 'use') throw new Error('narrowing');
      expect(action.interaction).toBe(0);
    }
  });

  /**
   * Entity 0 is a legitimate selection and `0` is falsy. A `if (!selected)`
   * check would refuse to direct the first sim in the world, which is the
   * only sim the game currently has.
   */
  it('directs sim zero, which a falsy check would refuse', () => {
    expect(resolveLeftClick(object, 0, PLAIN)).toEqual({
      kind: 'use',
      agent: 0,
      object: 9,
      interaction: 0,
      replace: true,
    });
  });

  it('does nothing when an object is clicked with nothing selected', () => {
    expect(resolveLeftClick(object, null, PLAIN)).toEqual({ kind: 'none' });
  });

  it('clears the selection on bare floor', () => {
    expect(resolveLeftClick(null, 4, PLAIN)).toEqual({
      kind: 'select',
      entity: null,
    });
  });

  /**
   * Directing must not change the selection, or the second click of a
   * queued pair would have nothing to queue against.
   */
  it('leaves the selection alone when directing', () => {
    const action = resolveLeftClick(object, 4, PLAIN);
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

  it('sends an append as the use alone', () => {
    const sink = recordingSink();
    dispatch(sink, {
      kind: 'use',
      agent: 1,
      object: 6,
      interaction: 0,
      replace: false,
    });
    expect(sink.calls).toEqual(['use 1 6 0']);
  });

  /**
   * **The action's interaction index reaches the command.** A left click
   * always carries 0, so every other test in this describe block is an
   * input domain in which "the index was forwarded" and "0 was hardcoded"
   * agree on every observation - [L34]. A menu row is where a non-zero one
   * comes from, and `dispatch` is on that path too: `handleLeftClick` is
   * not the only caller.
   *
   * 3 rather than 1, so an off-by-one - forwarding `interaction + 1`, or a
   * boolean coerced from it - is visible as well as a substituted 0.
   */
  it('forwards the interaction index rather than substituting the first', () => {
    const sink = recordingSink();
    dispatch(sink, {
      kind: 'use',
      agent: 1,
      object: 6,
      interaction: 3,
      replace: true,
    });
    expect(sink.calls).toEqual(['cancel 1', 'use 1 6 3']);
    expect(sink.queue).toEqual([[6, 3]]);
  });

  /**
   * **The order, and it is the whole of "replace".**
   *
   * `drain_commands` applies a batch in issue order, so cancel-then-use
   * empties the queue and puts the new instruction in it, while
   * use-then-cancel stages the new instruction and then wipes it - the
   * cancel's `fresh.retain` and `clear()` both see what the same batch just
   * staged. The sim would end up holding nothing and the click would look
   * ignored.
   *
   * `toEqual` on the whole array rather than two `toContain`s, because
   * containment is order-blind and order is the only thing under test here.
   * Swapping the two lines in `dispatch` fails this and nothing else in the
   * file, which is why the queue model below exists as well.
   */
  it('sends a replace as cancel first and then use, in that order', () => {
    const sink = recordingSink();
    dispatch(sink, {
      kind: 'use',
      agent: 1,
      object: 6,
      interaction: 0,
      replace: true,
    });
    expect(sink.calls).toEqual(['cancel 1', 'use 1 6 0']);
  });

  /**
   * The same ordering claim measured on the QUEUE rather than on the call
   * list, so it survives someone rewording the recorded strings - and so
   * that the reversal is visible as the behaviour it produces rather than
   * as a permuted array.
   *
   * Reversed, the model ends at zero instructions rather than one, which is
   * a sim standing still after a click.
   */
  it('leaves the replaced sim holding exactly the new instruction', () => {
    const sink = recordingSink(1);
    dispatch(sink, {
      kind: 'use',
      agent: 1,
      object: 6,
      interaction: 0,
      replace: false,
    });
    dispatch(sink, {
      kind: 'use',
      agent: 1,
      object: 7,
      interaction: 1,
      replace: true,
    });
    // The replacement carries its OWN interaction index, so this also
    // fails on a dispatcher that reused the index of the intent it
    // replaced - which a fixture whose two actions both named 0 could not
    // see.
    expect(sink.queue).toEqual([[7, 1]]);
  });

  it('sends nothing at all for none', () => {
    const sink = recordingSink();
    expect(dispatch(sink, { kind: 'none' } satisfies ClickAction)).toBeNull();
    expect(sink.calls).toEqual([]);
  });

  it('reports a command-queue rejection to the caller', () => {
    const sink = recordingSink(1);
    sink.useObject = () => false;
    expect(
      dispatch(sink, {
        kind: 'use',
        agent: 1,
        object: 6,
        interaction: 0,
        replace: false,
      }),
    ).toBe(false);
  });
});

/**
 * The end-to-end path a click takes, minus the DOM: a tile in, commands
 * out. `attachPointerInput` itself is the untested wiring, exactly as
 * `buildTimeControls` is - there is no jsdom here and the project's
 * convention is structural fakes rather than a browser environment.
 */
/** Sprite-space picking: what the player actually aims at. */
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
   * **The hit box is the ZOOMED quad.** Zoomed out to 0.5x the sprite
   * is drawn half-size, and a click where its 1x head used to be is now
   * bare floor - a hit box that ignored the camera would keep selecting
   * from empty pixels there, and at 2.5x would refuse most of the drawn
   * body. 0.5x rather than 2x for the positive case, because a SHRUNK
   * box is the direction an unscaled hit box gets wrong visibly: the
   * scaled-box top is inside the unscaled box, so only the shrunk
   * fixture separates the two implementations in both assertions.
   */
  it('scales the hit box with the camera', () => {
    const tile = [8, 6] as const;
    const rows = source([[7, KIND_AGENT, tile[0], tile[1]]]);
    const zoomedOut = drawnBox(tile, 'sim', 0, 0, 0.5);
    const unzoomed = drawnBox(tile, 'sim');

    // Every point of the zoomed body still selects.
    for (let i = 0; i <= 4; i++) {
      const y = zoomedOut.top + (i / 4) * (zoomedOut.bottom - zoomedOut.top);
      expect(
        pickSprite(rows, zoomedOut.centreX, y, 0, 0, 0.5)?.entity,
        `${Math.round((100 * i) / 4)}% down the zoomed sprite must select`,
      ).toBe(7);
    }
    // The 1x head height is EMPTY pixels at 0.5x: above the shrunk box.
    expect(pickSprite(rows, unzoomed.centreX, unzoomed.top + 1, 0, 0, 0.5)).toBeNull();
  });

  it('keeps the full walking headroom clickable at every zoom', () => {
    const tile = [8, 6] as const;
    const base = source([[7, KIND_AGENT, tile[0], tile[1]]]);
    const walking: PickSource = {
      ...base,
      activities: () => Uint32Array.from([1]),
    };

    for (const scale of [0.5, 1, 2.5]) {
      const box = drawnBox(tile, 'sim', 0, 0, scale);
      // Picking has the tick position but not the frame interpolation alpha.
      // Use the complete two-pixel travel envelope so no visible footfall can
      // escape the target between ticks, even when this sample is planted.
      expect(
        pickSprite(
          walking,
          box.centreX,
          box.top - 2 * scale,
          0,
          0,
          scale,
        )?.entity,
      ).toBe(7);
      expect(
        pickSprite(base, box.centreX, box.top - 2 * scale, 0, 0, scale),
      ).toBeNull();
      expect(
        pickSprite(
          walking,
          box.centreX,
          box.top - 2 * scale - 0.01,
          0,
          0,
          scale,
        ),
      ).toBeNull();
    }
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
   * A sim at work is not drawn (frame.ts parks its row off-screen), so
   * it must not be clickable either - the pick box and the pixels move
   * together, the standing rule. The same rows with the flag cleared
   * DO pick, so the assertion is about the flag rather than the box.
   */
  it('skips a sim that is at work', () => {
    const rows = source([[1, KIND_AGENT, 8, 6]]);
    const box = drawnBox([8, 6], 'sim');
    const atWork: PickSource = { ...rows, activities: () => Uint32Array.from([6]) };
    expect(pickSprite(rows, box.centreX, box.bottom - 4, 0, 0)?.entity).toBe(1);
    expect(pickSprite(atWork, box.centreX, box.bottom - 4, 0, 0)).toBeNull();
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
      activities: () => new Uint32Array(2),
    });

    expect(
      pickSprite(mixed([KIND_OBJECT, KIND_AGENT], [3, 8], [fridgeSprite, simSprite]), px, py, 0, 0),
    ).toEqual({ entity: 8, isAgent: true });
    expect(
      pickSprite(mixed([KIND_AGENT, KIND_OBJECT], [8, 3], [simSprite, fridgeSprite]), px, py, 0, 0),
    ).toEqual({ entity: 8, isAgent: true });
  });

  /**
   * **Two entities of the SAME kind on the same tile resolve to the earlier
   * row**, which is documented rule 3 and had no test.
   *
   * A code review found the gap: relaxing the layer comparison from `>` to
   * `>=` makes the LATER row win on an equal-depth, equal-layer tie, and all
   * 159 web tests still passed. `pickAt` has the equivalent test; `pickSprite`
   * did not.
   *
   * The rule is not arbitrary - it is what the depth buffer does. Both rows get
   * the same depth, `depthCompare` is `less`, and equal is not less, so the
   * first one drawn keeps the pixel. Picking has to agree with that or a click
   * selects something the player cannot see.
   *
   * Two objects rather than two sims, because two sims on a tile only happens
   * under `?stress=N` while two props on a tile is a lot-authoring mistake
   * waiting to happen - and the earlier-row rule is what makes the outcome
   * defined either way.
   */
  it('picks the earlier row when two entities share a tile and a layer', () => {
    const tile = [6, 4] as const;
    const box = drawnBox(tile, 'kitchenFridgeBuiltIn');
    const fridge = SPRITES.findIndex((sp) => sp.name === 'kitchenFridgeBuiltIn');
    const rows: PickSource = {
      count: 2,
      positions: () => new Float32Array([tile[0], tile[1], tile[0], tile[1]]),
      kinds: () => new Uint32Array([KIND_OBJECT, KIND_OBJECT]),
      ids: () => new Uint32Array([21, 22]),
      sprites: () => new Uint32Array([fridge, fridge]),
      activities: () => new Uint32Array(2),
    };

    // Precondition: the point is inside the box at all, or "the earlier row
    // won" is satisfied by neither row being hit.
    expect(pickSprite(rows, box.centreX, box.bottom - 6, 0, 0)).not.toBeNull();
    expect(pickSprite(rows, box.centreX, box.bottom - 6, 0, 0)?.entity).toBe(21);

    // And with the ids swapped, so the assertion cannot pass on "returns the
    // smaller entity index" instead of "returns the earlier row".
    const swapped: PickSource = { ...rows, ids: () => new Uint32Array([22, 21]) };
    expect(pickSprite(swapped, box.centreX, box.bottom - 6, 0, 0)?.entity).toBe(22);
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
      activities: () => new Uint32Array(1),
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
  /** A plain click, which is [I3]'s redirect. */
  const PLAIN = false;
  /** Ctrl or cmd held, which is [I3]'s queue. */
  const ADDITIVE = true;

  function target(selected: number | null, rows: PickSource) {
    return { ...recordingSink(selected), ...rows };
  }
  /** A point on the drawn body of whatever stands on `tile`. */
  function bodyOf(tile: readonly [number, number], spriteName = 'sim') {
    const box = drawnBox(tile, spriteName);
    return { x: box.centreX, y: box.bottom - 6 };
  }

  /**
   * TWO objects on separate tiles, which is the fixture the whole
   * replace-versus-append question needs: with one object, "clicked the
   * same thing twice" and "replaced the first instruction" predict the same
   * single-entry queue, so a one-object lot cannot tell them apart at all.
   */
  const TWO_OBJECTS = source([
    [9, KIND_OBJECT, 7, 3],
    [10, KIND_OBJECT, 2, 5],
  ]);

  it('selects the sim whose sprite was clicked', () => {
    const sink = target(null, source([[6, KIND_AGENT, 4, 2]]));
    expect(handleLeftClick(sink, bodyOf([4, 2]), 0, 0, PLAIN)).toEqual({
      kind: 'selection',
      accepted: true,
    });
    expect(sink.calls).toEqual(['select 6']);
  });

  it('directs the selected sim at the object whose sprite was clicked', () => {
    const sink = target(6, source([[9, KIND_OBJECT, 7, 3]]));
    expect(handleLeftClick(sink, bodyOf([7, 3]), 0, 0, PLAIN)).toEqual({
      kind: 'order',
      accepted: true,
    });
    expect(sink.calls).toEqual(['cancel 6', 'use 6 9 0']);
  });

  it('clears the selection when the click lands on bare floor', () => {
    const sink = target(6, source([[9, KIND_OBJECT, 7, 3]]));
    handleLeftClick(sink, { x: -400, y: -400 }, 0, 0, PLAIN);
    expect(sink.calls).toEqual(['select null']);
  });

  /**
   * A point the projection could not place does nothing - it must not fall
   * through to the bare-floor case, or a click on a collapsed canvas would
   * deselect the sim the player is watching.
   */
  it('does nothing at all for an unplaceable click', () => {
    const sink = target(6, source([[9, KIND_OBJECT, 7, 3]]));
    expect(handleLeftClick(sink, null, 0, 0, PLAIN)).toEqual({ kind: 'none' });
    expect(sink.calls).toEqual([]);
  });

  it('distinguishes a rejected selection from a rejected order', () => {
    const selection = target(null, source([[6, KIND_AGENT, 4, 2]]));
    selection.select = () => false;
    expect(handleLeftClick(selection, bodyOf([4, 2]), 0, 0, PLAIN)).toEqual({
      kind: 'selection',
      accepted: false,
    });

    const order = target(6, source([[9, KIND_OBJECT, 7, 3]]));
    order.useObject = () => false;
    expect(handleLeftClick(order, bodyOf([7, 3]), 0, 0, ADDITIVE)).toEqual({
      kind: 'order',
      accepted: false,
    });
  });

  /**
   * **[I3], end to end and countable: a plain click on a SECOND object
   * leaves one instruction, and a ctrl-click leaves two.**
   *
   * Both halves in one test, against the same two-object lot, because
   * either alone is satisfied by an implementation that ignores the
   * modifier: assert only the plain case and a shell that always replaces
   * passes; assert only the additive case and the shell this task replaced
   * - which always appended - passes. The pair is what pins that the
   * modifier decides.
   *
   * The queue is asserted by CONTENT rather than by length, so "one
   * instruction" cannot be satisfied by the wrong one: a replace that kept
   * the first object would also leave a single entry, and it is the second
   * object the player just clicked.
   */
  it('leaves one instruction after a plain second click and two after a ctrl-click', () => {
    const redirected = target(6, TWO_OBJECTS);
    handleLeftClick(redirected, bodyOf([7, 3]), 0, 0, PLAIN);
    handleLeftClick(redirected, bodyOf([2, 5]), 0, 0, PLAIN);
    expect(
      redirected.queue,
      'a plain click must replace, so only the object clicked last survives',
    ).toEqual([[10, 0]]);

    const queued = target(6, TWO_OBJECTS);
    handleLeftClick(queued, bodyOf([7, 3]), 0, 0, PLAIN);
    handleLeftClick(queued, bodyOf([2, 5]), 0, 0, ADDITIVE);
    expect(
      queued.queue,
      'a ctrl-click must append, so both objects survive in click order',
    ).toEqual([
      [9, 0],
      [10, 0],
    ]);
  });

  /**
   * The commands behind the counts above, so a broken model in the fake
   * cannot hide a broken shell. The redirect is two commands and the queue
   * is one - `toEqual` on the array, because the cancel arriving after the
   * use is the reversal that produces an empty queue instead of a replaced
   * one.
   */
  it('sends the cancel before the use on a plain click and neither on a ctrl-click', () => {
    const redirected = target(6, TWO_OBJECTS);
    handleLeftClick(redirected, bodyOf([2, 5]), 0, 0, PLAIN);
    expect(redirected.calls).toEqual(['cancel 6', 'use 6 10 0']);

    const queued = target(6, TWO_OBJECTS);
    handleLeftClick(queued, bodyOf([2, 5]), 0, 0, ADDITIVE);
    expect(
      queued.calls,
      'a ctrl-click must send no cancel, or appending is a replace wearing a modifier',
    ).toEqual(['use 6 10 0']);
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
    const sink = target(6, TWO_OBJECTS);
    handleLeftClick(sink, bodyOf([7, 3]), 0, 0, ADDITIVE);
    handleLeftClick(sink, bodyOf([2, 5]), 0, 0, ADDITIVE);
    expect(sink.calls).toEqual(['use 6 9 0', 'use 6 10 0']);
  });
});

/**
 * Which rows a right click asks the flyout for. The rows themselves, and
 * everything about when the flyout goes away, are `ObjectMenu`'s and live
 * in `object-menu.test.ts`.
 */
describe('resolveRightClick', () => {
  /** Two objects on separate tiles, offering DIFFERENT interaction lists. */
  const OBJECTS = source([
    [9, KIND_OBJECT, 7, 3],
    [10, KIND_OBJECT, 2, 5],
  ]);
  const LABELS = labelsFrom({
    9: ['Eat standing up'],
    10: ['Sink into it', 'Nap on it'],
  });

  function target(selected: number | null, rows: PickSource = OBJECTS) {
    return { ...recordingSink(selected), ...rows, ...LABELS };
  }
  function bodyOf(tile: readonly [number, number], spriteName = 'sim') {
    const box = drawnBox(tile, spriteName);
    return { x: box.centreX, y: box.bottom - 6 };
  }

  /**
   * **The rows come from the object's own interaction list, and every part
   * of that sentence is asserted here.**
   *
   * Two objects with lists of DIFFERENT LENGTHS and different wording, both
   * checked in the same run. A menu built from a hardcoded single entry
   * passes on neither; one that reported whichever object it found first
   * passes on one of the two; one that returned a constant list passes on
   * neither. A fixture with one object, or with two identical lists, would
   * see none of those - [L34].
   *
   * The order is asserted too, because a row's position IS
   * `Intent::interaction`, so a sorted or reversed list would renumber an
   * index the simulation owns.
   */
  it('lists the interactions of the object that was clicked, in interaction order', () => {
    const sink = target(6);

    expect(resolveRightClick(sink, bodyOf([7, 3]), 0, 0)).toEqual([
      { label: 'Eat standing up', action: { kind: 'use', object: 9, interaction: 0 } },
      NEVER_MIND,
    ]);
    expect(resolveRightClick(sink, bodyOf([2, 5]), 0, 0)).toEqual([
      { label: 'Sink into it', action: { kind: 'use', object: 10, interaction: 0 } },
      { label: 'Nap on it', action: { kind: 'use', object: 10, interaction: 1 } },
      NEVER_MIND,
    ]);
  });

  /**
   * A right click that hits nothing actionable still offers the cancel,
   * because that is the binding [I4] MOVED into the menu rather than
   * deleted. Both misses are asserted - bare floor and the SELECTED sim
   * itself - since they reach the same answer by different routes and
   * only one of them involves a pick at all. A different sim is not a
   * miss any more; that split is the test below.
   */
  it('offers the cancel alone on bare floor and on the selected sim itself', () => {
    const sink = target(6, source([[6, KIND_AGENT, 4, 2]]));
    expect(resolveRightClick(sink, { x: -400, y: -400 }, 0, 0)).toEqual([
      NEVER_MIND,
    ]);
    expect(resolveRightClick(sink, bodyOf([4, 2]), 0, 0)).toEqual([
      NEVER_MIND,
    ]);
  });

  /**
   * **The three-way split over sims** - the [A-11] talk command's front
   * door. A housemate offers the social vocabulary; the selected sim
   * itself only the cancel, asserted in the SAME fixture so the split is
   * what distinguishes them rather than two fixtures happening to agree.
   * Two labels, because row order IS `TalkTo`'s interaction index: a
   * builder that hardcoded one row, or renumbered them, is visible only
   * with a second row ([L34]).
   */
  it('offers the social verbs on a housemate, in vocabulary order', () => {
    const rows = source([
      [6, KIND_AGENT, 4, 2],
      [8, KIND_AGENT, 7, 3],
    ]);
    const sink = {
      ...target(6, rows),
      socialLabels: () => ['Chat', 'Gossip'],
    };

    expect(resolveRightClick(sink, bodyOf([7, 3]), 0, 0)).toEqual([
      { label: 'Chat', action: { kind: 'talk', target: 8, interaction: 0 } },
      { label: 'Gossip', action: { kind: 'talk', target: 8, interaction: 1 } },
      NEVER_MIND,
    ]);
    expect(resolveRightClick(sink, bodyOf([4, 2]), 0, 0)).toEqual([
      NEVER_MIND,
    ]);
  });

  /**
   * **The documented answer to "what if nothing is selected".** Every row
   * acts on the selected sim, so with no selection there is no menu at all
   * rather than a menu of rows that do nothing.
   *
   * The same click WITH a selection is asserted beside it, so "returns
   * null" cannot be satisfied by a resolution that never opens anything.
   */
  it('opens no menu at all when nothing is selected', () => {
    expect(resolveRightClick(target(null), bodyOf([7, 3]), 0, 0)).toBeNull();
    expect(
      resolveRightClick(target(6), bodyOf([7, 3]), 0, 0),
      'the same click must produce rows once a sim is selected, or this test is green on a resolution that never opens anything',
    ).not.toBeNull();
  });

  /** Sim zero is a real selection; a falsy check would refuse it a menu. */
  it('opens for sim zero, which a falsy check would refuse', () => {
    expect(resolveRightClick(target(0), bodyOf([7, 3]), 0, 0)).not.toBeNull();
  });

  /**
   * A point the projection could not place is a miss rather than a throw,
   * and it still offers the cancel - the same answer bare floor gets, for
   * the same reason.
   */
  it('treats an unplaceable point as a miss rather than throwing', () => {
    expect(resolveRightClick(target(6), null, 0, 0)).toEqual([NEVER_MIND]);
  });
});

describe('handleRightClick', () => {
  const OBJECTS = source([[9, KIND_OBJECT, 7, 3]]);
  const LABELS = labelsFrom({ 9: ['Eat standing up'] });

  function target(selected: number | null) {
    return { ...recordingSink(selected), ...OBJECTS, ...LABELS };
  }
  function bodyOf(tile: readonly [number, number], spriteName = 'sim') {
    const box = drawnBox(tile, spriteName);
    return { x: box.centreX, y: box.bottom - 6 };
  }

  it('opens the flyout at the pointer and eats the browser menu', () => {
    const sink = target(6);
    const menu = recordingMenu();
    const event = rightClick(310, 47);

    handleRightClick(sink, menu, event, bodyOf([7, 3]), 0, 0);

    expect(event.prevented).toHaveBeenCalled();
    expect(
      menu.calls,
      'the menu must open at the CLIENT point the event carried, not at the canvas point',
    ).toEqual(['open 310,47']);
    expect(menu.opened?.map((entry) => entry.label)).toEqual([
      'Eat standing up',
      NEVER_MIND.label,
    ]);
  });

  /**
   * **A right click sends no command by itself any more.** Cancelling is
   * now a row the player has to pick, and a handler that still cancelled on
   * the way to opening the menu would release the sim before showing it a
   * menu that offers to release the sim.
   */
  it('sends no command of its own', () => {
    const sink = target(6);
    handleRightClick(sink, recordingMenu(), rightClick(), bodyOf([7, 3]), 0, 0);
    expect(sink.calls).toEqual([]);
  });

  /**
   * With nothing selected no menu opens - but the browser's is still
   * suppressed, and that suppression comes first and unconditionally. This
   * is the case that tells the two orderings apart: check the selection
   * first and the browser menu opens over the lot on every right click made
   * with nothing selected, which is now the COMMON case rather than an edge
   * one.
   */
  it('suppresses the browser menu even when it opens no flyout', () => {
    const menu = recordingMenu();
    const event = rightClick();

    handleRightClick(target(null), menu, event, bodyOf([7, 3]), 0, 0);

    expect(event.prevented).toHaveBeenCalled();
    expect(menu.opened).toBeNull();
  });

  /**
   * A right click that resolves to no menu must CLOSE one already open, not
   * merely decline to open another. Otherwise deselecting and right-clicking
   * leaves a live menu over the lot naming an object the player has moved
   * on from.
   */
  it('closes an open flyout when the click resolves to no menu', () => {
    const menu = recordingMenu();
    handleRightClick(target(null), menu, rightClick(), bodyOf([7, 3]), 0, 0);
    expect(menu.calls).toEqual(['close']);
  });
});

/**
 * What a picked row sends. The rows and the closing are `ObjectMenu`'s;
 * this is only the command half.
 */
describe('dispatchMenuAction', () => {
  /**
   * A row's `use` is a replace, exactly as a plain left click is, and the
   * cancel comes first for the same reason. `toEqual` on the array because
   * the order is the claim.
   */
  it('sends cancel then use for an interaction row', () => {
    const sink = recordingSink(6);
    dispatchMenuAction(sink, { kind: 'use', object: 9, interaction: 0 });
    expect(sink.calls).toEqual(['cancel 6', 'use 6 9 0']);
    expect(sink.queue).toEqual([[9, 0]]);
  });

  /**
   * **The row's own index reaches the command, and this is the assertion
   * the whole flyout exists for.** Row 0 and row 2 differ in nothing else:
   * same object, same sim, same replace pair. A dispatcher that sent 0 for
   * every row would pass the test above and fail only here, and it would
   * also look completely correct in the shipped game, where every object
   * offers exactly one interaction and row 0 is the only row.
   *
   * 2 rather than 1, so `interaction - 1` and a boolean coercion are
   * visible alongside a substituted 0.
   */
  it('sends the row interaction index rather than the first one', () => {
    const sink = recordingSink(6);
    dispatchMenuAction(sink, { kind: 'use', object: 9, interaction: 2 });
    expect(sink.calls).toEqual(['cancel 6', 'use 6 9 2']);
    expect(sink.queue).toEqual([[9, 2]]);
  });

  /**
   * A social row is the same replace pair as `use`: cancel first, then
   * the talk, so an ordered chat supersedes the queue rather than
   * joining it. The index is 1 rather than 0, so a dispatcher that
   * substituted the first social verb is visible here and nowhere in
   * the shipped game, whose vocabulary has one entry ([L34]).
   */
  it('sends cancel then talk for a social row, carrying the row index', () => {
    const sink = recordingSink(6);
    dispatchMenuAction(sink, { kind: 'talk', target: 8, interaction: 1 });
    expect(sink.calls).toEqual(['cancel 6', 'talk 6 8 1']);
    expect(sink.queue).toEqual([[8, 1]]);
  });

  it('appends a menu action without cancelling while queue mode is active', () => {
    const sink = recordingSink(6);
    dispatchMenuAction(
      sink,
      { kind: 'use', object: 9, interaction: 2 },
      false,
    );
    expect(sink.calls).toEqual(['use 6 9 2']);
  });

  it('still replaces the queue for a social action while queue mode is active', () => {
    const sink = recordingSink(6);
    dispatchMenuAction(
      sink,
      { kind: 'talk', target: 8, interaction: 1 },
      false,
    );
    expect(sink.calls).toEqual(['cancel 6', 'talk 6 8 1']);
  });

  it('sends the cancel alone for the Never mind row', () => {
    const sink = recordingSink(6);
    dispatchMenuAction(sink, NEVER_MIND.action);
    expect(sink.calls).toEqual(['cancel 6']);
  });

  /**
   * **The selection is read when the row is picked, not when the menu
   * opened**, so a menu left open across a deselection sends nothing rather
   * than naming a sim that is no longer chosen. The selected case is
   * asserted above, so this cannot pass on a dispatcher that never sends
   * anything.
   */
  it('sends nothing when the selection has gone since the menu opened', () => {
    const sink = recordingSink(null);
    dispatchMenuAction(sink, { kind: 'use', object: 9, interaction: 0 });
    dispatchMenuAction(sink, { kind: 'talk', target: 8, interaction: 0 });
    dispatchMenuAction(sink, NEVER_MIND.action);
    expect(sink.calls).toEqual([]);
  });

  /** Sim zero is a real selection; a falsy check would refuse to command it. */
  it('commands sim zero, which a falsy check would refuse', () => {
    const sink = recordingSink(0);
    dispatchMenuAction(sink, NEVER_MIND.action);
    expect(sink.calls).toEqual(['cancel 0']);
  });
});
