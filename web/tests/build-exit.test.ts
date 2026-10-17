// Leaving Build mode: the footer's Confirm and Cancel finish the batch and
// leave, and every other way out asks first while changes are not confirmed.
// See docs/specs/2026-10-13-build-confirmation.md.

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.js';
import { BuildExit } from '../src/ui/build-exit.js';
import { BuildSession } from '../src/ui/build-session.js';
import { routeBuildKey } from '../src/ui/build-tools.js';
import { FurnitureBuilder } from '../src/ui/builder.js';
import { OverlayPauseController } from '../src/ui/overlay-pause.js';

const INDEX_HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const MAIN_TS = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

let memory: WebAssembly.Memory;
beforeAll(async () => {
  memory = (await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') })).memory;
});

class FakeDocument {
  activeElement: FakeElement | null = null;
  readonly body = new FakeElement(this);
  readonly nodes = new Map<string, FakeElement>();
  querySelector(selector: string) { return this.nodes.get(selector) ?? null; }
}

/** Only what the controller and the test touch; the listeners are the real ones. */
class FakeElement {
  disabled = false;
  isConnected = true;
  private readonly listeners = new Map<string, (() => void)[]>();
  constructor(protected readonly doc: FakeDocument) {}
  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, [...this.listeners.get(type) ?? [], listener]);
  }
  fire(type: string) { for (const listener of this.listeners.get(type) ?? []) listener(); }
  click() { if (!this.disabled) this.fire('click'); }
  focus() { this.doc.activeElement = this; }
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

const REFUSED = 'Finish or cancel the current placement before confirming.';
const ROLLBACK_FAILED = 'Changes could not be cancelled. Build mode remains open.';

/** Build mode wired as main.ts wires it, for the furniture tool. */
function fixture() {
  const handle = SimHandle.from_lot();
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
  const exitButton = new FakeElement(doc);
  const status = { textContent: '' };
  const view = { focus: vi.fn() };
  const beforeAsk = vi.fn();
  let builder: FurnitureBuilder;
  const session = new BuildSession(sim, {
    // As main.ts: Confirm includes a furniture move not yet placed.
    prepare: () => {
      if (!builder.hasPlacementChange) return true;
      if (!builder.confirm()) return false;
      sim.flushCommands();
      const accepted = sim.lastPlacementResult()?.reason === null;
      builder.afterCommands();
      return accepted;
    },
    settled: () => { builder.afterCommands(); return !builder.pending; },
    restored: () => builder.resetAfterLoad(),
  });
  const exit = new BuildExit(doc as unknown as Document, {
    hasUnconfirmedChanges: () => session.hasChanges() || builder.hasPlacementChange || builder.pending,
    confirm: () => {
      const confirmed = session.confirm();
      status.textContent = confirmed ? 'Changes confirmed.' : REFUSED;
      if (confirmed) builder.cancel();
      return confirmed;
    },
    discard: () => {
      const cancelled = session.end();
      if (!cancelled) status.textContent = ROLLBACK_FAILED;
      return cancelled;
    },
    leave: () => { builder.exit(); return !builder.active; },
    focusView: () => view.focus(),
    beforeAsk,
  });
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
  return { handle, sim, doc, session, builder, exit, dialog, keep, exitButton, confirmButton,
    cancelButton, status, view, beforeAsk, enterWithMove, clickExit };
}

describe('the footer', () => {
  it('Confirm applies the pending changes and then leaves Build mode', () => {
    const f = fixture();
    try {
      const before = f.sim.saveBytes();
      f.enterWithMove();
      const moved = f.sim.saveBytes();
      expect(moved).not.toEqual(before);
      f.confirmButton.click();
      expect(f.builder.active).toBe(false);
      expect(f.session.active).toBe(false);
      expect(f.dialog.open).toBe(false);
      expect(f.sim.saveBytes()).toEqual(moved);
      expect(f.status.textContent).toBe('Changes confirmed.');
    } finally { f.handle.free(); }
  });

  it('Cancel discards the pending changes and then leaves Build mode', () => {
    const f = fixture();
    try {
      const before = f.sim.saveBytes();
      f.enterWithMove();
      f.cancelButton.click();
      expect(f.builder.active).toBe(false);
      expect(f.session.active).toBe(false);
      expect(f.dialog.open).toBe(false);
      expect(f.sim.saveBytes()).toEqual(before);
    } finally { f.handle.free(); }
  });

  it('leaves at once when nothing is pending', () => {
    const f = fixture();
    try {
      f.builder.enter();
      f.confirmButton.click();
      expect(f.builder.active).toBe(false);
      f.builder.enter();
      f.cancelButton.click();
      expect(f.builder.active).toBe(false);
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
      expect(f.session.saveBytes()).not.toEqual(moved);
    } finally { f.handle.free(); }
  });

  it('keeps Build mode with its message when the changes cannot be discarded', () => {
    const f = fixture();
    try {
      f.enterWithMove();
      vi.spyOn(f.sim, 'loadBytes').mockReturnValue(false);
      f.cancelButton.click();
      expect(f.builder.active).toBe(true);
      expect(f.session.active).toBe(true);
      expect(f.status.textContent).toBe(ROLLBACK_FAILED);
    } finally { f.handle.free(); }
  });
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
      expect(f.sim.saveBytes()).toEqual(moved);
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
      vi.spyOn(f.sim, 'loadBytes').mockReturnValue(false);
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
      expect(routeBuildKey('Escape', [], f.builder)).toBe(true);
      expect([f.builder.selected, f.builder.active, f.dialog.open]).toEqual([null, true, false]);
      expect(routeBuildKey('Escape', [], f.builder)).toBe(true);
      expect([f.builder.active, f.dialog.open]).toEqual([true, true]);
      f.dialog.close();
      expect(f.builder.active).toBe(true);
    } finally { f.handle.free(); }
  });

  it('leaves at once with nothing selected and nothing pending', () => {
    const f = fixture();
    try {
      f.builder.enter();
      expect(routeBuildKey('Escape', [], f.builder)).toBe(true);
      expect([f.builder.active, f.dialog.open]).toEqual([false, false]);
    } finally { f.handle.free(); }
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

  it('sends every way out of Build mode through the dialog and the footer through the controller', () => {
    expect(MAIN_TS).toContain('beforeExit: () => buildExit.gate(),');
    expect(MAIN_TS).toContain("document.querySelector<HTMLButtonElement>('#builder-exit')?.addEventListener('click', () => builder.exit());");
    expect(MAIN_TS).not.toContain("addEventListener('click', cancelBuildBatch)");
    expect(MAIN_TS).not.toContain("querySelector('#build-batch-confirm')");
  });
});
