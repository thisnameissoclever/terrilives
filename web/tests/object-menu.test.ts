import { describe, expect, it, vi } from 'vitest';
import * as playerOrders from '../src/ui/player-orders.js';
import {
  NOTHING,
  ObjectMenu,
  menuEntries,
  surfaceMenuEntries,
  queueModifierHeld,
  type Menu,
  type MenuAction,
  type MenuSurface,
} from '../src/ui/object-menu.js';

it('names the exact quoted purchase and sale before dispatching the original native quotes', () => {
  const wire = new Uint8Array([1, 0]);
  const buy = { title: 'incoming', price: 14, home: { shelf: 9n, slot: 1 }, nextCopyId: 42, wire };
  const sell = { copy: 7, shelf: 9n, price: 3, wire };
  const source = {
    selectedIndex: () => null,
    entityName: () => 'Bookcase',
    objectModel: () => ({ shelfCapacity: 4, actions: [{ id: 'read', reading: true }] }),
    interactionLabels: () => ['Read book'],
    bookPurchaseQuote: () => ({ quote: buy, refusal: null }),
    bookSaleQuote: () => ({ quote: sell, refusal: null }),
    bookCatalogue: () => [
      { id: 'incoming', title: 'Incoming title', description: '', genre: 'mystery', readingMinutes: 50, price: 14 },
      { id: 'outgoing', title: 'Outgoing title', description: '', genre: 'mystery', readingMinutes: 50, price: 6 },
    ],
    bookCopies: () => [{ id: 7, titleId: 'outgoing', location: { kind: 'inventory' as const }, home: null, borrowerSimId: null }],
  };
  const menu = surfaceMenuEntries(source, 9);
  expect(menu.needsPerson).toBe(true);
  expect(menu.entries[0]).toMatchObject({ label: 'Read book', enabled: false });
  expect(menu.entries[1]).toMatchObject({ label: 'Buy book', secondary: 'Incoming title', price: 14, enabled: true });
  expect(menu.entries[2]).toMatchObject({ label: 'Sell book', secondary: 'Outgoing title', price: 3, enabled: true });
  expect(menu.entries[1].action).toEqual({ kind: 'buy-book', quote: buy });
  expect(menu.entries[2].action).toEqual({ kind: 'sell-book', quote: sell });
  expect(menu.entries[3]).toMatchObject({ label: 'Enter build mode', enabled: true });
});

describe('queueModifierHeld', () => {
  /**
   * The rule the DOM listener applies to every row activation, tested
   * on plain event shapes because the project runs no DOM in tests. Ctrl
   * and Cmd each count alone, per the macOS note in `attachPointerInput`;
   * neither held is a plain pick.
   */
  it('counts Ctrl or Cmd alone, and neither as a plain pick', () => {
    expect(queueModifierHeld({ ctrlKey: true, metaKey: false })).toBe(true);
    expect(queueModifierHeld({ ctrlKey: false, metaKey: true })).toBe(true);
    expect(queueModifierHeld({ ctrlKey: true, metaKey: true })).toBe(true);
    expect(queueModifierHeld({ ctrlKey: false, metaKey: false })).toBe(false);
  });
});


/**
 * A `MenuSurface` that records what it was shown and keeps the pick
 * callback so a test can fire a row the way a click would.
 *
 * The project's tests use structural fakes rather than a browser DOM.
 * This fake checks controller decisions; action-intent.test.ts also
 * exercises the real surface's action attributes and disclosure events.
 */
function recordingSurface(): MenuSurface & {
  readonly calls: string[];
  shown: Menu | null;
  at: readonly [number, number] | null;
  /**
   * Fires row `index` the way a click on it would, with `additive` saying
   * whether Ctrl or Cmd was held.
   */
  pick(index: number, additive?: boolean): void;
} {
  let onPick: ((index: number, additive: boolean) => void) | null = null;
  const surface = {
    calls: [] as string[],
    shown: null as Menu | null,
    at: null as readonly [number, number] | null,
    show(
      shown: Menu,
      clientX: number,
      clientY: number,
      pick: (index: number, additive: boolean) => void,
    ) {
      surface.calls.push(`show ${shown.entries.length} at ${clientX},${clientY}`);
      surface.shown = shown;
      surface.at = [clientX, clientY];
      onPick = pick;
    },
    hide() {
      surface.calls.push('hide');
      surface.shown = null;
    },
    pick(index: number, additive = false) {
      if (onPick === null) throw new Error('nothing has been shown yet');
      onPick(index, additive);
    },
  };
  return surface;
}

/**
 * A menu, its surface, and the actions it reported, wired together.
 * `modifiers` records, per reported action, whether the pick carried the
 * queue modifier.
 */
function menu() {
  const surface = recordingSurface();
  const actions: MenuAction[] = [];
  const modifiers: boolean[] = [];
  return {
    surface,
    actions,
    modifiers,
    menu: new ObjectMenu(surface, (action, additive) => {
      actions.push(action);
      modifiers.push(additive);
    }, () => true, () => true),
  };
}

it('shows Clear orders only for owned queued or active player orders in the actual menu consumer', () => {
  const row = {orderId: '19', label: 'Chat', phase: 'running', role: 'initiator', counterpart: 9, reason: null};
  for (const [rows, available] of [
    [[{...row, phase: 'queued'}], true], [[row], true],
    [[{...row, role: 'incoming'}], false], [[{...row, orderId: null}], false], [[], false],
  ] as const) {
    const surface = recordingSurface(), actions = vi.fn();
    const source = {selectedIndex: () => 7, queuedOrdersOf: () => 0, actionQueueRowsOf: () => [...rows]};
    const controller = new ObjectMenu(surface, actions, () => true,
      () => playerOrders.hasClearablePlayerOrders(source));
    controller.open(menuEntries('Chair', ['Sit'], 12), 30, 50);
    const clear = surface.shown!.entries.findIndex(entry => entry.action.kind === 'cancel');
    expect(clear >= 0).toBe(available);
    if (available) {
      expect(surface.shown!.entries[clear].label).toBe('Clear orders');
      surface.pick(clear);
      expect(actions).toHaveBeenCalledExactlyOnceWith({kind: 'cancel'}, false);
    } else {
      controller.handleKey('Escape');
      expect(actions).not.toHaveBeenCalled();
    }
  }
});

it('removes an expired Clear orders action without turning dismissal into cancellation', () => {
  let available = true;
  const surface = recordingSurface(), actions = vi.fn();
  const controller = new ObjectMenu(surface, actions, () => true, () => available);
  controller.open(menuEntries('Chair', ['Sit'], 12), 30, 50);
  available = false; controller.refresh();
  expect(surface.shown!.entries.map(entry => entry.label)).toEqual(['Sit']);
  controller.pointerDown(false);
  expect(actions).not.toHaveBeenCalled();
});

it('rejects a Clear orders click whose ownership expired before the next refresh', () => {
  let available = true;
  const surface = recordingSurface(), actions = vi.fn();
  const controller = new ObjectMenu(surface, actions, () => true, () => available);
  controller.open(menuEntries('Chair', ['Sit'], 12), 30, 50);
  available = false;
  surface.pick(1);
  expect(actions).not.toHaveBeenCalled();
});

it('bounds the ownership projection instead of materializing a large waiting queue', () => {
  const rows = vi.fn(() => []);
  const source = {selectedIndex: () => 7, queuedOrdersOf: () => 200000, actionQueueRowsOf: rows};
  expect(playerOrders.hasClearablePlayerOrders(source)).toBe(true);
  expect(rows).not.toHaveBeenCalled();
});

it('uses the real WASM ownership rows for queued, active, incoming and autonomous menu states', async () => {
  const {readFileSync} = await import('node:fs');
  const {default: init, SimHandle} = await import('../src/wasm/terri_wasm.js');
  const {SimBridge} = await import('../src/bridge.js');
  const {memory} = await init({module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm')});
  const handle = SimHandle.from_lot(), bridge = new SimBridge(handle, memory);
  try {
    const ids = Array.from(bridge.ids()), kinds = Array.from(bridge.kinds());
    const actor = ids.find((entity, index) => kinds[index] === 0 && bridge.simName(entity) === 'Casey')!;
    const recipient = ids.find((entity, index) => kinds[index] === 0 && bridge.simName(entity) === 'Tim')!;
    const bed = ids.find(entity => bridge.objectModel(entity)?.id === 'bed')!;
    expect(actor).toBeDefined(); expect(recipient).toBeDefined(); expect(bed).toBeDefined();
    const surface = recordingSurface();
    const controller = new ObjectMenu(surface, action => {
      if (action.kind === 'cancel') bridge.cancelIntents(bridge.selectedIndex()!);
    }, () => true, () => playerOrders.hasClearablePlayerOrders(bridge));
    const displayed = () => {
      controller.open(menuEntries('Bed', ['Sleep'], bed), 30, 50);
      return surface.shown!.entries.some(entry => entry.action.kind === 'cancel');
    };
    bridge.select(actor); bridge.flushCommands();
    const saved = bridge.saveBytes();
    expect(displayed()).toBe(false);
    expect(bridge.saveBytes()).toEqual(saved);
    expect(bridge.useObject(actor, bed, 0)).toBe(true); bridge.flushCommands();
    expect(bridge.actionQueueRowsOf(actor).some(row => row.orderId !== null && row.phase === 'queued')).toBe(true);
    expect(displayed()).toBe(true);
    for (let tick = 0; tick < 3000 && !bridge.actionQueueRowsOf(actor).some(row => row.orderId !== null && row.phase !== 'queued'); tick++) bridge.tick();
    expect(bridge.actionQueueRowsOf(actor).some(row => row.orderId !== null && row.role === 'initiator' && row.phase !== 'queued')).toBe(true);
    expect(displayed()).toBe(true);
    surface.pick(surface.shown!.entries.findIndex(entry => entry.action.kind === 'cancel'));
    bridge.flushCommands();
    expect(playerOrders.hasClearablePlayerOrders(bridge)).toBe(false);
    expect(bridge.talkTo(actor, recipient, 0)).toBe(true); bridge.flushCommands();
    bridge.select(recipient); bridge.flushCommands();
    expect(bridge.actionQueueRowsOf(recipient).some(row => row.role === 'incoming' && row.orderId !== null)).toBe(true);
    expect(displayed()).toBe(false);
    bridge.cancelIntents(actor); bridge.flushCommands();
    for (let tick = 0; tick < 300 && !bridge.actionQueueRowsOf(recipient, 1)[0]?.label; tick++) bridge.tick();
    expect(bridge.actionQueueRowsOf(recipient, 1)[0]).toMatchObject({orderId: null, role: 'initiator'});
    expect(bridge.actionQueueRowsOf(recipient, 1)[0].label).not.toBe('');
    expect(displayed()).toBe(false);
  } finally {handle.free();}
});

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
      menuEntries('Bookshelf', ['Eat standing up', 'Sink into it', 'Sleep it off'], 9)
        .entries,
    ).toEqual([
      { label: 'Eat standing up', action: { kind: 'use', object: 9, interaction: 0 } },
      { label: 'Sink into it', action: { kind: 'use', object: 9, interaction: 1 } },
      { label: 'Sleep it off', action: { kind: 'use', object: 9, interaction: 2 } },
      NOTHING,
    ]);
  });

  /**
   * Every row names the object that was right-clicked, not a default and
   * not the row's own index. Entity 0 is a real object and `0` is falsy, so
   * this is also where a `object || something` would show.
   */
  it('names the right-clicked object on every row, including object zero', () => {
    for (const object of [0, 7]) {
      const rows = menuEntries('Bookshelf', ['Read something improving', 'Dust it'], object)
        .entries;
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
    expect(menuEntries('Bookshelf', [], 4).entries).toEqual([NOTHING]);
    // And it still says what was clicked, which is the whole point of the
    // heading: an object with nothing to offer is exactly the case where a
    // player is asking "what IS that?".
    expect(menuEntries('Rug', [], 4).title).toBe('Rug');
  });

  /**
   * The cancel is LAST. It is the one row that is not about this object, and
   * a cancel sitting at the top is a row the player reaches for by muscle
   * memory when they meant the first interaction.
   */
  it('puts the cancel after the interactions rather than before them', () => {
    const rows = menuEntries('Bookshelf', ['Watch the news'], 2).entries;
    expect(rows[rows.length - 1]).toEqual(NOTHING);
    // And it is the only row wearing a rule, because it is the only row
    // that is not about the object named in the heading.
    expect(rows.filter((row) => row.divider === true)).toEqual([NOTHING]);
  });
});

describe('ObjectMenu', () => {
  const ROWS = menuEntries('Bookshelf', ['Eat standing up', 'Sink into it'], 9);

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

  /**
   * Ctrl or Cmd held on a row means "queue it", the same as on a canvas
   * click. The menu passes the surface's observation through untouched;
   * without this a Chat picked five times with Ctrl held was five front
   * placements, each replacing the last ([I-plain-order-goes-first]).
   */
  it('passes the queue modifier through with the picked action', () => {
    const { menu: m, surface, actions, modifiers } = menu();
    m.open(ROWS, 0, 0);
    surface.pick(1, true);
    m.open(ROWS, 0, 0);
    surface.pick(1);

    expect(actions).toEqual([
      { kind: 'use', object: 9, interaction: 1 },
      { kind: 'use', object: 9, interaction: 1 },
    ]);
    expect(modifiers).toEqual([true, false]);
  });

  it('reports the cancel action for the Clear orders row', () => {
    const { menu: m, surface, actions } = menu();
    m.open(ROWS, 0, 0);

    surface.pick(ROWS.entries.length - 1);

    expect(actions).toEqual([NOTHING.action]);
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
    const other = menuEntries('Bookshelf', ['Use the facilities'], 4);

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

it('disables actor rows through the mode gate while keeping Build selectable', () => {
  const surface = recordingSurface(), onAction = vi.fn();
  const menu = new ObjectMenu(surface, onAction, action => action.kind === 'build');
  menu.open({ title: 'Chair', entries: [
    {label: 'Sit', action: {kind: 'use', object: 9, interaction: 0}},
    {label: 'Enter build mode', action: {kind: 'build', object: 9}},
  ] }, 0, 0);
  expect(surface.shown?.entries[0].enabled).toBe(false);
  surface.pick(0); expect(onAction).not.toHaveBeenCalled(); expect(menu.isShowing()).toBe(true);
  surface.pick(1); expect(onAction).toHaveBeenCalledWith({kind: 'build', object: 9}, false);
});
