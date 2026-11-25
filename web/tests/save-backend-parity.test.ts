import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DesktopSaveFiles } from '../src/storage/desktop-bridge.js';
import { FileSaveBackend } from '../src/storage/file-save-backend.js';
import { CURRENT_SAVE_VERSION } from '../src/storage/save-header.js';

// The website's worker and the installed game's file backend must leave the
// same files, byte for byte, after the same sequence of player operations.
// Both run the shared SaveSlot, so this pins the two storage adapters to each
// other; save-worker.test.ts and save-worker-interrupted-write.test.ts, left
// unchanged by the move into save-slot.ts, pin the slot rules themselves.

const SLOT = 'terri-save-1.bin';
const first = new Uint8Array([84, 69, 82, 82, 73, 83, 65, 86, CURRENT_SAVE_VERSION, 0, 29, 128, 0, 0, 0, 1]);
const second = new Uint8Array([84, 69, 82, 82, 73, 83, 65, 86, CURRENT_SAVE_VERSION, 0, 29, 128, 0, 0, 0, 2]);
const garbage = new Uint8Array([1, 2, 3, 4, 5]);
const olderSlot = new Uint8Array(readFileSync(new URL('../../crates/terri-wasm/tests/fixtures/published-v23/day-two.sav', import.meta.url)));

type Snapshot = Record<string, number[]>;
const snapshot = (files: Map<string, Uint8Array>): Snapshot =>
  Object.fromEntries([...files.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, bytes]) => [name, [...bytes]]));

/** The production worker on an in-memory Origin Private File System. */
async function workerRun() {
  const files = new Map<string, Uint8Array>([[SLOT, olderSlot.slice()]]);
  const root = {
    async getFileHandle(name: string, options?: { create?: boolean }) {
      if (!files.has(name)) {
        if (!options?.create) throw new DOMException('missing', 'NotFoundError');
        files.set(name, new Uint8Array());
      }
      return {
        async getFile() { return { async arrayBuffer() { return files.get(name)!.slice().buffer; } }; },
        async createWritable() {
          let staged = new Uint8Array();
          return {
            async write(bytes: ArrayBuffer) { staged = new Uint8Array(bytes).slice(); },
            async close() { files.set(name, staged); },
            async abort() {},
          };
        },
      };
    },
    async removeEntry(name: string) {
      if (!files.delete(name)) throw new DOMException('missing', 'NotFoundError');
    },
  };
  let lockTail = Promise.resolve();
  const locks = {
    request: (_name: string, callback: () => Promise<void>) => {
      const result = lockTail.then(callback);
      lockTail = result.catch(() => undefined);
      return result;
    },
  };
  const waiting = new Map<number, (response: { ok: boolean; bytes?: ArrayBuffer | null; restored?: boolean; error?: string }) => void>();
  const port = {
    onmessage: null as ((event: { data: unknown }) => void) | null,
    postMessage(response: { id: number; ok: boolean }) { waiting.get(response.id)!(response); },
  };
  vi.stubGlobal('self', port);
  vi.stubGlobal('navigator', { storage: { getDirectory: async () => root }, locks });
  vi.resetModules();
  await import('../src/storage/save-worker.js');
  let id = 0;
  const request = async (data: Record<string, unknown>) => {
    const requestId = ++id;
    const response = await new Promise<{ ok: boolean; bytes?: ArrayBuffer | null; restored?: boolean; error?: string }>((resolve) => {
      waiting.set(requestId, resolve);
      port.onmessage!({ data: { id: requestId, ...data } });
    });
    if (!response.ok) throw new Error(response.error);
    return response;
  };
  return {
    files,
    save: async (bytes: Uint8Array) => { await request({ kind: 'save', bytes: bytes.slice().buffer }); },
    previous: async () => {
      const { bytes } = await request({ kind: 'previous' });
      return bytes ? new Uint8Array(bytes) : null;
    },
    restore: async (unreadable: Uint8Array, lastGood: Uint8Array) =>
      (await request({ kind: 'restore', bytes: lastGood.slice().buffer, expected: unreadable.slice().buffer })).restored === true,
    clear: async () => { await request({ kind: 'clear' }); },
  };
}

/** The installed game's backend on an in-memory saves folder. */
function fileRun() {
  const files = new Map<string, Uint8Array>([[SLOT, olderSlot.slice()]]);
  const saves: DesktopSaveFiles = {
    async read(name) { return files.get(name)?.slice() ?? null; },
    async write(name, bytes) { files.set(name, bytes.slice()); },
    async remove(name) { files.delete(name); },
  };
  const backend = new FileSaveBackend(saves);
  return {
    files,
    save: (bytes: Uint8Array) => backend.save(bytes),
    previous: () => backend.lastGoodCopy(),
    restore: (unreadable: Uint8Array, lastGood: Uint8Array) => backend.restoreLastGood(unreadable, lastGood),
    clear: () => backend.clear(),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('the website and the installed game keep the same save files', () => {
  it('after migrating, saving twice, recovering a damaged slot and starting over', async () => {
    const runs = { worker: await workerRun(), file: fileRun() };
    const after: Record<string, Snapshot[]> = { worker: [], file: [] };
    for (const [name, run] of Object.entries(runs)) {
      await run.save(first);
      after[name].push(snapshot(run.files));
      await run.save(second);
      after[name].push(snapshot(run.files));
      run.files.set(SLOT, garbage.slice());
      const lastGood = await run.previous();
      expect(lastGood).toEqual(first);
      expect(await run.restore(garbage, lastGood!)).toBe(true);
      after[name].push(snapshot(run.files));
      await run.clear();
      after[name].push(snapshot(run.files));
    }
    // The sequence must have produced the files it is meant to compare.
    expect(Object.keys(after.worker[2])).toEqual([
      'terri-save-1.bin', 'terri-save-1.damaged.bin', 'terri-save-1.previous.bin', 'terri-save-1.v23-backup.bin',
    ]);
    expect(Object.keys(after.worker[3])).toEqual(['terri-save-1.damaged.bin', 'terri-save-1.v23-backup.bin']);
    expect(after.file).toEqual(after.worker);
  });
});
