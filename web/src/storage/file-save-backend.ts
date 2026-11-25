/**
 * The installed game's save backend: the website's slot rules, applied to
 * ordinary files through the desktop bridge.
 *
 * `SerializedSaveStore` queues every call, and the app process serializes
 * the file operations again. Errors carry the same `persistence` context the
 * worker path attaches, so the startup report reads them the same way.
 */

import type { DesktopSaveFiles } from './desktop-bridge.js';
import { SaveSlot, type SlotDirectory } from './save-slot.js';
import { storageError, withRequestContext, type SaveBackend } from './save-store.js';

type Operation = 'load' | 'previous' | 'restore' | 'save' | 'clear';

/** Copies exactly the viewed bytes, never the rest of a shared buffer. */
function ownBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function fileDirectory(files: DesktopSaveFiles): SlotDirectory {
  return {
    async read(name) {
      const bytes = await files.read(name);
      if (bytes === null) return null;
      if (!(bytes instanceof Uint8Array)) throw new Error('The app returned save data that is not bytes.');
      return ownBuffer(bytes);
    },
    async write(name, bytes) {
      await files.write(name, new Uint8Array(bytes));
    },
    async remove(name) {
      await files.remove(name);
    },
  };
}

export class FileSaveBackend implements SaveBackend {
  private readonly slot = new SaveSlot();
  private readonly directory: SlotDirectory;
  private nextId = 1;

  constructor(files: DesktopSaveFiles) {
    this.directory = fileDirectory(files);
  }

  load(): Promise<Uint8Array | null> {
    return this.run('load', async () => {
      const bytes = await this.slot.load(this.directory);
      return bytes === null ? null : new Uint8Array(bytes);
    });
  }

  lastGoodCopy(): Promise<Uint8Array | null> {
    return this.run('previous', async () => {
      const bytes = await this.slot.previous(this.directory);
      return bytes === null ? null : new Uint8Array(bytes);
    });
  }

  restoreLastGood(unreadable: Uint8Array, lastGood: Uint8Array): Promise<boolean> {
    return this.run('restore', () => this.slot.restore(this.directory, ownBuffer(lastGood), ownBuffer(unreadable)));
  }

  save(bytes: Uint8Array): Promise<void> {
    // Copy: the WASM-owned result may be inspected by a caller afterwards.
    return this.run('save', () => this.slot.save(this.directory, ownBuffer(bytes)));
  }

  clear(): Promise<void> {
    return this.run('clear', () => this.slot.clear(this.directory));
  }

  /** Nothing to release: the files belong to the app. */
  close(): void {}

  private async run<T>(operation: Operation, work: () => Promise<T>): Promise<T> {
    const id = this.nextId++;
    try {
      return await work();
    } catch (error: unknown) {
      throw withRequestContext(storageError(error), id, operation);
    }
  }
}
