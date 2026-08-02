import { describe, expect, it, vi } from 'vitest';

import type { SaveStore } from '../src/storage/save-store.js';
import {
  PersistenceController,
  type PersistableSim,
} from '../src/ui/persistence-controller.js';

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
});
