import { describe, expect, it, vi } from 'vitest';
import {
  NEVER_MIND,
  ObjectMenu,
  menuEntries,
  type MenuAction,
  type MenuEntry,
  type MenuSurface,
} from '../src/ui/object-menu.js';

/**
 * A `MenuSurface` that records what it was shown and keeps the pick
 * callback so a test can fire a row the way a click would.
 *
 * `createMenuSurface` itself is the untested wiring, exactly as
 * `buildNeedBars` and `buildTimeControls` are - there is no jsdom here and
 * the project's convention is structural fakes rather than a browser
 * environment. Everything with a decision in it is above that line.
 */
function recordingSurface(): MenuSurface & {
  readonly calls: string[];
  shown: readonly MenuEntry[] | null;
  at: readonly [number, number] | null;
  /** Fires row `index` the way a click on it would. */
  pick(index: number): void;
} {
  let onPick: ((index: number) => void) | null = null;
  const surface = {
    calls: [] as string[],
    shown: null as readonly MenuEntry[] | null,
    at: null as readonly [number, number] | null,
    show(
      entries: readonly MenuEntry[],
      clientX: number,
      clientY: number,
      pick: (index: number) => void,
    ) {
      surface.calls.push(`show ${entries.length} at ${clientX},${clientY}`);
      surface.shown = entries;
      surface.at = [clientX, clientY];
      onPick = pick;
    },
    hide() {
      surface.calls.push('hide');
      surface.shown = null;
    },
    pick(index: number) {
      if (onPick === null) throw new Error('nothing has been shown yet');
      onPick(index);
    },
  };
  return surface;
}

/** A menu, its surface, and the actions it reported, wired together. */
function menu() {
  const surface = recordingSurface();
  const actions: MenuAction[] = [];
  return {
    surface,
    actions,
    menu: new ObjectMenu(surface, (action) => actions.push(action)),
  };
}

describe('menuEntries', () => {
  /**
   * **The list is the object's real interactions, one row each, in order.**
   *
   * THREE labels, because one cannot tell "a row per interaction" from a
   * hardcoded single entry and two cannot tell "in order" from "reversed".
   * The interaction index on each row is asserted rather than the label
   * alone, since the index is what `Intent::interaction` will be and a row
   * with the right words and the wrong number is the failure that reads as
   * correct.
   */
  it('builds one row per interaction, carrying its index, then the cancel', () => {
    expect(
      menuEntries(['Eat standing up', 'Sink into it', 'Sleep it off'], 9),
    ).toEqual([
      { label: 'Eat standing up', action: { kind: 'use', object: 9, interaction: 0 } },
      { label: 'Sink into it', action: { kind: 'use', object: 9, interaction: 1 } },
      { label: 'Sleep it off', action: { kind: 'use', object: 9, interaction: 2 } },
      NEVER_MIND,
    ]);
  });

  /**
   * Every row names the object that was right-clicked, not a default and
   * not the row's own index. Entity 0 is a real object and `0` is falsy, so
   * this is also where a `object || something` would show.
   */
  it('names the right-clicked object on every row, including object zero', () => {
    for (const object of [0, 7]) {
      const rows = menuEntries(['Read something improving', 'Dust it'], object);
      expect(
        rows.slice(0, 2).map((row) => row.action),
        `object ${object}`,
      ).toEqual([
        { kind: 'use', object, interaction: 0 },
        { kind: 'use', object, interaction: 1 },
      ]);
    }
  });

  /**
   * An object offering nothing still gets the cancel, so "right-clicked a
   * rug" and "right-clicked the floor" behave alike rather than one of them
   * producing an empty box.
   */
  it('still offers the cancel for an object with no interactions', () => {
    expect(menuEntries([], 4)).toEqual([NEVER_MIND]);
  });

  /**
   * The cancel is LAST. It is the one row that is not about this object, and
   * a cancel sitting at the top is a row the player reaches for by muscle
   * memory when they meant the first interaction.
   */
  it('puts the cancel after the interactions rather than before them', () => {
    const rows = menuEntries(['Watch the news'], 2);
    expect(rows[rows.length - 1]).toEqual(NEVER_MIND);
  });
});

describe('ObjectMenu', () => {
  const ROWS = menuEntries(['Eat standing up', 'Sink into it'], 9);

  it('shows the rows it is opened with, at the pointer', () => {
    const { menu: m, surface } = menu();
    m.open(ROWS, 310, 47);

    expect(m.isShowing()).toBe(true);
    expect(surface.shown).toEqual(ROWS);
    expect(
      surface.at,
      'the menu must open where the pointer was, or a right click in the corner draws a menu in the middle of the lot',
    ).toEqual([310, 47]);
  });

  /**
   * **Escape closes it, and no other key does.**
   *
   * Both halves, because the handler is wired to the DOCUMENT: one that
   * closed on any key would dismiss the menu the moment the player tabbed
   * to the speed controls, and one that closed on none would leave the menu
   * with no keyboard escape at all. A single-key test cannot see either.
   */
  it('closes on Escape and ignores every other key', () => {
    const { menu: m, surface } = menu();

    m.open(ROWS, 0, 0);
    for (const key of ['a', 'Enter', 'Tab', 'esc', 'Shift']) {
      expect(m.handleKey(key), `'${key}' must not be consumed`).toBe(false);
      expect(m.isShowing(), `'${key}' must not close the menu`).toBe(true);
    }

    expect(m.handleKey('Escape')).toBe(true);
    expect(m.isShowing()).toBe(false);
    expect(surface.calls).toContain('hide');
  });

  /**
   * Escape with nothing open is not consumed, so the key stays available to
   * whatever else on the page might want it. Without this the menu would
   * silently swallow every Escape the game ever grows a use for.
   */
  it('does not consume Escape when nothing is open', () => {
    const { menu: m } = menu();
    expect(m.handleKey('Escape')).toBe(false);
  });

  /**
   * **Click-away closes it; a click ON it does not.**
   *
   * The second half is the load-bearing one and it is why this takes a
   * boolean rather than closing unconditionally: this fires on
   * `pointerdown`, which precedes the row's own `click`, so a version
   * without the guard would tear the row out from under the click picking
   * it and every selection would appear to be ignored.
   */
  it('closes on a pointer-down outside itself but not on one inside', () => {
    const { menu: m } = menu();

    m.open(ROWS, 0, 0);
    m.pointerDown(true);
    expect(
      m.isShowing(),
      'a pointer-down on the menu must not close it, or it closes before the row it is picking can fire',
    ).toBe(true);

    m.pointerDown(false);
    expect(m.isShowing()).toBe(false);
  });

  /**
   * The guard on `close` means a stray pointer-down anywhere on the page
   * does not rewrite the DOM. Asserted because the guard is a mechanism,
   * and an untested one is indistinguishable from no guard.
   */
  it('does not touch the surface when a pointer-down arrives with nothing open', () => {
    const { menu: m, surface } = menu();
    m.pointerDown(false);
    expect(surface.calls).toEqual([]);
  });

  /**
   * **Picking a row reports that row's action and closes.**
   *
   * The SECOND row is picked, not the first, so a menu that reported
   * whichever row it had first - or a constant - is visible. The two rows
   * carry different interaction indices for the same reason.
   */
  it('reports the action of the row that was picked, and closes', () => {
    const { menu: m, surface, actions } = menu();
    m.open(ROWS, 0, 0);

    surface.pick(1);

    expect(actions).toEqual([{ kind: 'use', object: 9, interaction: 1 }]);
    expect(m.isShowing(), 'picking a row must close the menu').toBe(false);
  });

  it('reports the cancel action for the Never mind row', () => {
    const { menu: m, surface, actions } = menu();
    m.open(ROWS, 0, 0);

    surface.pick(ROWS.length - 1);

    expect(actions).toEqual([NEVER_MIND.action]);
  });

  /**
   * A pick that names no row does nothing at all rather than reporting a
   * neighbour or throwing. That is what a click event still in flight when
   * the menu closed looks like, and the rows are cleared on close precisely
   * so it resolves to nothing instead of to whatever was there before.
   */
  it('reports nothing for a pick that arrives after the menu closed', () => {
    const { menu: m, surface, actions } = menu();
    m.open(ROWS, 0, 0);
    m.close();

    expect(() => surface.pick(0)).not.toThrow();
    expect(actions).toEqual([]);
  });

  /**
   * Re-opening replaces the rows rather than adding a second menu, which is
   * what a right click on a second object has to do - and the rows really
   * are the new ones, so a pick afterwards names the new object.
   */
  it('replaces its rows when reopened for another object', () => {
    const { menu: m, surface, actions } = menu();
    const other = menuEntries(['Use the facilities'], 4);

    m.open(ROWS, 0, 0);
    m.open(other, 90, 90);
    expect(surface.shown).toEqual(other);

    surface.pick(0);
    expect(actions).toEqual([{ kind: 'use', object: 4, interaction: 0 }]);
  });

  /**
   * Closing an already-closed menu hides nothing twice. Idempotence matters
   * because three separate events can close it and two of them can arrive
   * for the same dismissal - Escape while the pointer is already down, say.
   */
  it('hides once however many times it is closed', () => {
    const { menu: m, surface } = menu();
    m.open(ROWS, 0, 0);
    m.close();
    m.close();
    expect(surface.calls.filter((call) => call === 'hide')).toHaveLength(1);
  });

  /**
   * The action callback is invoked, rather than the menu reaching for a
   * command sink of its own. Stated as a spy call count so that a menu
   * silently dropping the action is visible as zero rather than as an empty
   * array that could also mean the row had no action.
   */
  it('hands each picked action to its callback exactly once', () => {
    const surface = recordingSurface();
    const onAction = vi.fn();
    const m = new ObjectMenu(surface, onAction);

    m.open(ROWS, 0, 0);
    surface.pick(0);
    m.open(ROWS, 0, 0);
    surface.pick(0);

    expect(onAction).toHaveBeenCalledTimes(2);
  });
});
