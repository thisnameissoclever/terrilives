import { describe, expect, it, vi } from 'vitest';

import { CURRENT_SAVE_VERSION } from '../src/storage/save-header.js';
import { downloadSaveFile, readSaveFile, saveFileName } from '../src/storage/save-file.js';
import type { SaveStore } from '../src/storage/save-store.js';
import { PersistenceController, type PersistableSim } from '../src/ui/persistence-controller.js';

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

function store(saved: Uint8Array | null): SaveStore & { saves: Uint8Array[] } {
  return {
    saves: [],
    async load() {
      return saved;
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

  it('exports the protected slot unchanged while saving is paused', async () => {
    const protectedSave = saveBytes(CURRENT_SAVE_VERSION + 1);
    const backend = store(protectedSave);
    const game = sim(false);
    const capture = vi.spyOn(game, 'saveBytes');
    const view = status();
    const controller = new PersistenceController(backend, game, view);
    expect(await controller.restoreAtStartup()).toBe('invalid');
    const deliver = vi.fn();

    expect(await controller.exportSave(deliver)).toBe(true);
    expect(deliver).toHaveBeenCalledWith(protectedSave);
    expect(capture).not.toHaveBeenCalled();
    expect(view.textContent).toBe('Saved game exported');
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
    const file = saveBytes(CURRENT_SAVE_VERSION - 1);

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

  it.each([
    ['a file that is not a save', new Uint8Array([1, 2, 3]), 'That file is not a Natural Causes save. Current game kept.'],
    ['an unsupported version', saveBytes(CURRENT_SAVE_VERSION + 1), `Saved game version ${CURRENT_SAVE_VERSION + 1} is not supported. Current game kept.`],
    ['a save the game cannot read', saveBytes(), 'Import failed. Current game kept.'],
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
    expect(view.textContent).toBe('Import failed. Current game kept.');
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

  it('keeps a protected slot paused when writing over it fails', async () => {
    const backend = store(saveBytes(CURRENT_SAVE_VERSION + 1));
    const game = sim(false);
    const view = status();
    const controller = new PersistenceController(backend, game, view);
    await controller.restoreAtStartup();
    game.loadBytes = () => true;
    backend.save = async () => { throw new Error('unsupported slot kept'); };

    expect(await controller.importSave(saveBytes())).toBe(true);
    expect(view.textContent).toBe('Imported game loaded. Saved data kept. Saving paused.');
    expect(controller.isSavingPaused()).toBe(true);
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

    expect(controller.acceptImportFile(saveBytes())).toBe(true);
    expect(view.textContent).toBe('');
    expect(controller.acceptImportFile(new Uint8Array([60, 104, 116, 109, 108]))).toBe(false);
    expect(view.textContent).toBe('That file is not a Natural Causes save. Current game kept.');

    controller.importFileUnreadable(new Error('permission'));
    expect(view.textContent).toBe('Could not read that file. Current game kept.');
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
