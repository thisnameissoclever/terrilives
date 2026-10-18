// Footer Confirm and Cancel keep paused Build open. Explicit exit asks first
// while changes are not confirmed.
// See docs/specs/2026-10-13-build-confirmation.md.

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.js';
import { BuildExit, STRAY_CLICK_MS, buildCommandsIdle, confirmRefusal, hasUnconfirmedChanges,
  type BuildDraftSources } from '../src/ui/build-exit.js';
import { BuildSession } from '../src/ui/build-session.js';
import type { BuildReview } from '../src/rooms/codec.js';
import { RoomReviewController } from '../src/ui/room-review.js';
import { clearBuildSelection, routeBuildKey } from '../src/ui/build-tools.js';
import { FurnitureBuilder } from '../src/ui/builder.js';
import { BuyTool } from '../src/ui/buy-tool.js';
import { OverlayPauseController } from '../src/ui/overlay-pause.js';
import { contextModel, type ContextTools } from '../src/ui/placement-actions.js';

const INDEX_HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const MAIN_TS = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

let memory: WebAssembly.Memory;
beforeAll(async () => {
  memory = (await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') })).memory;
});

interface FakeClick {
  readonly type: 'click';
  readonly target: FakeElement;
  readonly detail: number;
  preventDefault(): void;
  stopPropagation(): void;
}

interface FakeKey {
  readonly type: 'keydown';
  readonly target: FakeElement;
  readonly key: string;
  readonly repeat: boolean;
  defaultPrevented: boolean;
  preventDefault(): void;
}

class FakeDocument {
  activeElement: FakeElement | null = null;
  readonly body = new FakeElement(this);
  readonly nodes = new Map<string, FakeElement>();
  private readonly capturingClicks: ((event: FakeClick) => void)[] = [];
  private readonly keydowns: ((event: FakeKey) => void)[] = [];
  querySelector(selector: string) { return this.nodes.get(selector) ?? null; }
  addEventListener(type: string, listener: (event: never) => void, capture?: boolean) {
    if (type === 'click' && capture === true) this.capturingClicks.push(listener as (event: FakeClick) => void);
    else if (type === 'keydown' && capture !== true) this.keydowns.push(listener as (event: FakeKey) => void);
    else throw new Error(`Unexpected document listener: ${type}`);
  }
  /** How the latest click went: whether it reached its target's listeners, and whether it was cancelled. */
  lastClick = { reached: false, cancelled: false };
  /**
   * A click on `target` with the browser's click count `detail`, 0 for a
   * keyboard activation: the document's capturing listeners run first, then
   * the target's own unless one stopped it. As in a browser, the target's
   * default action, such as a form button closing its dialog, then runs
   * unless the click was cancelled, whether or not propagation stopped.
   * True when the click reached the target's listeners.
   */
  click(target: FakeElement, detail = 1): boolean {
    let stopped = false;
    let cancelled = false;
    const event: FakeClick = { type: 'click', target, detail,
      preventDefault() { cancelled = true; }, stopPropagation() { stopped = true; } };
    for (const listener of this.capturingClicks) listener(event);
    if (!stopped) target.click();
    if (!cancelled) target.defaultAction?.();
    this.lastClick = { reached: !stopped, cancelled };
    return !stopped;
  }
  /**
   * A keydown on `target` that bubbles to the document. `atTarget` stands in
   * for the target's own listener, which runs first. True when a listener
   * cancelled it.
   */
  keydown(target: FakeElement, key: string, repeat = false, atTarget?: (event: FakeKey) => void): boolean {
    const event: FakeKey = { type: 'keydown', target, key, repeat, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; } };
    atTarget?.(event);
    for (const listener of this.keydowns) listener(event);
    return event.defaultPrevented;
  }
}

/** Only what the controller and the test touch; the listeners are the real ones. */
class FakeElement {
  disabled = false;
  isConnected = true;
  /** The dialog this element sits in, if any. */
  container: FakeDialog | null = null;
  /** Selectors an ancestor of this element matches, such as another 'dialog' or an 'input'. */
  readonly within = new Set<string>();
  /** What the browser does with an uncancelled click on this element, if anything. */
  defaultAction: (() => void) | null = null;
  private readonly listeners = new Map<string, ((event?: unknown) => void)[]>();
  constructor(protected readonly doc: FakeDocument) {}
  addEventListener(type: string, listener: (event?: unknown) => void) {
    this.listeners.set(type, [...this.listeners.get(type) ?? [], listener]);
  }
  fire(type: string, event?: unknown) { for (const listener of this.listeners.get(type) ?? []) listener(event); }
  click() { if (!this.disabled) this.fire('click'); }
  focus() { this.doc.activeElement = this; }
  closest(selector: string): FakeElement | null {
    if (selector === 'dialog[open]') return this.container?.open ? this.container : null;
    return selector.split(',').some(part => this.within.has(part.trim())) ? this : null;
  }
}

/** A modal dialog whose form buttons close it with their value. */
class FakeDialog extends FakeElement {
  open = false;
  returnValue = 'stale';
  showModal() {
    if (this.open) throw new Error('The dialog is already open.');
    this.open = true;
  }
  /** A button's value; Escape closes the dialog without one. */
  close(value?: string) {
    if (!this.open) return;
    this.open = false;
    if (value !== undefined) this.returnValue = value;
    this.fire('close');
  }
}

const REFUSED = 'Move the furniture somewhere it fits, or choose Cancel beside it, before confirming.';
const ROLLBACK_FAILED = 'Changes could not be cancelled. Build mode remains open.';

/** Build mode wired as main.ts wires it, for the Furniture and Buy tools. */
function fixture(handle = SimHandle.from_lot(), review?: (review: BuildReview) => Promise<boolean>) {
  const sim = new SimBridge(handle, memory);
  const doc = new FakeDocument();
  const element = (id: string, made: FakeElement = new FakeElement(doc)) => {
    doc.nodes.set(`#${id}`, made);
    return made;
  };
  const confirmButton = element('build-batch-confirm');
  const cancelButton = element('build-batch-cancel');
  const dialog = element('build-exit-dialog', new FakeDialog(doc)) as FakeDialog;
  const keep = element('build-exit-keep');
  keep.container = dialog;
  const exitButton = new FakeElement(doc);
  const stage = new FakeElement(doc);
  let gameClicks = 0;
  stage.addEventListener('click', () => { gameClicks += 1; });
  const status = { textContent: '' };
  const view = { focus: vi.fn() };
  const beforeAsk = vi.fn();
  const clock = { time: 1_000 };
  /** How long each confirm and discard takes, as on a slow device. */
  const work = { ms: 0 };
  /** False while a menu or another dialog would take Escape first. */
  const page = { escapeAllowed: true };
  const buy = new BuyTool(sim, handle.lot_width(), handle.lot_height(), { changed() {} });
  let builder: FurnitureBuilder;
  // The page's own pending check, given the tools this fixture has.
  const draft = (): BuildDraftSources => ({ session, furniture: builder, tools: [buy],
    pendingBookCommands: () => sim.pendingBookCommands() });
  const session: BuildSession = new BuildSession(sim, {
    review,
    // As main.ts: Confirm includes a furniture move not yet placed.
    prepare: () => {
      if (!builder.hasPlacementChange) return true;
      if (!builder.confirm()) return false;
      sim.flushCommands();
      const accepted = sim.lastPlacementResult()?.reason === null;
      builder.afterCommands();
      return accepted;
    },
    settled: () => { buy.afterCommands(); builder.afterCommands(); return buildCommandsIdle(draft()); },
    restored: () => { builder.resetAfterLoad(); buy.resetAfterLoad(handle.lot_width(), handle.lot_height()); },
  });
  const exit = new BuildExit(doc as unknown as Document, {
    hasUnconfirmedChanges: () => hasUnconfirmedChanges(draft()),
    confirm: () => {
      clock.time += work.ms;
      const confirmed = session.confirm();
      status.textContent = confirmed ? 'Changes confirmed.' : confirmRefusal(builder.hasPlacementChange);
      if (confirmed) { builder.cancel(); buy.cancel(); }
      return confirmed;
    },
    cancel: () => { const cancelled = session.cancel(); if (!cancelled) status.textContent = ROLLBACK_FAILED; return cancelled; },
    discard: () => {
      clock.time += work.ms;
      const cancelled = session.end();
      if (!cancelled) status.textContent = ROLLBACK_FAILED;
      return cancelled;
    },
    leave: () => { builder.exit(); return !builder.active; },
    focusView: () => view.focus(),
    // As main.ts: Escape with the dialog closed goes through the tools first.
    escapeBuild: () => { routeBuildKey('Escape', [buy], builder); },
    escapeAllowed: () => builder.active && page.escapeAllowed,
    beforeAsk,
  }, () => clock.time);
  builder = new FurnitureBuilder(sim, new OverlayPauseController({ setSpeed() {} }, () => {}, 1), {
    beforeEnter: () => session.begin(),
    beforeExit: () => exit.gate(),
    enter() {}, exit() {}, changed() {},
  });
  exitButton.addEventListener('click', () => builder.exit());
  /** Enters Build mode and places furniture 15 elsewhere, unconfirmed. */
  const enterWithMove = () => {
    builder.enter();
    builder.select(15); builder.moveTo(7, 0);
    expect(builder.confirm()).toBe(true);
    sim.flushCommands(); builder.afterCommands();
    expect(sim.lastPlacementResult()?.reason).toBeNull();
  };
  /** Clicks Exit build, as the panel's heading button does. */
  const clickExit = () => { exitButton.focus(); exitButton.click(); };
  return { handle, sim, doc, session, builder, buy, exit, dialog, keep, exitButton, confirmButton,
    cancelButton, stage, status, view, beforeAsk, clock, work, page, enterWithMove, clickExit,
    get gameClicks() { return gameClicks; } };
}

describe('the footer', () => {
  it('Confirm applies the pending changes and keeps Build mode open', () => {
    const f = fixture();
    try {
      const before = f.sim.saveBytes();
      f.enterWithMove();
      const moved = f.sim.saveBytes();
      expect(moved).toEqual(before);
      f.confirmButton.click();
      expect(f.builder.active).toBe(true);
      expect(f.session.active).toBe(true);
      expect(f.dialog.open).toBe(false);
      expect(f.sim.saveBytes()).not.toEqual(moved);
      expect(f.status.textContent).toBe('Changes confirmed.');
    } finally { f.handle.free(); }
  });

  it('Cancel discards the pending changes and keeps Build mode open', () => {
    const f = fixture();
    try {
      const before = f.sim.saveBytes();
      f.enterWithMove();
      f.cancelButton.click();
      expect(f.builder.active).toBe(true);
      expect(f.session.active).toBe(true);
      expect(f.dialog.open).toBe(false);
      expect(f.sim.saveBytes()).toEqual(before);
    } finally { f.handle.free(); }
  });

  it('keeps Build open for empty footer batches', () => {
    const f = fixture();
    try {
      f.builder.enter();
      f.confirmButton.click();
      expect(f.builder.active).toBe(true);
      f.builder.enter();
      f.cancelButton.click();
      expect(f.builder.active).toBe(true);
      expect(f.dialog.open).toBe(false);
    } finally { f.handle.free(); }
  });

  it('keeps Build mode, the changes and the reason when Confirm is refused', () => {
    const f = fixture();
    try {
      f.enterWithMove();
      const moved = f.sim.saveBytes();
      // A second move to a place furniture cannot go: Confirm must not drop it.
      f.builder.select(22); f.builder.moveTo(15, 2);
      expect(f.builder.preview?.valid).toBe(false);
      f.confirmButton.click();
      expect(f.builder.active).toBe(true);
      expect(f.session.active).toBe(true);
      expect(f.status.textContent).toBe(REFUSED);
      expect(f.sim.saveBytes()).toEqual(moved);
      expect(f.session.saveBytes()).toEqual(moved);
    } finally { f.handle.free(); }
  });

  it('keeps Build mode with its message when the changes cannot be discarded', () => {
    const f = fixture();
    try {
      f.enterWithMove();
      vi.spyOn(f.sim, 'cancelBuild').mockReturnValue({ ok: false, error: { code: 10, detail: 7n } });
      f.cancelButton.click();
      expect(f.builder.active).toBe(true);
      expect(f.session.active).toBe(true);
      expect(f.status.textContent).toBe(ROLLBACK_FAILED);
    } finally { f.handle.free(); }
  });
});

it.each(['adopt', 'back', 'dismiss', 'load'] as const)('defers explicit exit until exact native review adoption: %s', async action => {
  let controller: RoomReviewController;
  let finish: ((adopted: boolean) => void) | null = null;
  const f = fixture(new SimHandle(10, 8), review => new Promise<boolean>(resolve => { finish = resolve; controller.open(review); }));
  controller = new RoomReviewController(f.sim, {
    completed: adopted => { if (!adopted) f.exit.clearExitIntent(); finish?.(adopted); },
    refused: () => f.exit.clearExitIntent(),
  });
  let operation: boolean | Promise<boolean> = false;
  try {
    f.sim.buildRoom([1, 1, 7, 5], { axis: 0, x: 8, y: 3 }); f.sim.flushCommands();
    const saved = f.sim.saveBytes(); f.builder.enter();
    for (let y = 1; y <= 5; y++) { f.sim.setWallEdge(0, 4, y, 1); f.sim.flushCommands(); }
    operation = f.exit.confirmAndLeave();
    expect(controller.active).toBe(true); expect(f.builder.active).toBe(true); expect(f.session.active).toBe(true);
    const token = controller.review!.token;
    f.confirmButton.click(); expect(controller.review!.token).toEqual(token);
    if (action === 'back') controller.back();
    else if (action === 'load') {
      expect(f.session.loadBytes(saved)).toBe(true); f.exit.dismiss(); controller.reset();
    } else {
      if (action === 'dismiss') f.exit.dismiss();
      expect(await controller.confirm()).toBe(true);
    }
    expect(await operation).toBe(action === 'adopt');
    expect(f.builder.active).toBe(action !== 'adopt'); expect(f.session.active).toBe(action !== 'adopt');
    expect(f.dialog.open).toBe(false);
  } finally { f.exit.dismiss(); controller.reset(); await operation; f.handle.free(); }
});

describe('leaving another way while changes are pending', () => {
  it('opens the dialog instead of leaving, with focus on Keep building', () => {
    const f = fixture();
    try {
      f.enterWithMove();
      const moved = f.sim.saveBytes();
      f.clickExit();
      expect(f.dialog.open).toBe(true);
      expect(f.dialog.returnValue).toBe('');
      expect(f.builder.active).toBe(true);
      expect(f.session.active).toBe(true);
      expect(f.sim.saveBytes()).toEqual(moved);
      expect(f.doc.activeElement).toBe(f.keep);
      expect(f.beforeAsk).toHaveBeenCalledOnce();
      // Asking again while the dialog is open changes nothing.
      f.clickExit();
      expect(f.dialog.open).toBe(true);
      expect(f.builder.active).toBe(true);
    } finally { f.handle.free(); }
  });

  it('Confirm changes applies them and leaves', () => {
    const f = fixture();
    try {
      f.enterWithMove();
      const moved = f.sim.saveBytes();
      f.clickExit();
      f.dialog.close('confirm');
      expect(f.builder.active).toBe(false);
      expect(f.session.active).toBe(false);
      expect(f.sim.saveBytes()).not.toEqual(moved);
    } finally { f.handle.free(); }
  });

  it('Discard changes discards them and leaves', () => {
    const f = fixture();
    try {
      const before = f.sim.saveBytes();
      f.enterWithMove();
      f.clickExit();
      expect([f.dialog.open, f.builder.active]).toEqual([true, true]);
      f.dialog.close('discard');
      expect(f.builder.active).toBe(false);
      expect(f.session.active).toBe(false);
      expect(f.sim.saveBytes()).toEqual(before);
    } finally { f.handle.free(); }
  });

  it('Keep building returns to building with the changes and focus on the control that asked', () => {
    const f = fixture();
    try {
      f.enterWithMove();
      const moved = f.sim.saveBytes();
      f.clickExit();
      f.dialog.close('keep');
      expect(f.builder.active).toBe(true);
      expect(f.session.active).toBe(true);
      expect(f.sim.saveBytes()).toEqual(moved);
      expect(f.doc.activeElement).toBe(f.exitButton);
      // The batch is still pending: the next attempt asks again.
      f.clickExit();
      expect(f.dialog.open).toBe(true);
    } finally { f.handle.free(); }
  });

  it('Escape in the dialog keeps building', () => {
    const f = fixture();
    try {
      f.enterWithMove();
      const moved = f.sim.saveBytes();
      f.clickExit();
      f.dialog.close();
      expect(f.builder.active).toBe(true);
      expect(f.sim.saveBytes()).toEqual(moved);
      expect(f.doc.activeElement).toBe(f.exitButton);
      expect(f.view.focus).not.toHaveBeenCalled();
    } finally { f.handle.free(); }
  });

  it('gives the game view focus when the control that asked cannot take it', () => {
    const f = fixture();
    try {
      f.enterWithMove();
      // Some browsers do not focus a clicked button, so the page body holds focus.
      f.doc.body.focus();
      f.exitButton.click();
      f.dialog.close();
      expect(f.view.focus).toHaveBeenCalledOnce();
      f.clickExit();
      f.exitButton.disabled = true;
      f.dialog.close('keep');
      expect(f.view.focus).toHaveBeenCalledTimes(2);
    } finally { f.handle.free(); }
  });

  it('counts a furniture move that is not placed, and keeps Build mode when Confirm is refused', () => {
    const f = fixture();
    try {
      f.builder.enter();
      f.builder.select(15); f.builder.moveTo(15, 2);
      expect(f.builder.preview?.valid).toBe(false);
      expect(f.session.hasChanges()).toBe(false);
      f.clickExit();
      expect(f.dialog.open).toBe(true);
      f.dialog.close('confirm');
      expect(f.builder.active).toBe(true);
      expect(f.status.textContent).toBe(REFUSED);
      expect(f.doc.activeElement).toBe(f.exitButton);
      f.clickExit();
      f.dialog.close('discard');
      expect(f.builder.active).toBe(false);
    } finally { f.handle.free(); }
  });

  it('counts a move still on its way, and settles it before confirming', () => {
    const f = fixture();
    const position = (object: number) => {
      const row = Array.from(f.sim.ids()).indexOf(object);
      return Array.from(f.sim.positions().slice(row * 2, row * 2 + 2));
    };
    try {
      const before = position(15);
      f.builder.enter();
      f.builder.select(15); f.builder.moveTo(7, 0);
      expect(f.builder.confirm()).toBe(true);
      expect(f.builder.pending).toBe(true);
      f.clickExit();
      expect(f.dialog.open).toBe(true);
      f.dialog.close('confirm');
      expect(f.builder.active).toBe(false);
      expect(position(15)).not.toEqual(before);
    } finally { f.handle.free(); }
  });

  it('discards a move still on its way', () => {
    const f = fixture();
    try {
      const before = f.sim.saveBytes();
      f.builder.enter();
      f.builder.select(15); f.builder.moveTo(7, 0);
      expect(f.builder.confirm()).toBe(true);
      f.clickExit();
      expect([f.dialog.open, f.builder.active]).toEqual([true, true]);
      f.dialog.close('discard');
      f.sim.flushCommands();
      expect(f.builder.active).toBe(false);
      expect(f.sim.saveBytes()).toEqual(before);
    } finally { f.handle.free(); }
  });

  it('stays in Build mode with its message when Discard changes cannot discard them', () => {
    const f = fixture();
    try {
      f.enterWithMove();
      f.clickExit();
      vi.spyOn(f.sim, 'endBuild').mockReturnValue({ ok: false, error: { code: 10, detail: 7n } });
      f.dialog.close('discard');
      expect(f.builder.active).toBe(true);
      expect(f.status.textContent).toBe(ROLLBACK_FAILED);
      expect(f.doc.activeElement).toBe(f.exitButton);
    } finally { f.handle.free(); }
  });
});

describe('leaving with nothing pending', () => {
  it('leaves with no dialog, after a selection, a refused move and a confirmed batch', () => {
    const f = fixture();
    try {
      f.builder.enter();
      f.clickExit();
      expect([f.builder.active, f.dialog.open]).toEqual([false, false]);
      // Choosing furniture without moving it changes nothing.
      f.builder.enter(); f.builder.select(15);
      f.clickExit();
      expect([f.builder.active, f.dialog.open]).toEqual([false, false]);
      // A move the game refused changed nothing either.
      f.builder.enter();
      expect(f.sim.placeObject(15, 15, 2, f.sim.objectFacing(15)!)).toBe(true);
      f.sim.flushCommands();
      expect(f.sim.lastPlacementResult()?.reason).not.toBeNull();
      f.clickExit();
      expect([f.builder.active, f.dialog.open]).toEqual([false, false]);
      // After Confirm, the confirmed changes are not pending.
      f.enterWithMove();
      expect(f.session.confirm()).toBe(true);
      f.clickExit();
      expect([f.builder.active, f.dialog.open]).toEqual([false, false]);
      expect(f.beforeAsk).not.toHaveBeenCalled();
    } finally { f.handle.free(); }
  });
});

describe('Escape in Build mode', () => {
  it('clears a selection first, then asks before leaving with changes pending', () => {
    const f = fixture();
    try {
      f.enterWithMove();
      f.builder.select(22);
      // From the game view, as main.ts's canvas listener calls it.
      f.exit.pressEscape(false);
      expect([f.builder.selected, f.builder.active, f.dialog.open]).toEqual([null, true, false]);
      f.exit.pressEscape(false);
      expect([f.builder.active, f.dialog.open]).toEqual([true, true]);
      f.exit.pressEscape(false);
      expect([f.builder.active, f.dialog.open]).toEqual([true, false]);
    } finally { f.handle.free(); }
  });

  it('with focus outside the open dialog, chooses Keep building and leaves the selection alone', () => {
    const f = fixture();
    try {
      f.enterWithMove();
      const moved = f.sim.saveBytes();
      f.builder.select(22);
      f.clickExit();
      expect(f.dialog.open).toBe(true);
      // A click on the backdrop or the dialog's text puts focus on the page body.
      f.doc.body.focus();
      expect(f.doc.keydown(f.doc.body, 'Escape')).toBe(true);
      expect(f.dialog.open).toBe(false);
      expect(f.dialog.returnValue).toBe('keep');
      expect([f.builder.selected, f.builder.active]).toEqual([22, true]);
      expect(f.sim.saveBytes()).toEqual(moved);
    } finally { f.handle.free(); }
  });

  it('inside the open dialog, chooses Keep building too', () => {
    const f = fixture();
    try {
      f.enterWithMove();
      f.clickExit();
      expect(f.doc.keydown(f.keep, 'Escape')).toBe(true);
      expect([f.dialog.open, f.dialog.returnValue, f.builder.active]).toEqual([false, 'keep', true]);
    } finally { f.handle.free(); }
  });

  it('held down, counts once wherever focus is, so the dialog it opens stays open', () => {
    const f = fixture();
    try {
      f.enterWithMove();
      f.doc.body.focus();
      expect(f.doc.keydown(f.doc.body, 'Escape')).toBe(true);
      expect(f.dialog.open).toBe(true);
      // Repeats reach the dialog's button, or the body after a click on the backdrop.
      expect(f.doc.keydown(f.keep, 'Escape', true)).toBe(true);
      expect(f.doc.keydown(f.doc.body, 'Escape', true)).toBe(true);
      expect(f.dialog.open).toBe(true);
      f.exit.pressEscape(true);
      expect(f.dialog.open).toBe(true);
      expect(f.doc.keydown(f.keep, 'Escape')).toBe(true);
      expect(f.dialog.open).toBe(false);
      // With the dialog closed, a repeat from the game view does not reopen it.
      f.exit.pressEscape(true);
      expect(f.dialog.open).toBe(false);
    } finally { f.handle.free(); }
  });

  it('handles one Escape from the game view once', () => {
    const f = fixture();
    try {
      f.enterWithMove();
      f.builder.select(22);
      // As main.ts's canvas listener: it hands Escape over and cancels the key.
      const gameView = (event: FakeKey) => { f.exit.pressEscape(event.repeat); event.preventDefault(); };
      expect(f.doc.keydown(f.stage, 'Escape', false, gameView)).toBe(true);
      expect([f.builder.selected, f.builder.active, f.dialog.open]).toEqual([null, true, false]);
    } finally { f.handle.free(); }
  });

  it('leaves another dialog, a text field, a menu and other keys alone', () => {
    const f = fixture();
    try {
      f.enterWithMove();
      f.builder.select(22);
      // The Land tool's dialog, say: it closes itself on Escape.
      const inOtherDialog = new FakeElement(f.doc);
      inOtherDialog.within.add('dialog');
      expect(f.doc.keydown(inOtherDialog, 'Escape')).toBe(false);
      const field = new FakeElement(f.doc);
      field.within.add('input');
      expect(f.doc.keydown(field, 'Escape')).toBe(false);
      expect(f.doc.keydown(f.doc.body, 'Enter')).toBe(false);
      f.page.escapeAllowed = false;
      expect(f.doc.keydown(f.doc.body, 'Escape')).toBe(false);
      expect([f.builder.selected, f.dialog.open]).toEqual([22, false]);
      f.page.escapeAllowed = true;
      expect(f.doc.keydown(f.doc.body, 'Escape')).toBe(true);
      expect(f.builder.selected).toBeNull();
    } finally { f.handle.free(); }
  });

  it('leaves at once with nothing selected and nothing pending', () => {
    const f = fixture();
    try {
      f.builder.enter();
      expect(f.doc.keydown(f.doc.body, 'Escape')).toBe(true);
      expect([f.builder.active, f.dialog.open]).toEqual([false, false]);
    } finally { f.handle.free(); }
  });
});

describe('the Cancel beside a selection', () => {
  /** The context actions around the furniture, with the page's contextual Cancel. */
  const actions = (f: ReturnType<typeof fixture>) => contextModel({
    furniture: f.builder, buy: f.buy, walls: { active: false }, room: { active: false }, floors: { active: false },
    focusCatalogue() {}, clearSelection: () => clearBuildSelection([f.buy], f.builder),
  } as unknown as ContextTools)?.actions ?? [];

  it('clears only the selection, keeping the other pending changes and Build mode', () => {
    const f = fixture();
    try {
      f.enterWithMove();
      const moved = f.sim.saveBytes();
      f.builder.select(22); f.builder.moveTo(9, 3);
      expect(f.builder.hasPlacementChange).toBe(true);
      const cancel = actions(f).find(action => action.id === 'cancel');
      expect(cancel?.label).toBe('Cancel');
      cancel!.invoke();
      expect(f.builder.selected).toBeNull();
      expect(f.builder.active).toBe(true);
      expect(f.dialog.open).toBe(false);
      expect(f.session.hasChanges()).toBe(true);
      expect(f.sim.saveBytes()).toEqual(moved);
      // The batch is still pending, so leaving still asks.
      f.clickExit();
      expect(f.dialog.open).toBe(true);
    } finally { f.handle.free(); }
  });

  it('clears the tool in use and never leaves Build mode with nothing selected', () => {
    const walls = { active: true, handleKey: vi.fn(() => true) };
    const idle = { active: false, handleKey: vi.fn(() => true) };
    const furniture = { cancel: vi.fn() };
    clearBuildSelection([idle, walls], furniture);
    expect(walls.handleKey).toHaveBeenCalledWith('Escape');
    expect(idle.handleKey).not.toHaveBeenCalled();
    expect(furniture.cancel).not.toHaveBeenCalled();
    const f = fixture();
    try {
      f.builder.enter();
      clearBuildSelection([f.buy], f.builder);
      expect([f.builder.active, f.dialog.open]).toEqual([true, false]);
    } finally { f.handle.free(); }
  });
});

describe('what counts as pending', () => {
  it('counts a purchase on its way, and Discard changes gives the money back', () => {
    const f = fixture();
    try {
      // The shipped household starts short of money: sell something first,
      // before Build mode, so the purchase is the batch's only change.
      const sale = Array.from(f.sim.ids()).map(id => ({ id, ...f.sim.salePreview(id) }))
        .filter(quote => quote.reason === null).sort((a, b) => b.payout - a.payout)[0];
      expect(f.sim.sellObject(sale.id)).toBe(true);
      f.sim.flushCommands();
      expect(f.sim.lastSaleResult()?.reason).toBeNull();
      const before = f.sim.saveBytes();
      const funds = f.sim.funds();
      f.builder.enter(); f.buy.enter();
      const item = f.sim.catalogue().find(entry => entry.price <= funds
        && f.sim.purchasePreview(entry.definition, 17, 14, entry.baseFacing).valid)!;
      expect(item).toBeDefined();
      f.buy.choose(item.definition); f.buy.moveTo(17, 14);
      expect(f.buy.canBuy).toBe(true);
      f.buy.buy();
      expect(f.buy.pending).toBe(true);
      expect(hasUnconfirmedChanges({ session: f.session, furniture: f.builder, tools: [f.buy],
        pendingBookCommands: () => 0 })).toBe(true);
      f.clickExit();
      expect([f.dialog.open, f.builder.active]).toEqual([true, true]);
      f.dialog.close('discard');
      f.sim.flushCommands();
      expect(f.builder.active).toBe(false);
      expect(f.sim.funds()).toBe(funds);
      expect(f.sim.saveBytes()).toEqual(before);
    } finally { f.handle.free(); }
  });

  it('treats any controller value but null or false as a command on its way', () => {
    const sources = (tool: boolean | number | string | null, furniture = false, books = 0) => ({
      furniture: { hasPlacementChange: false, pending: furniture },
      tools: [{ pending: null }, { pending: false }, { pending: tool }],
      pendingBookCommands: () => books,
    });
    expect(buildCommandsIdle(sources(null))).toBe(true);
    expect(buildCommandsIdle(sources(false))).toBe(true);
    // Floors send covering 0 to restore the original floor: still on its way.
    expect(buildCommandsIdle(sources(0))).toBe(false);
    expect(buildCommandsIdle(sources('fit'))).toBe(false);
    expect(buildCommandsIdle(sources(true))).toBe(false);
    expect(buildCommandsIdle(sources(null, true))).toBe(false);
    expect(buildCommandsIdle(sources(null, false, 1))).toBe(false);
    const session = { hasChanges: () => false };
    expect(hasUnconfirmedChanges({ session, ...sources(null) })).toBe(false);
    expect(hasUnconfirmedChanges({ session: { hasChanges: () => true }, ...sources(null) })).toBe(true);
    expect(hasUnconfirmedChanges({ session, ...sources(null),
      furniture: { hasPlacementChange: true, pending: false } })).toBe(true);
  });
});

describe('a double-click that closes the dialog or leaves', () => {
  /** A dialog button, as a target inside the open dialog. */
  const dialogButton = (f: ReturnType<typeof fixture>) => {
    const button = new FakeElement(f.doc);
    button.container = f.dialog;
    return button;
  };

  it('keeps the second click of a dialog button off the game, and lets a separate click through', () => {
    const f = fixture();
    try {
      f.enterWithMove();
      f.clickExit();
      expect(f.doc.click(dialogButton(f), 1)).toBe(true);
      f.dialog.close('discard');
      expect(f.builder.active).toBe(false);
      f.clock.time += 150;
      expect(f.doc.click(f.stage, 2)).toBe(false);
      expect(f.gameClicks).toBe(0);
      // A new click, counted from one again by the browser, is deliberate.
      f.clock.time += 100;
      expect(f.doc.click(f.stage, 1)).toBe(true);
      expect(f.gameClicks).toBe(1);
    } finally { f.handle.free(); }
  });

  it('keeps the second click of the footer Confirm off the game', () => {
    const f = fixture();
    try {
      f.enterWithMove();
      expect(f.doc.click(f.confirmButton, 1)).toBe(true);
      expect(f.builder.active).toBe(true);
      f.clock.time += 100;
      expect(f.doc.click(f.stage, 2)).toBe(false);
      expect(f.gameClicks).toBe(0);
    } finally { f.handle.free(); }
  });

  it('keeps the second click of Exit build off the game when nothing is pending', () => {
    const f = fixture();
    try {
      f.builder.enter();
      f.exitButton.focus();
      expect(f.doc.click(f.exitButton, 1)).toBe(true);
      expect([f.builder.active, f.dialog.open]).toEqual([false, false]);
      f.clock.time += 120;
      expect(f.doc.click(f.stage, 2)).toBe(false);
      expect(f.gameClicks).toBe(0);
    } finally { f.handle.free(); }
  });

  it('arms nothing when the dialog closes from the keyboard', () => {
    const f = fixture();
    try {
      f.enterWithMove();
      f.clickExit();
      // Enter on Keep building: a click with no count, then the close.
      expect(f.doc.click(f.keep, 0)).toBe(true);
      f.dialog.close('keep');
      f.clock.time += 50;
      expect(f.doc.click(f.stage, 1)).toBe(true);
      // Escape with focus anywhere.
      f.clock.time += 2_000;
      f.clickExit();
      f.clock.time += 2_000;
      expect(f.doc.keydown(f.doc.body, 'Escape')).toBe(true);
      expect(f.dialog.open).toBe(false);
      f.clock.time += 50;
      expect(f.doc.click(f.stage, 1)).toBe(true);
      expect(f.doc.click(f.stage, 2)).toBe(true);
      expect(f.gameClicks).toBe(3);
    } finally { f.handle.free(); }
  });

  it('arms nothing from a pointer click that came before the keyboard close', () => {
    const f = fixture();
    try {
      f.enterWithMove();
      f.clickExit();
      // A click on the dialog's text, then Escape over a quarter second later:
      // the click did not close the dialog, so it arms nothing.
      expect(f.doc.click(dialogButton(f), 1)).toBe(true);
      f.clock.time += 600;
      expect(f.doc.keydown(f.doc.body, 'Escape')).toBe(true);
      expect(f.dialog.open).toBe(false);
      f.clock.time += 50;
      expect(f.doc.click(f.stage, 2)).toBe(true);
      expect(f.gameClicks).toBe(1);
    } finally { f.handle.free(); }
  });

  it('lets a fresh double-click through soon after a pointer close, whether Build mode stays or is left', () => {
    const f = fixture();
    try {
      f.enterWithMove();
      f.clickExit();
      expect(f.doc.click(f.keep, 1)).toBe(true);
      f.dialog.close('keep');
      expect(f.builder.active).toBe(true);
      // A new run, counted 1 then 2 by the browser, on Rotate clockwise say.
      f.clock.time += 300;
      expect(f.doc.click(f.stage, 1)).toBe(true);
      f.clock.time += 150;
      expect(f.doc.click(f.stage, 2)).toBe(true);
      expect(f.doc.click(f.confirmButton, 1)).toBe(true);
      expect(f.builder.active).toBe(true);
      // The same after leaving, on zoom or speed.
      f.clock.time += 400;
      expect(f.doc.click(f.stage, 1)).toBe(true);
      f.clock.time += 150;
      expect(f.doc.click(f.stage, 2)).toBe(true);
      expect(f.gameClicks).toBe(4);
    } finally { f.handle.free(); }
  });

  it('arms from the click that caused the leave even when the work outlasts a quarter second', () => {
    const f = fixture();
    try {
      f.work.ms = 400;
      // The footer: a slow confirm, then a slow discard on the way out.
      f.enterWithMove();
      expect(f.doc.click(f.confirmButton, 1)).toBe(true);
      expect(f.builder.active).toBe(true);
      f.clock.time += 100;
      expect(f.doc.click(f.stage, 2)).toBe(false);
      // The dialog: the close arms first, and the slow discard must not clear it.
      f.clock.time += 5_000;
      f.builder.enter(); f.builder.select(22); f.builder.moveTo(9, 3);
      f.clickExit();
      expect(f.doc.click(dialogButton(f), 1)).toBe(true);
      f.dialog.close('discard');
      expect(f.builder.active).toBe(false);
      f.clock.time += 100;
      expect(f.doc.click(f.stage, 2)).toBe(false);
      // Exit build with nothing pending: a slow discard of nothing.
      f.clock.time += 5_000;
      f.builder.enter();
      expect(f.doc.click(f.exitButton, 1)).toBe(true);
      expect(f.builder.active).toBe(false);
      f.clock.time += 100;
      expect(f.doc.click(f.stage, 2)).toBe(false);
      expect(f.gameClicks).toBe(0);
    } finally { f.handle.free(); }
  });

  it('lets through clicks before any close, and a continuation after the time bound', () => {
    const f = fixture();
    try {
      expect(f.doc.click(f.stage, 2)).toBe(true);
      f.enterWithMove();
      expect(f.doc.click(f.confirmButton, 1)).toBe(true);
      f.clock.time += STRAY_CLICK_MS + 1;
      expect(f.doc.click(f.stage, 2)).toBe(true);
      expect(f.gameClicks).toBe(2);
    } finally { f.handle.free(); }
  });
});

describe('a double-tap on Exit build with changes pending', () => {
  /**
   * A dialog button that closes the dialog with its value. In the page it sits
   * in a form whose method is dialog, so the close is the click's default
   * action, which only cancelling the click stops.
   */
  const choice = (f: ReturnType<typeof fixture>, value: string) => {
    const button = new FakeElement(f.doc);
    button.container = f.dialog;
    button.defaultAction = () => f.dialog.close(value);
    return button;
  };

  it('keeps the dialog open when the second tap lands on Discard changes, with Keep building focused', () => {
    const f = fixture();
    try {
      f.enterWithMove();
      const moved = f.sim.saveBytes();
      f.exitButton.focus();
      expect(f.doc.click(f.exitButton, 1)).toBe(true);
      expect([f.dialog.open, f.doc.activeElement]).toEqual([true, f.keep]);
      // On a phone, Discard changes sits where Exit build was.
      const discard = choice(f, 'discard');
      f.clock.time += 150;
      discard.focus();
      expect(f.doc.click(discard, 2)).toBe(false);
      // Stopping propagation alone would leave the form's close to run.
      expect(f.doc.lastClick).toEqual({ reached: false, cancelled: true });
      expect([f.dialog.open, f.builder.active, f.doc.activeElement]).toEqual([true, true, f.keep]);
      expect(f.session.hasChanges()).toBe(true);
      expect(f.sim.saveBytes()).toEqual(moved);
    } finally { f.handle.free(); }
  });

  it('still discards on a fresh single tap on Discard changes right after', () => {
    const f = fixture();
    try {
      const before = f.sim.saveBytes();
      f.enterWithMove();
      expect(f.doc.click(f.exitButton, 1)).toBe(true);
      expect(f.dialog.open).toBe(true);
      f.clock.time += 150;
      expect(f.doc.click(choice(f, 'discard'), 1)).toBe(true);
      expect(f.doc.lastClick).toEqual({ reached: true, cancelled: false });
      expect([f.dialog.open, f.builder.active]).toEqual([false, false]);
      expect(f.sim.saveBytes()).toEqual(before);
    } finally { f.handle.free(); }
  });

  it('arms nothing when Escape or Enter opens the dialog', () => {
    const f = fixture();
    try {
      const before = f.sim.saveBytes();
      f.enterWithMove();
      // An earlier pointer click, too old to have opened the dialog.
      expect(f.doc.click(f.stage, 1)).toBe(true);
      f.clock.time += 600;
      expect(f.doc.keydown(f.doc.body, 'Escape')).toBe(true);
      expect(f.dialog.open).toBe(true);
      f.clock.time += 50;
      expect(f.doc.click(choice(f, 'discard'), 2)).toBe(true);
      expect([f.dialog.open, f.builder.active]).toEqual([false, false]);
      expect(f.sim.saveBytes()).toEqual(before);
      // Enter on Exit build: a click with no count opens it.
      f.enterWithMove();
      expect(f.doc.click(f.stage, 1)).toBe(true);
      f.clock.time += 600;
      expect(f.doc.click(f.exitButton, 0)).toBe(true);
      expect(f.dialog.open).toBe(true);
      f.clock.time += 50;
      expect(f.doc.click(choice(f, 'discard'), 2)).toBe(true);
      expect([f.dialog.open, f.builder.active]).toEqual([false, false]);
      expect(f.sim.saveBytes()).toEqual(before);
    } finally { f.handle.free(); }
  });
});

describe('dismissing the dialog', () => {
  it('closes it as Keep building, keeping the changes, so a graphics recovery card is not hidden behind it', () => {
    const f = fixture();
    try {
      f.enterWithMove();
      const moved = f.sim.saveBytes();
      f.exit.dismiss();
      expect(f.dialog.open).toBe(false);
      f.clickExit();
      expect(f.dialog.open).toBe(true);
      f.exit.dismiss();
      expect([f.dialog.open, f.builder.active]).toEqual([false, true]);
      expect(f.sim.saveBytes()).toEqual(moved);
      expect(f.doc.activeElement).toBe(f.exitButton);
    } finally { f.handle.free(); }
  });
});

describe('the refused Confirm message', () => {
  it('points at the furniture when a move is shown, and says to try again otherwise', () => {
    expect(confirmRefusal(true)).toBe(REFUSED);
    expect(confirmRefusal(false)).toBe('The changes could not be confirmed. Try Confirm again.');
    for (const text of [confirmRefusal(true), confirmRefusal(false)]) expect(text).not.toMatch(/cancel the/i);
  });
});

describe('the page', () => {
  /** The markup of one element, from its opening tag to its closing one. */
  function block(open: string, close: string): string {
    const start = INDEX_HTML.indexOf(open);
    if (start < 0) throw new Error(`no ${open} in index.html`);
    return INDEX_HTML.slice(start, INDEX_HTML.indexOf(close, start) + close.length);
  }

  it('has a labeled modal dialog whose buttons give the answers the controller reads', () => {
    const dialog = block('<dialog id="build-exit-dialog"', '</dialog>');
    expect(dialog).toContain('aria-labelledby="build-exit-title"');
    expect(dialog).toContain('aria-describedby="build-exit-text"');
    expect(dialog).toContain('<h2 id="build-exit-title">Leave Build mode?</h2>');
    expect(dialog).toContain('<form method="dialog">');
    const buttons = [...dialog.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)]
      .map(([, attributes, label]) => ({ label, value: /value="([^"]*)"/.exec(attributes)?.[1],
        id: /id="([^"]*)"/.exec(attributes)?.[1] }));
    expect(buttons).toEqual([
      { label: 'Keep building', value: 'keep', id: 'build-exit-keep' },
      { label: 'Confirm changes', value: 'confirm', id: 'build-exit-confirm' },
      { label: 'Discard changes', value: 'discard', id: 'build-exit-discard' },
    ]);
  });

  it('styles the dialog as its siblings are and stacks its three buttons on any width', () => {
    for (const selector of ['#build-exit-dialog,', '#build-exit-dialog::backdrop', '#build-exit-dialog h2']) {
      expect(INDEX_HTML).toContain(selector);
    }
    expect(INDEX_HTML).toContain('#build-exit-dialog menu { grid-template-columns: minmax(0, 1fr); }');
  });

  it('describes Escape in the Windows note as it now works', () => {
    expect(block('<p id="window-keyboard-help"', '</p>'))
      .toContain('Escape clears the selected line, or leaves Build mode when none is selected.');
    expect(INDEX_HTML).not.toContain('Escape cancels.');
  });

  // main.ts runs only in a browser, so these read its source. The behavior
  // each line wires is what the tests above exercise with the same calls.
  it('main.ts source: the builder exit goes through the gate and the footer belongs to the controller', () => {
    expect(MAIN_TS).toContain('beforeExit: () => buildExit.gate(),');
    expect(MAIN_TS).toContain("document.querySelector<HTMLButtonElement>('#builder-exit')?.addEventListener('click', () => builder.exit());");
    expect(MAIN_TS).not.toContain("querySelector('#build-batch-confirm')");
    expect(MAIN_TS).not.toContain("querySelector('#build-batch-cancel')");
  });

  it('main.ts source: the shared pending check over every tool, the contextual Cancel, discard and graphics loss', () => {
    expect(MAIN_TS).toContain('hasUnconfirmedChanges: () => hasUnconfirmedChanges(buildDraft) || roomSelection.hasLocalChanges() || roomReview.hasChoices,');
    expect(MAIN_TS).toContain('tools: [wallTool, windowTool, roomTool, buyTool, floorTool, landTool],');
    expect(MAIN_TS).toContain('return buildCommandsIdle(buildDraft);');
    expect(MAIN_TS).toContain('clearSelection: () => clearBuildSelection(buildTools, builder),');
    expect(MAIN_TS).not.toContain('cancelBuildBatch');
    expect(MAIN_TS).toContain('confirmRefusal(builder.hasPlacementChange)');
    expect(MAIN_TS).toMatch(/overlayPause\.suspend\('graphics'\);menu\.close\(\);buildExit\.dismiss\(\);/);
  });

  it('main.ts source: a discard resets the Land tool as a Load does, inside restoreBuildPresentation', () => {
    const start = MAIN_TS.indexOf('function restoreBuildPresentation(): void {');
    expect(start).toBeGreaterThan(0);
    const body = MAIN_TS.slice(start, MAIN_TS.indexOf('\n  }\n', start));
    expect(body).toContain('landTool.resetAfterLoad(lotWidth, lotHeight);');
    expect(body).not.toContain('landTool.setLotSize');
    expect(MAIN_TS).toContain('restored: () => restoreBuildPresentation(),');
  });


});
