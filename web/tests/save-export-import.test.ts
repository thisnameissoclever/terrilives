import { describe, expect, it, vi } from 'vitest';

import { CURRENT_SAVE_VERSION } from '../src/storage/save-header.js';
import { SAVE_FILE_PREFIX_BYTES, downloadSaveFile, readSaveFile, saveFileName } from '../src/storage/save-file.js';
import type { SaveStore } from '../src/storage/save-store.js';
import { SceneFeedback } from '../src/ui/operation-feedback.js';
import { PersistenceSceneFeedback } from '../src/ui/persistence-feedback.js';
import {
  PersistenceController,
  type PersistableSim,
  type PersistenceFeedbackEvent,
} from '../src/ui/persistence-controller.js';

/** Bytes with a real save prefix: TERRISAV followed by a little-endian version. */
function saveBytes(version = CURRENT_SAVE_VERSION, body: number[] = [7]): Uint8Array {
  return new Uint8Array([84, 69, 82, 82, 73, 83, 65, 86, version & 0xff, version >> 8, ...body]);
}

function status() {
  const attributes = new Map<string, string>();
  return {
    textContent: '' as string | null,
    attributes,
    setAttribute(name: string, value: string) {
      attributes.set(name, value);
    },
    removeAttribute(name: string) {
      attributes.delete(name);
    },
  };
}

function sim(load = true): PersistableSim & { tick: number; loaded: Uint8Array[] } {
  return {
    tick: 0,
    loaded: [],
    saveBytes: () => saveBytes(CURRENT_SAVE_VERSION, [1, 2, 3]),
    loadBytes(bytes) {
      this.loaded.push(bytes);
      return load;
    },
    clockTick() {
      return this.tick;
    },
    dayTicks: () => 100,
  };
}

function presentedScene() {
  const element = {
    textContent: '',
    dataset: {} as Record<string, string>,
    style: {} as Record<string, string>,
    setAttribute: () => {},
    removeAttribute: () => {},
    getAttribute: () => null,
  };
  const hint = { hidden: true, textContent: '' };
  const presentation = new PersistenceSceneFeedback(new SceneFeedback(element as unknown as HTMLElement), hint);
  return {
    element,
    present: (event: PersistenceFeedbackEvent) => presentation.present(event),
  };
}

/** An Export save whose delivery stays open until the test answers it. */
function openExportDialog() {
  let resolve: (saved: boolean) => void = () => {};
  let reject: (error: Error) => void = () => {};
  return {
    deliver: () => new Promise<boolean>((pass, fail) => { resolve = pass; reject = fail; }),
    finish: (saved: boolean) => resolve(saved),
    fail: (error: Error) => reject(error),
  };
}

function store(saved: Uint8Array | null): SaveStore & { saves: Uint8Array[] } {
  return {
    saves: [],
    async load() {
      return saved;
    },
    async lastGoodCopy() {
      return null;
    },
    async restoreLastGood() {
      return false;
    },
    async save(bytes) {
      this.saves.push(bytes);
    },
    async clear() {},
    close() {},
  };
}

describe('Export save', () => {
  it('delivers the running game without writing the slot', async () => {
    const backend = store(null);
    const game = sim();
    const view = status();
    const controller = new PersistenceController(backend, game, view);
    await controller.restoreAtStartup();
    const deliver = vi.fn();

    expect(await controller.exportSave(deliver)).toBe(true);
    expect(deliver).toHaveBeenCalledWith(saveBytes(CURRENT_SAVE_VERSION, [1, 2, 3]));
    expect(backend.saves).toEqual([]);
    expect(view.textContent).toBe('Game exported');
    expect(controller.controlState().exportDisabled).toBe(false);
  });

  it('waits for an asynchronous delivery and shows the note only when it completes', async () => {
    const view = status();
    const controller = new PersistenceController(store(null), sim(), view);
    await controller.restoreAtStartup();
    let finish: (saved: boolean) => void = () => {};
    const exporting = controller.exportSave(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    await Promise.resolve();
    expect(view.textContent).not.toBe('Game exported');
    finish(true);
    expect(await exporting).toBe(true);
    expect(view.textContent).toBe('Game exported');
  });

  it('does not hold the operation while an asynchronous delivery waits', async () => {
    const view = status();
    const controller = new PersistenceController(store(null), sim(), view);
    await controller.restoreAtStartup();
    let finish: (saved: boolean) => void = () => {};
    const exporting = controller.exportSave(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    await Promise.resolve();

    // The close save asks whenIdle first; it must not wait for the dialog.
    await controller.whenIdle();
    expect(controller.controlState().exportDisabled).toBe(false);
    expect(await controller.save()).toBe(true);
    finish(true);
    expect(await exporting).toBe(true);
  });

  it('keeps a save failure that is published while the export dialog is open', async () => {
    const slot = presentedScene();
    const backend = store(null);
    const controller = new PersistenceController(backend, sim(), status(), () => {}, undefined, slot.present);
    await controller.restoreAtStartup();
    const dialog = openExportDialog();
    const exporting = controller.exportSave(dialog.deliver);
    await Promise.resolve();

    backend.save = async () => { throw new Error('disk full'); };
    expect(await controller.saveAutomatically()).toBe(false);
    expect(slot.element.textContent).toBe('Save failed. Try again.');
    expect(slot.element.dataset.state).toBe('failure');

    dialog.finish(true);
    expect(await exporting).toBe(true);
    expect(slot.element.textContent).toBe('Save failed. Try again.');
    expect(slot.element.dataset.state).toBe('failure');
  });

  it('keeps that failure while a later automatic save has only reached Saving', async () => {
    const slot = presentedScene();
    const backend = store(null);
    const controller = new PersistenceController(backend, sim(), status(), () => {}, undefined, slot.present);
    await controller.restoreAtStartup();
    const dialog = openExportDialog();
    const exporting = controller.exportSave(dialog.deliver);
    await Promise.resolve();

    backend.save = async () => { throw new Error('disk full'); };
    expect(await controller.saveAutomatically()).toBe(false);
    let release!: () => void;
    backend.save = () => new Promise<void>((resolve) => { release = resolve; });
    const saving = controller.saveAutomatically();
    await Promise.resolve();
    expect(slot.element.textContent).toBe('Save failed. Try again.');

    dialog.finish(true);
    expect(await exporting).toBe(true);
    expect(slot.element.textContent).toBe('Save failed. Try again.');
    release();
    expect(await saving).toBe(true);
    // A successful automatic save still clears a save failure, as it does
    // without an export in progress. The export success was already withheld.
    expect(slot.element.textContent).toBe('');
  });

  it('shows Game exported when the failure from the wait was already cleared', async () => {
    const slot = presentedScene();
    const backend = store(null);
    const controller = new PersistenceController(backend, sim(), status(), () => {}, undefined, slot.present);
    await controller.restoreAtStartup();
    const dialog = openExportDialog();
    const exporting = controller.exportSave(dialog.deliver);
    await Promise.resolve();

    backend.save = async () => { throw new Error('disk full'); };
    expect(await controller.saveAutomatically()).toBe(false);
    backend.save = async () => {};
    expect(await controller.saveAutomatically()).toBe(true);
    expect(slot.element.textContent).toBe('');

    dialog.finish(true);
    expect(await exporting).toBe(true);
    expect(slot.element.textContent).toBe('Game exported');
  });

  it('replaces a save failure from before Export save once the export finishes', async () => {
    const slot = presentedScene();
    const backend = store(null);
    const controller = new PersistenceController(backend, sim(), status(), () => {}, undefined, slot.present);
    await controller.restoreAtStartup();
    backend.save = async () => { throw new Error('disk full'); };
    expect(await controller.save()).toBe(false);
    expect(slot.element.textContent).toBe('Save failed. Try again.');

    const dialog = openExportDialog();
    const exporting = controller.exportSave(dialog.deliver);
    await Promise.resolve();
    dialog.finish(true);
    expect(await exporting).toBe(true);
    expect(slot.element.textContent).toBe('Game exported');
  });

  it('leaves the save failure on screen when the player cancels the export dialog', async () => {
    const slot = presentedScene();
    const backend = store(null);
    const controller = new PersistenceController(backend, sim(), status(), () => {}, undefined, slot.present);
    await controller.restoreAtStartup();
    const dialog = openExportDialog();
    const exporting = controller.exportSave(dialog.deliver);
    await Promise.resolve();
    backend.save = async () => { throw new Error('disk full'); };
    expect(await controller.saveAutomatically()).toBe(false);

    dialog.finish(false);
    expect(await exporting).toBe(false);
    expect(slot.element.textContent).toBe('Save failed. Try again.');
  });

  it('still reports an export that fails after a save failure during the dialog', async () => {
    const slot = presentedScene();
    const backend = store(null);
    const controller = new PersistenceController(backend, sim(), status(), () => {}, undefined, slot.present);
    await controller.restoreAtStartup();
    const dialog = openExportDialog();
    const exporting = controller.exportSave(dialog.deliver);
    await Promise.resolve();
    backend.save = async () => { throw new Error('disk full'); };
    expect(await controller.saveAutomatically()).toBe(false);

    dialog.fail(new Error('could not write'));
    expect(await exporting).toBe(false);
    expect(slot.element.textContent).toBe('Export failed. The game is still running.');
    expect(slot.element.dataset.state).toBe('failure');
  });

  it('keeps a save failure on the status line when no scene presenter is attached', async () => {
    const view = status();
    const backend = store(null);
    const controller = new PersistenceController(backend, sim(), view);
    await controller.restoreAtStartup();
    const dialog = openExportDialog();
    const exporting = controller.exportSave(dialog.deliver);
    await Promise.resolve();
    backend.save = async () => { throw new Error('disk full'); };
    expect(await controller.saveAutomatically()).toBe(false);
    expect(view.textContent).toBe('Save failed. Try again.');
    expect(view.attributes.get('data-kind')).toBe('error');

    dialog.finish(true);
    expect(await exporting).toBe(true);
    expect(view.textContent).toBe('Save failed. Try again.');
    expect(view.attributes.get('data-kind')).toBe('error');
  });

  it('shows Game exported on the status line when the save during the wait succeeded', async () => {
    const view = status();
    const backend = store(null);
    const controller = new PersistenceController(backend, sim(), view);
    await controller.restoreAtStartup();
    const dialog = openExportDialog();
    const exporting = controller.exportSave(dialog.deliver);
    await Promise.resolve();
    expect(await controller.saveAutomatically()).toBe(true);

    dialog.finish(true);
    expect(await exporting).toBe(true);
    expect(view.textContent).toBe('Game exported');
    expect(view.attributes.has('data-kind')).toBe(false);
  });

  it('labels a late export result as the export', async () => {
    const events: { operation: string; message: string }[] = [];
    const controller = new PersistenceController(store(null), sim(), status(), () => {},
      (bytes) => bytes.byteLength > 0,
      (event) => events.push({ operation: event.operation, message: event.message }));
    await controller.restoreAtStartup();
    let finish: (saved: boolean) => void = () => {};
    const exporting = controller.exportSave(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    await Promise.resolve();
    finish(true);
    await exporting;
    expect(events.at(-1)).toEqual({ operation: 'export', message: 'Game exported' });
  });

  it('shows no note and returns false when the player cancels the save dialog', async () => {
    const view = status();
    const controller = new PersistenceController(store(null), sim(), view);
    await controller.restoreAtStartup();
    const before = view.textContent;

    expect(await controller.exportSave(async () => false)).toBe(false);
    expect(view.textContent).toBe(before);
    expect(controller.controlState().exportDisabled).toBe(false);
  });

  it('reports an asynchronous delivery that fails', async () => {
    const errors: unknown[] = [];
    const view = status();
    const controller = new PersistenceController(store(null), sim(), view, (error) => errors.push(error));
    await controller.restoreAtStartup();

    expect(await controller.exportSave(() => Promise.reject(new Error('disk full')))).toBe(false);
    expect(view.textContent).toBe('Export failed. The game is still running.');
    expect(view.attributes.get('data-kind')).toBe('error');
    expect(errors).toHaveLength(1);
    expect(controller.controlState().exportDisabled).toBe(false);
  });

  it('exports the protected slot unchanged, within the click, while saving is paused', async () => {
    const protectedSave = saveBytes(CURRENT_SAVE_VERSION + 1);
    const backend = store(protectedSave);
    const game = sim(false);
    const capture = vi.spyOn(game, 'saveBytes');
    const view = status();
    const controller = new PersistenceController(backend, game, view);
    expect(await controller.restoreAtStartup()).toBe('invalid');
    const read = vi.spyOn(backend, 'load');
    const deliver = vi.fn();

    const exporting = controller.exportSave(deliver);
    // Delivered before any await, so a browser still treats the download as
    // part of the player's click.
    expect(deliver).toHaveBeenCalledWith(protectedSave);
    expect(await exporting).toBe(true);
    expect(read).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
    expect(view.textContent).toBe('Saved game exported. Saving paused.');
    expect(view.attributes.get('data-kind')).toBe('error');
  });

  it('keeps the paused note when a paused export fails or finds nothing', async () => {
    const backend = store(saveBytes(CURRENT_SAVE_VERSION + 1));
    const view = status();
    const controller = new PersistenceController(backend, sim(false), view);
    await controller.restoreAtStartup();

    expect(await controller.exportSave(() => { throw new Error('blocked'); })).toBe(false);
    expect(view.textContent).toBe('Export failed. The game is still running. Saving paused.');
    expect(view.attributes.get('data-kind')).toBe('error');

    const empty = store(null);
    empty.load = async () => { throw new Error('storage unavailable'); };
    const emptyView = status();
    const unavailable = new PersistenceController(empty, sim(), emptyView);
    expect(await unavailable.restoreAtStartup()).toBe('unavailable');
    empty.load = async () => null;
    expect(await unavailable.exportSave(() => {})).toBe(false);
    expect(emptyView.textContent).toBe('No saved game found. Saving paused.');
    expect(emptyView.attributes.get('data-kind')).toBe('error');
  });

  it('reads the protected slot when its bytes are not already known', async () => {
    const stored = saveBytes(CURRENT_SAVE_VERSION + 1);
    const backend = store(stored);
    const restoreRead = backend.load;
    backend.load = async () => { throw new Error('storage unavailable'); };
    const controller = new PersistenceController(backend, sim(false), status());
    expect(await controller.restoreAtStartup()).toBe('unavailable');
    backend.load = restoreRead;
    const deliver = vi.fn();

    expect(await controller.exportSave(deliver)).toBe(true);
    expect(deliver).toHaveBeenCalledWith(stored);
  });

  it('reports a failed download and releases the operation', async () => {
    const errors: unknown[] = [];
    const view = status();
    const controller = new PersistenceController(store(null), sim(), view, (error) => errors.push(error));

    expect(await controller.exportSave(() => { throw new Error('blocked'); })).toBe(false);
    expect(view.textContent).toBe('Export failed. The game is still running.');
    expect(view.attributes.get('data-kind')).toBe('error');
    expect(errors).toHaveLength(1);
    expect(controller.controlState().exportDisabled).toBe(false);
  });
});

describe('Import save', () => {
  it('loads the file, then writes the loaded world to the slot', async () => {
    const backend = store(null);
    const game = sim();
    const view = status();
    const controller = new PersistenceController(backend, game, view);
    await controller.restoreAtStartup();
    const file = saveBytes(23);

    expect(await controller.importSave(file)).toBe(true);
    expect(game.loaded).toEqual([file]);
    // The slot receives the current-format world, which also converts old files.
    expect(backend.saves).toEqual([saveBytes(CURRENT_SAVE_VERSION, [1, 2, 3])]);
    expect(view.textContent).toBe('Imported game loaded and saved');
    expect(controller.hasSavedGame()).toBe(true);

    // The import counts as this day's save.
    controller.updateAutosave();
    expect(backend.saves).toHaveLength(1);
  });

  it('resumes saving after replacing a protected slot', async () => {
    const backend = store(saveBytes());
    const game = sim(false);
    const controller = new PersistenceController(backend, game, status());
    expect(await controller.restoreAtStartup()).toBe('invalid');
    expect(controller.isSavingPaused()).toBe(true);

    game.loadBytes = () => true;
    expect(await controller.importSave(saveBytes())).toBe(true);
    expect(controller.isSavingPaused()).toBe(false);
    expect(controller.controlState().saveDisabled).toBe(false);
  });

  it('refuses an unknown V24 import before calling the simulation', async () => {
    const backend = store(null);
    const game = sim();
    const load = vi.spyOn(game, 'loadBytes');
    const view = status();
    const controller = new PersistenceController(backend, game, view);
    const file = saveBytes(24);
    expect(controller.acceptImportFile(file.slice(0, 10))).toBe(false);
    expect(await controller.importSave(file)).toBe(false);
    expect(view.textContent).toBe('Saved game version 24 is not supported.');
    expect(load).not.toHaveBeenCalled();
    expect(backend.saves).toEqual([]);
  });

  it.each([
    ['Career V24', 24, [164, 220, 210, 228, 250, 221, 197, 136, 81]],
    ['editable-world V24', 24, [174, 199, 139, 189, 133, 195, 228, 148, 114]],
    ['V25', 25, [7]],
    ['V26', 26, [7]],
    ['V27', 27, [7]],
    ['V28', 28, [8]],
    ['V29', 29, [9]],
    ['V30', 30, [9]],
  ] as const)('passes a recognized %s import to prepared loading', async (_family, version, fingerprint) => {
    const backend = store(null);
    const game = sim();
    const loadPrepared = vi.fn(async () => true);
    const controller = new PersistenceController(backend, game, status(), vi.fn(), loadPrepared);
    const file = saveBytes(version, [...fingerprint]);
    expect(controller.acceptImportFile(file.slice(0, SAVE_FILE_PREFIX_BYTES))).toBe(true);
    expect(await controller.importSave(file)).toBe(true);
    expect(loadPrepared).toHaveBeenCalledExactlyOnceWith(file);
    expect(backend.saves).toEqual([game.saveBytes()]);
  });

  it('protects an unknown V24 slot until the player confirms New game', async () => {
    const unknownSave = saveBytes(24, [174, 199, 139, 189, 133, 195, 228, 148, 113, 37, 22, 9]);
    const backend = store(unknownSave);
    const game = sim();
    const load = vi.spyOn(game, 'loadBytes');
    const deliver = vi.fn();
    const view = status();
    const controller = new PersistenceController(backend, game, view);
    expect(await controller.restoreAtStartup()).toBe('invalid');
    expect(await controller.load()).toBe(false);
    expect(view.textContent).toContain('Saved game version 24 is not supported.');
    expect(await controller.exportSave(deliver)).toBe(true);
    expect(deliver).toHaveBeenCalledWith(unknownSave);
    expect(controller.acceptImportFile(saveBytes(23))).toBe(false);
    expect(await controller.importSave(saveBytes(23))).toBe(false);
    expect(await controller.save()).toBe(false);
    expect(load).not.toHaveBeenCalled();
    expect(backend.saves).toEqual([]);

    expect(await controller.clear()).toBe(true);
    expect(await controller.importSave(saveBytes(23))).toBe(true);
    expect(backend.saves).toEqual([saveBytes(CURRENT_SAVE_VERSION, [1, 2, 3])]);
  });

  it.each([
    ['a file that is not a save', new Uint8Array([1, 2, 3]), 'That file is not a Natural Causes save.'],
    ['an unsupported version', saveBytes(CURRENT_SAVE_VERSION + 1), `Saved game version ${CURRENT_SAVE_VERSION + 1} is not supported.`],
    ['a save the game cannot read', saveBytes(), 'Could not open that save. Use Report bug in Options.'],
  ])('rejects %s without touching the slot', async (_name, file, message) => {
    const backend = store(null);
    const view = status();
    const controller = new PersistenceController(backend, sim(false), view);
    await controller.restoreAtStartup();

    expect(await controller.importSave(file)).toBe(false);
    expect(backend.saves).toEqual([]);
    expect(view.textContent).toBe(message);
    expect(view.attributes.get('data-kind')).toBe('error');
    expect(controller.isSavingPaused()).toBe(false);
  });

  it('keeps the current game when the prepared load throws', async () => {
    const backend = store(null);
    const errors: unknown[] = [];
    const view = status();
    const controller = new PersistenceController(backend, sim(), view, (error) => errors.push(error),
      async () => { throw new Error('download failed'); });

    expect(await controller.importSave(saveBytes())).toBe(false);
    expect(backend.saves).toEqual([]);
    expect(view.textContent).toBe('Could not open that save. Use Report bug in Options.');
    expect(errors).toHaveLength(1);
  });

  it('keeps the imported game running when the slot cannot be written', async () => {
    const backend = store(null);
    backend.save = async () => { throw new Error('quota'); };
    const view = status();
    const controller = new PersistenceController(backend, sim(), view);
    await controller.restoreAtStartup();

    expect(await controller.importSave(saveBytes())).toBe(true);
    expect(view.textContent).toBe('Imported game loaded, but saving failed. Use Save to try again.');
    expect(controller.controlState().saveDisabled).toBe(false);
  });

  it.each([
    ['a newer version', saveBytes(CURRENT_SAVE_VERSION + 1)],
    ['an unreadable header', new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])],
  ])('refuses before loading when the protected slot holds %s the game cannot overwrite', async (_name, slot) => {
    const backend = store(slot);
    const game = sim(false);
    const view = status();
    const controller = new PersistenceController(backend, game, view);
    await controller.restoreAtStartup();
    game.loadBytes = vi.fn(() => true);

    expect(await controller.importSave(saveBytes())).toBe(false);
    expect(game.loadBytes).not.toHaveBeenCalled();
    expect(backend.saves).toEqual([]);
    expect(view.textContent).toBe(
      'The existing saved data cannot be replaced. Export save to keep it, then New game, then import again. Saving paused.',
    );
    expect(controller.isSavingPaused()).toBe(true);
    expect(controller.controlState().importDisabled).toBe(false);
  });

  it('refuses a known unreplaceable protected slot before the confirmation', async () => {
    const view = status();
    const controller = new PersistenceController(store(saveBytes(CURRENT_SAVE_VERSION + 1)), sim(false), view);
    await controller.restoreAtStartup();

    expect(controller.acceptImportFile(saveBytes().slice(0, 10))).toBe(false);
    expect(view.textContent).toBe(
      'The existing saved data cannot be replaced. Export save to keep it, then New game, then import again. Saving paused.',
    );
  });

  it('refuses when the protected slot cannot be checked', async () => {
    const backend = store(null);
    backend.load = async () => { throw new Error('storage unavailable'); };
    const game = sim();
    const loadBytes = vi.spyOn(game, 'loadBytes');
    const view = status();
    const controller = new PersistenceController(backend, game, view);
    expect(await controller.restoreAtStartup()).toBe('unavailable');

    expect(await controller.importSave(saveBytes())).toBe(false);
    expect(loadBytes).not.toHaveBeenCalled();
    expect(view.textContent).toBe('Could not check the existing saved data. Saving paused.');
  });

  it('allows current-world export and Save retry after a confirmed import fails to save', async () => {
    const backend = store(saveBytes(CURRENT_SAVE_VERSION - 1));
    const game = sim(false);
    const view = status();
    const controller = new PersistenceController(backend, game, view);
    await controller.restoreAtStartup();
    game.loadBytes = () => true;
    backend.save = async () => { throw new Error('quota'); };

    expect(await controller.importSave(saveBytes())).toBe(true);
    expect(view.textContent).toBe('Imported game loaded, but saving failed. Use Save to try again.');
    expect(view.attributes.get('data-kind')).toBe('error');
    expect(controller.isSavingPaused()).toBe(false);
    expect(controller.controlState().saveDisabled).toBe(false);
    const deliver = vi.fn();
    expect(await controller.exportSave(deliver)).toBe(true);
    expect(deliver).toHaveBeenCalledWith(game.saveBytes());
    expect(deliver.mock.calls[0][0]).not.toEqual(saveBytes(CURRENT_SAVE_VERSION - 1));
    backend.save = async bytes => { backend.saves.push(bytes); };
    await controller.save();
    expect(backend.saves).toEqual([game.saveBytes()]);
  });

  it('keeps paused state and the paused note when a file is rejected', async () => {
    const backend = store(saveBytes());
    const game = sim(false);
    const view = status();
    const controller = new PersistenceController(backend, game, view);
    await controller.restoreAtStartup();
    const available = controller.hasSavedGame();

    expect(await controller.importSave(saveBytes())).toBe(false);
    expect(view.textContent).toBe('Could not open that save. Use Report bug in Options. Saving paused.');
    expect(controller.isSavingPaused()).toBe(true);
    expect(controller.hasSavedGame()).toBe(available);
    game.tick = 500;
    controller.updateAutosave();
    expect(backend.saves).toEqual([]);
  });

  it('waits its turn behind another storage operation', async () => {
    let finishLoad!: (bytes: Uint8Array | null) => void;
    const backend = store(null);
    backend.load = () => new Promise((resolve) => { finishLoad = resolve; });
    const controller = new PersistenceController(backend, sim(), status());

    const loading = controller.load();
    expect(controller.controlState().importDisabled).toBe(true);
    expect(await controller.importSave(saveBytes())).toBe(false);
    expect(await controller.exportSave(() => {})).toBe(false);
    finishLoad(saveBytes());
    await loading;
    expect(controller.controlState().importDisabled).toBe(false);
  });

  it('screens a chosen file before asking for confirmation', () => {
    const view = status();
    const controller = new PersistenceController(store(null), sim(), view);

    expect(controller.acceptImportFile(saveBytes().slice(0, 10))).toBe(true);
    expect(view.textContent).toBe('');
    expect(controller.acceptImportFile(new Uint8Array([60, 104, 116, 109, 108]))).toBe(false);
    expect(view.textContent).toBe('That file is not a Natural Causes save.');
    expect(controller.acceptImportFile(saveBytes(CURRENT_SAVE_VERSION + 1).slice(0, 10))).toBe(false);
    expect(view.textContent).toBe(`Saved game version ${CURRENT_SAVE_VERSION + 1} is not supported.`);
    expect(controller.acceptImportFile(saveBytes(0).slice(0, 10))).toBe(false);
    expect(view.textContent).toBe('Saved game version 0 is not supported.');

    controller.importFileUnreadable(new Error('permission'));
    expect(view.textContent).toBe('Could not read that file. Choose it again.');
  });
});

describe('save files', () => {
  it('names the file by the local date', () => {
    expect(saveFileName(new Date(2026, 0, 5, 23, 59))).toBe('natural-causes-save-2026-01-05.ncsave');
  });

  it('downloads a copy of the bytes and releases the address later', async () => {
    const link = { href: '', download: '', hidden: false, click: vi.fn(), remove: vi.fn() };
    const appended: unknown[] = [];
    let blob: Blob | undefined;
    const urls = {
      createObjectURL: vi.fn((value: Blob) => { blob = value; return 'blob:save'; }),
      revokeObjectURL: vi.fn(),
    };
    let release: (() => void) | undefined;
    const bytes = saveBytes();

    downloadSaveFile(
      bytes,
      'natural-causes-save-2026-01-05.ncsave',
      { createElement: () => link as unknown as HTMLAnchorElement, body: { append: (node) => appended.push(node) } },
      urls,
      (callback) => { release = callback; },
    );

    expect(link.href).toBe('blob:save');
    expect(link.download).toBe('natural-causes-save-2026-01-05.ncsave');
    expect(appended).toEqual([link]);
    expect(link.click).toHaveBeenCalledTimes(1);
    expect(link.remove).toHaveBeenCalledTimes(1);
    expect(urls.revokeObjectURL).not.toHaveBeenCalled();
    release?.();
    expect(urls.revokeObjectURL).toHaveBeenCalledWith('blob:save');
    expect(await readSaveFile(blob!)).toEqual(bytes);
  });
});
