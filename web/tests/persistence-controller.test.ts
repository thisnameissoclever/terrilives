import { describe, expect, it, vi } from 'vitest';

import type { SaveStore } from '../src/storage/save-store.js';
import {
  PersistenceController,
  applyPersistenceControlState,
  type PersistableSim,
} from '../src/ui/persistence-controller.js';

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: Error): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((pass, fail) => {
    resolve = pass;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function status() {
  const attributes = new Map<string, string>();
  return {
    textContent: '',
    attributes,
    setAttribute(name: string, value: string) {
      attributes.set(name, value);
    },
    removeAttribute(name: string) {
      attributes.delete(name);
    },
  };
}

function sim(load = true): PersistableSim & { tick: number } {
  return {
    tick: 0,
    saveBytes: () => new Uint8Array([1, 2, 3]),
    loadBytes: () => load,
    clockTick() {
      return this.tick;
    },
    dayTicks: () => 100,
  };
}

function store(saved: Uint8Array | null): SaveStore & {
  saves: Uint8Array[];
  cleared: number;
} {
  return {
    saves: [],
    cleared: 0,
    async load() {
      return saved;
    },
    async save(bytes) {
      this.saves.push(bytes);
    },
    async clear() {
      this.cleared++;
    },
    close() {},
  };
}

describe('PersistenceController', () => {
  it('distinguishes a new game, a restored game and invalid bytes', async () => {
    const newStatus = status();
    expect(
      await new PersistenceController(store(null), sim(), newStatus).restoreAtStartup(),
    ).toBe('new');
    expect(newStatus.textContent).toBe('No save yet');

    const loadedStatus = status();
    const loaded = new PersistenceController(
      store(new Uint8Array([9])),
      sim(true),
      loadedStatus,
    );
    expect(await loaded.restoreAtStartup()).toBe('loaded');
    expect(loadedStatus.textContent).toBe('Saved game loaded');
    expect(loaded.hasSavedGame()).toBe(true);

    const invalidStatus = status();
    const invalid = new PersistenceController(
      store(new Uint8Array([9])),
      sim(false),
      invalidStatus,
    );
    expect(await invalid.restoreAtStartup()).toBe('invalid');
    expect(invalidStatus.textContent).toContain('Starting a new game');
    expect(invalidStatus.attributes.get('data-kind')).toBe('error');
    expect(invalid.hasSavedGame()).toBe(false);
  });

  it('keeps the running game and reports a storage or validation failure', async () => {
    const view = status();
    const report = vi.fn();
    const broken = store(new Uint8Array([9]));
    broken.load = async () => {
      throw new Error('denied');
    };
    const controller = new PersistenceController(broken, sim(), view, report);

    expect(await controller.load()).toBe(false);
    expect(view.textContent).toBe('Load failed. Current game kept.');
    expect(report).toHaveBeenCalledTimes(1);
  });

  it('autosaves once when each new day is first observed', async () => {
    const game = sim();
    const backend = store(null);
    const controller = new PersistenceController(backend, game, status());
    await controller.restoreAtStartup();

    game.tick = 99;
    controller.updateAutosave();
    game.tick = 100;
    controller.updateAutosave();
    controller.updateAutosave();
    await Promise.resolve();
    await Promise.resolve();
    expect(backend.saves).toHaveLength(1);
    expect(controller.hasSavedGame()).toBe(true);

    game.tick = 200;
    controller.updateAutosave();
    await Promise.resolve();
    await Promise.resolve();
    expect(backend.saves).toHaveLength(2);
  });

  it('does not reload after a save slot fails to clear', async () => {
    const backend = store(null);
    backend.clear = async () => {
      throw new Error('locked');
    };
    const view = status();
    const controller = new PersistenceController(backend, sim(), view);

    expect(await controller.clear()).toBe(false);
    expect(view.textContent).toBe('Could not remove the saved game.');
  });

  it('marks a successfully cleared slot unavailable to Load', async () => {
    const backend = store(new Uint8Array([9]));
    const controller = new PersistenceController(backend, sim(), status());
    await controller.restoreAtStartup();
    expect(controller.hasSavedGame()).toBe(true);

    expect(await controller.clear()).toBe(true);
    expect(controller.hasSavedGame()).toBe(false);
  });

  it('does not let an autosave capture the world while Load is pending', async () => {
    const read = deferred<Uint8Array | null>();
    const game = sim();
    const saveBytes = vi.fn(() => new Uint8Array([1, 2, 3]));
    const loadBytes = vi.fn(() => {
      game.tick = 0;
      return true;
    });
    game.saveBytes = saveBytes;
    game.loadBytes = loadBytes;
    const calls: string[] = [];
    const backend: SaveStore = {
      async load() {
        calls.push('load started');
        const bytes = await read.promise;
        calls.push('load finished');
        return bytes;
      },
      async save() {
        calls.push('save');
      },
      async clear() {
        calls.push('clear');
      },
      close() {},
    };
    const controller = new PersistenceController(backend, game, status());

    game.tick = 100;
    const loading = controller.load();
    expect(controller.controlState()).toEqual({
      saveDisabled: true,
      loadDisabled: true,
      newGameDisabled: true,
      confirmationDisabled: true,
    });

    controller.updateAutosave();
    expect(saveBytes).not.toHaveBeenCalled();
    expect(calls).toEqual(['load started']);

    read.resolve(new Uint8Array([9]));
    expect(await loading).toBe(true);
    expect(loadBytes).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['load started', 'load finished']);
    expect(controller.controlState()).toEqual({
      saveDisabled: false,
      loadDisabled: false,
      newGameDisabled: false,
      confirmationDisabled: false,
    });
  });

  it('does not let Save resurrect a slot while New Game clear is pending', async () => {
    const clearing = deferred<void>();
    const game = sim();
    const saveBytes = vi.fn(() => new Uint8Array([1, 2, 3]));
    game.saveBytes = saveBytes;
    const calls: string[] = [];
    const backend: SaveStore = {
      async load() {
        calls.push('load');
        return new Uint8Array([9]);
      },
      async save() {
        calls.push('save');
      },
      async clear() {
        calls.push('clear started');
        await clearing.promise;
        calls.push('clear finished');
      },
      close() {},
    };
    const view = status();
    const controller = new PersistenceController(backend, game, view);
    expect(await controller.restoreAtStartup()).toBe('loaded');

    const clearResult = controller.clear();
    expect(view.textContent).toBe('Starting new game');
    expect(controller.controlState()).toEqual({
      saveDisabled: true,
      loadDisabled: true,
      newGameDisabled: true,
      confirmationDisabled: true,
    });

    expect(await controller.save()).toBe(false);
    expect(saveBytes).not.toHaveBeenCalled();
    expect(calls).toEqual(['load', 'clear started']);

    clearing.resolve();
    expect(await clearResult).toBe(true);
    expect(calls).toEqual(['load', 'clear started', 'clear finished']);
    expect(controller.hasSavedGame()).toBe(false);
    expect(controller.controlState()).toEqual({
      saveDisabled: false,
      loadDisabled: true,
      newGameDisabled: false,
      confirmationDisabled: false,
    });
  });

  it('disables already-open dialog confirmations with the top-level controls', () => {
    const targets = {
      save: { disabled: false },
      load: { disabled: false },
      newGame: { disabled: false },
      confirmLoad: { disabled: false },
      confirmNewGame: { disabled: false },
    };

    applyPersistenceControlState(
      {
        saveDisabled: true,
        loadDisabled: true,
        newGameDisabled: true,
        confirmationDisabled: true,
      },
      targets,
    );

    expect(targets).toEqual({
      save: { disabled: true },
      load: { disabled: true },
      newGame: { disabled: true },
      confirmLoad: { disabled: true },
      confirmNewGame: { disabled: true },
    });

    applyPersistenceControlState(
      {
        saveDisabled: false,
        loadDisabled: true,
        newGameDisabled: false,
        confirmationDisabled: false,
      },
      targets,
    );

    expect(targets).toEqual({
      save: { disabled: false },
      load: { disabled: true },
      newGame: { disabled: false },
      confirmLoad: { disabled: true },
      confirmNewGame: { disabled: false },
    });
  });
});
