// A refused Build reports what is in the way, to the player and the console,
// and leaving Build mode stays possible. See docs/specs/2026-10-13-build-confirmation.md.

import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge, wallReason } from '../src/bridge.js';
import { BuildExit, confirmRefusalReason, type BuildExitHooks } from '../src/ui/build-exit.js';
import { BuildSession } from '../src/ui/build-session.js';
import { RoomFailureLog } from '../src/ui/room-selection.js';
import { confirmFailure, enterFailure, parseBuildFailureReport } from '../src/rooms/failure.js';
import type { RoomFailure } from '../src/rooms/codec.js';

const INDEX_HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../src/ui/build-controls.css', import.meta.url), 'utf8');
const VALIDATION: RoomFailure = { code: 10, detail: 2n };

let memory: WebAssembly.Memory;
beforeAll(async () => {
  memory = (await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') })).memory;
});
afterEach(() => { vi.restoreAllMocks(); });

describe('the failure text', () => {
  it('says what is in the way and what to do, never a bare code', () => {
    const text = confirmFailure(VALIDATION, { rule: 'lot_usability', refusal: 11 });
    expect(text).toBe("These changes can't be confirmed: some furniture would face a space nobody can reach. "
      + 'Change the walls, doors or windows involved, or choose Cancel to undo all pending changes.');
    for (const report of [{ rule: null }, { rule: 'edge_world' }, { rule: 'portal_return' }, { rule: 'seating' },
      { rule: 'reading' }, { rule: 'lot_usability', refusal: 99 }] as const) {
      const other = confirmFailure(VALIDATION, report);
      expect(other).toMatch(/^These changes can't be confirmed/);
      expect(other).toMatch(/Cancel/);
      expect(other).not.toMatch(/detail|validation|[\u2013\u2014]/i);
    }
  });

  it('tells the player Build mode could not open and what to try', () => {
    expect(enterFailure(VALIDATION, { rule: null })).toBe("Build mode can't open because the house would not load as it stands. "
      + 'Let the game run for a moment and try again. If it keeps happening, load an earlier save.');
    expect(enterFailure({ code: 3, detail: null })).toBe('The game ran out of memory while checking the changes. Build mode stays closed.');
    expect(enterFailure(VALIDATION, { rule: 'lot_usability', refusal: 11 })).toMatch(/: some furniture faces a space nobody can reach\./);
    for (const report of [{ rule: 'edge_world' }, { rule: 'portal_return' }, { rule: 'seating' }, { rule: 'reading' },
      { rule: 'lot_usability', refusal: 8 }, { rule: 'lot_usability', refusal: 9 }, { rule: 'lot_usability', refusal: 12 }] as const) {
      expect(enterFailure(VALIDATION, report)).not.toMatch(/\bwould\b(?! not load)/);
    }
  });

  it('reports no refusal when a Confirm was backed out of rather than refused', () => {
    expect(confirmRefusalReason('', '', false)).toBe('');
    expect(confirmRefusalReason('', '', true)).toMatch(/^Move the furniture/);
    expect(confirmRefusalReason('Use 1 to 48 characters for the room name.', 'other', true)).toBe('Use 1 to 48 characters for the room name.');
    expect(confirmRefusalReason('', 'Session reason.', true)).toBe('Session reason.');
  });

  it('reads only the rules it knows from the report', () => {
    expect(parseBuildFailureReport('{"rule":"lot_usability","refusal":11}')).toEqual({ rule: 'lot_usability', refusal: 11 });
    expect(parseBuildFailureReport('{"rule":"edge_world"}')).toEqual({ rule: 'edge_world' });
    expect(parseBuildFailureReport('{"rule":"elsewhere"}')).toEqual({ rule: null });
    expect(parseBuildFailureReport('not json')).toEqual({ rule: null });
  });

  it('names an opening that would face furniture onto an unreachable space, not a wall', () => {
    expect(wallReason(11, 1)).toBe('A wall there would leave furniture out of reach.');
    for (const opening of [0, 2]) expect(wallReason(11, opening)).toMatch(/^That opening would leave furniture facing a space nobody can reach/);
  });
});

describe('the console', () => {
  it('gets the code, kind, detail and rule of a refused Confirm, and the player gets the sentence', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const source = {
      clockTick: () => 0, dayTicks: () => 1440, saveBytes: () => new Uint8Array(), loadBytes: () => true,
      flushCommands() {}, buildActive: () => true, buildDirty: () => true, beginBuild: () => ({ ok: true as const, value: undefined }),
      takeBuildError: () => ({ ok: true as const, value: null }),
      prepareBuildCommit: () => ({ ok: false as const, error: VALIDATION }),
      commitBuild: () => ({ ok: true as const, value: undefined }),
      cancelBuild: () => ({ ok: true as const, value: undefined }), endBuild: () => ({ ok: true as const, value: undefined }),
      buildFailureReport: () => ({ rule: 'lot_usability' as const, refusal: 11 }),
    };
    const session = new BuildSession(source as unknown as ConstructorParameters<typeof BuildSession>[0],
      { prepare: () => true, settled: () => true, restored() {} });
    expect(session.confirm()).toBe(false);
    expect(session.error).toBe(confirmFailure(VALIDATION, { rule: 'lot_usability', refusal: 11 }));
    expect(errors).toHaveBeenCalledOnce();
    const [message, details] = errors.mock.calls[0];
    expect(message).toBe('[Natural Causes] Build: The changes could not be prepared.');
    expect(details).toEqual({ code: 10, kind: 'Build validation failed', detail: 2n, report: { rule: 'lot_usability', refusal: 11 } });
  });

  it('words a command failure before Build opens as a closed Build, not a refused Confirm', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const source = {
      clockTick: () => 0, dayTicks: () => 1440, saveBytes: () => new Uint8Array(), loadBytes: () => true,
      flushCommands() {}, buildActive: () => false, buildDirty: () => false, beginBuild: vi.fn(),
      takeBuildError: () => ({ ok: true as const, value: { code: 12, detail: null } }),
      prepareBuildCommit: vi.fn(), commitBuild: vi.fn(), cancelBuild: vi.fn(), endBuild: vi.fn(),
    };
    const session = new BuildSession(source as unknown as ConstructorParameters<typeof BuildSession>[0],
      { prepare: () => true, settled: () => true, restored() {} });
    expect(session.begin()).toBe(false);
    expect(session.error).toBe('That action is not available in Build mode. Build mode stays closed.');
    expect(source.beginBuild).not.toHaveBeenCalled();
  });

  it('logs each of two failures shown on alternate redraws once', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = new RoomFailureLog();
    for (let frame = 0; frame < 6; frame++) log.report(frame % 2 ? 'Tiles failed.' : 'List failed.', { code: 5, detail: null });
    expect(errors).toHaveBeenCalledTimes(2);
  });

  it('gets a failure shown on every redraw once, and again after it clears', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = new RoomFailureLog(), failure: RoomFailure = { code: 5, detail: null };
    log.report('The room list could not be read.', failure);
    log.report('The room list could not be read.', failure);
    expect(errors).toHaveBeenCalledOnce();
    log.clear(); log.report('The room list could not be read.', failure);
    expect(errors).toHaveBeenCalledTimes(2);
  });

  it('can read the simulation report through the bridge', () => {
    const handle = SimHandle.from_lot();
    try {
      expect(new SimBridge(handle, memory).buildFailureReport()).toEqual({ rule: null });
    } finally { handle.free(); }
  });
});

/** Just enough page for BuildExit: its buttons, its dialog and the document's listeners. */
function exitFixture(refusal: string, confirmed = false) {
  const listeners = new Map<string, (event: unknown) => void>();
  const element = () => {
    const own = new Map<string, () => void>();
    return { textContent: '', disabled: false, isConnected: true, addEventListener: (t: string, f: () => void) => { own.set(t, f); },
      fire: (t: string) => own.get(t)?.(), focus() { doc.activeElement = this; } };
  };
  const nodes = { confirm: element(), cancel: element(), keep: element(), status: element(),
    dialog: { ...element(), open: false, returnValue: '', showModal() { this.open = true; },
      close(value?: string) { this.open = false; if (value !== undefined) this.returnValue = value; this.fire('close'); } } };
  const doc = {
    activeElement: null as unknown, body: {},
    querySelector: (selector: string) => ({ '#build-batch-confirm': nodes.confirm, '#build-batch-cancel': nodes.cancel,
      '#build-exit-dialog': nodes.dialog, '#build-exit-keep': nodes.keep, '#build-exit-status': nodes.status } as Record<string, unknown>)[selector] ?? null,
    addEventListener: (type: string, listener: (event: unknown) => void) => { listeners.set(type, listener); },
  };
  const hooks: BuildExitHooks = {
    hasUnconfirmedChanges: () => true, confirm: vi.fn(() => confirmed), cancel: () => true,
    discard: vi.fn(() => true), leave: vi.fn(() => true), focusView() {}, escapeBuild() {}, escapeAllowed: () => true,
    refusal: () => refusal,
  };
  const exit = new BuildExit(doc as unknown as Document, hooks);
  return { exit, hooks, nodes, doc };
}

describe('leaving when Confirm changes is refused', () => {
  it('asks again with the reason beside it, so Discard changes and Keep building are still there', () => {
    const reason = confirmFailure(VALIDATION, { rule: 'lot_usability', refusal: 11 });
    const { exit, hooks, nodes, doc } = exitFixture(reason);
    expect(exit.gate()).toBe(false);
    expect(nodes.dialog.open).toBe(true);
    expect(nodes.status.textContent).toBe('');
    nodes.dialog.close('confirm');
    expect(hooks.confirm).toHaveBeenCalledOnce();
    expect(hooks.leave).not.toHaveBeenCalled();
    expect(nodes.dialog.open).toBe(true);
    expect(nodes.status.textContent).toBe(reason);
    expect(doc.activeElement).toBe(nodes.keep);
    nodes.dialog.close('discard');
    expect(hooks.leave).toHaveBeenCalledOnce();
  });

  it('stays closed when Confirm was refused without a reason, as when room review went back', () => {
    const { exit, nodes } = exitFixture('');
    exit.gate();
    nodes.dialog.close('confirm');
    expect(nodes.dialog.open).toBe(false);
  });

  it('never opens the dialog from the footer Confirm', () => {
    const { nodes } = exitFixture('A reason.');
    nodes.confirm.fire('click');
    expect(nodes.dialog.open).toBe(false);
  });
});

describe('the page', () => {
  it('has a reason line in the dialog and marks a refusal in the footer as an error', () => {
    expect(INDEX_HTML).toMatch(/<p id="build-exit-status" role="alert"><\/p>/);
    expect(CSS).toMatch(/#build-batch-status\[data-kind='error'\], #build-exit-status:not\(:empty\)/);
  });
});
