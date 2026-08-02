import { describe, expect, it } from 'vitest';

import {
  SerializedSaveStore,
  type SaveBackend,
} from '../src/storage/save-store.js';

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

describe('SerializedSaveStore', () => {
  it('does not let a load pass a save that is still writing', async () => {
    const write = deferred<void>();
    const calls: string[] = [];
    const backend: SaveBackend = {
      async save() {
        calls.push('save started');
        await write.promise;
        calls.push('save finished');
      },
      async load() {
        calls.push('load');
        return new Uint8Array([7]);
      },
      async clear() {
        calls.push('clear');
      },
      close() {},
    };
    const store = new SerializedSaveStore(backend);

    const saving = store.save(new Uint8Array([1]));
    const loading = store.load();
    await Promise.resolve();
    expect(calls).toEqual(['save started']);

    write.resolve();
    await saving;
    expect(await loading).toEqual(new Uint8Array([7]));
    expect(calls).toEqual(['save started', 'save finished', 'load']);
  });

  it('continues after a failed operation instead of poisoning the queue', async () => {
    const calls: string[] = [];
    const backend: SaveBackend = {
      async save() {
        calls.push('save');
        throw new Error('disk full');
      },
      async load() {
        calls.push('load');
        return null;
      },
      async clear() {},
      close() {},
    };
    const store = new SerializedSaveStore(backend);

    await expect(store.save(new Uint8Array([1]))).rejects.toThrow('disk full');
    await expect(store.load()).resolves.toBeNull();
    expect(calls).toEqual(['save', 'load']);
  });
});
