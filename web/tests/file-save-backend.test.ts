import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import type { DesktopSaveFiles } from '../src/storage/desktop-bridge.js';
import { FileSaveBackend } from '../src/storage/file-save-backend.js';
import { CURRENT_SAVE_VERSION } from '../src/storage/save-header.js';

const SLOT = 'terri-save-1.bin';
const PREVIOUS = 'terri-save-1.previous.bin';
const DAMAGED = 'terri-save-1.damaged.bin';

// Synthetic storage fixtures: valid wire prefixes plus arbitrary payloads, not loadable snapshots.
const save = (version: number, tail: number): Uint8Array =>
  new Uint8Array([84, 69, 82, 82, 73, 83, 65, 86, version, 0, 29, 128, 0, 0, 0, tail]);
const first = save(CURRENT_SAVE_VERSION, 1);
const second = save(CURRENT_SAVE_VERSION, 2);
const third = save(CURRENT_SAVE_VERSION, 3);
const older = save(20, 7);
const garbage = new Uint8Array([1, 2, 3, 4]);

function fixture(path: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`../../crates/terri-wasm/tests/fixtures/${path}`, import.meta.url)));
}

type Operation = 'read' | 'write' | 'remove';

/** The app's save folder, as the bridge presents it, with injectable failures. */
function fakeFolder(initial: Record<string, Uint8Array> = {}) {
  const files = new Map<string, Uint8Array>(Object.entries(initial).map(([name, bytes]) => [name, bytes.slice()]));
  const calls: string[] = [];
  const failures = new Map<string, Error>();
  const check = (operation: Operation, name: string): void => {
    calls.push(`${operation} ${name}`);
    const failure = failures.get(`${operation} ${name}`);
    if (failure) throw failure;
  };
  const saves: DesktopSaveFiles = {
    async read(name) {
      check('read', name);
      return files.get(name)?.slice() ?? null;
    },
    async write(name, bytes) {
      check('write', name);
      expect(bytes).toBeInstanceOf(Uint8Array);
      files.set(name, bytes.slice());
    },
    async remove(name) {
      check('remove', name);
      files.delete(name);
    },
  };
  const fail = (operation: Operation, name: string, error = new Error(`${operation} ${name} failed`)) => {
    failures.set(`${operation} ${name}`, error);
  };
  const heal = () => failures.clear();
  return { files, calls, saves, fail, heal };
}

describe('FileSaveBackend', () => {
  it('loads nothing from an empty saves folder', async () => {
    const folder = fakeFolder();
    expect(await new FileSaveBackend(folder.saves).load()).toBeNull();
    expect(await new FileSaveBackend(folder.saves).lastGoodCopy()).toBeNull();
  });

  it('loads the bytes it saved', async () => {
    const folder = fakeFolder();
    const backend = new FileSaveBackend(folder.saves);
    await backend.save(first);
    expect(await backend.load()).toEqual(first);
    expect(folder.files.get(SLOT)).toEqual(first);
  });

  it('keeps the slot as the last good copy before the second save', async () => {
    const folder = fakeFolder();
    const backend = new FileSaveBackend(folder.saves);
    await backend.save(first);
    expect(folder.files.has(PREVIOUS)).toBe(false);
    await backend.save(second);
    expect(folder.files.get(SLOT)).toEqual(second);
    expect(folder.files.get(PREVIOUS)).toEqual(first);
    expect(await backend.lastGoodCopy()).toEqual(first);
    expect(folder.calls.indexOf(`write ${PREVIOUS}`)).toBeLessThan(folder.calls.lastIndexOf(`write ${SLOT}`));
  });

  it('keeps an unreadable slot in a damaged copy before restoring the last good copy', async () => {
    const folder = fakeFolder({ [SLOT]: garbage, [PREVIOUS]: first });
    const backend = new FileSaveBackend(folder.saves);
    const lastGood = await backend.lastGoodCopy();
    expect(lastGood).toEqual(first);
    expect(await backend.restoreLastGood(garbage, lastGood!)).toBe(true);
    expect(folder.files.get(DAMAGED)).toEqual(garbage);
    expect(folder.files.get(SLOT)).toEqual(first);
    expect(folder.calls.indexOf(`write ${DAMAGED}`)).toBeLessThan(folder.calls.indexOf(`write ${SLOT}`));
  });

  it('refuses to restore when the slot changed since the caller read it', async () => {
    const folder = fakeFolder({ [SLOT]: second, [PREVIOUS]: first });
    const backend = new FileSaveBackend(folder.saves);
    expect(await backend.restoreLastGood(garbage, first)).toBe(false);
    expect(folder.files.get(SLOT)).toEqual(second);
    expect(folder.files.has(DAMAGED)).toBe(false);
    expect(folder.calls.filter((call) => call.startsWith('write'))).toEqual([]);
  });

  it('clears the last good copy before the slot and keeps recovery backups', async () => {
    const folder = fakeFolder({ [SLOT]: second, [PREVIOUS]: first, 'terri-save-1.v20-backup.bin': older });
    await new FileSaveBackend(folder.saves).clear();
    expect(folder.calls).toEqual([`remove ${PREVIOUS}`, `remove ${SLOT}`]);
    expect([...folder.files.keys()]).toEqual(['terri-save-1.v20-backup.bin']);
  });

  it('keeps an older slot in a versioned recovery backup before replacing it', async () => {
    const folder = fakeFolder({ [SLOT]: older });
    await new FileSaveBackend(folder.saves).save(first);
    expect(folder.files.get('terri-save-1.v20-backup.bin')).toEqual(older);
    expect(folder.files.get(SLOT)).toEqual(first);
    expect(folder.calls.indexOf('write terri-save-1.v20-backup.bin')).toBeLessThan(folder.calls.indexOf(`write ${SLOT}`));
  });

  it('keeps one V23 backup for each historical producer family', async () => {
    const published = fixture('published-v23/day-two.sav');
    const editable = fixture('private-editable/bath-v23.sav');
    const folder = fakeFolder({ [SLOT]: published });
    const backend = new FileSaveBackend(folder.saves);
    await backend.save(first);
    folder.files.set(SLOT, editable.slice());
    await backend.save(second);
    expect(folder.files.get('terri-save-1.v23-backup.bin')).toEqual(published);
    expect(folder.files.get('terri-save-1.v23-editable-backup.bin')).toEqual(editable);
    expect(folder.files.get(SLOT)).toEqual(second);
  });

  it('refuses a save that is not the current version before touching any file', async () => {
    const folder = fakeFolder({ [SLOT]: first });
    await expect(new FileSaveBackend(folder.saves).save(older)).rejects.toThrow(`Only current V${CURRENT_SAVE_VERSION} saves can be written`);
    expect(folder.calls).toEqual([]);
    expect(folder.files.get(SLOT)).toEqual(first);
  });

  it('puts the old slot back when writing the new one fails', async () => {
    const folder = fakeFolder({ [SLOT]: first });
    const backend = new FileSaveBackend(folder.saves);
    let attempts = 0;
    const write = folder.saves.write;
    folder.saves.write = async (name, bytes) => {
      if (name === SLOT && attempts++ === 0) {
        // A write that fails part way leaves a damaged slot behind.
        folder.files.set(SLOT, second.slice(0, 12));
        throw new Error('disk full');
      }
      return write(name, bytes);
    };
    await expect(backend.save(second)).rejects.toThrow('disk full');
    expect(folder.files.get(SLOT)).toEqual(first);
    expect(folder.files.get(PREVIOUS)).toEqual(first);
  });

  it('never lets a slot it could not put back replace the last good copy', async () => {
    const folder = fakeFolder({ [SLOT]: first });
    const backend = new FileSaveBackend(folder.saves);
    const write = folder.saves.write;
    let broken = true;
    folder.saves.write = async (name, bytes) => {
      if (name === SLOT && broken) {
        folder.files.set(SLOT, second.slice(0, 12));
        throw new Error('disk full');
      }
      return write(name, bytes);
    };
    await expect(backend.save(second)).rejects.toThrow('disk full');
    expect(folder.files.get(PREVIOUS)).toEqual(first);
    broken = false;
    await backend.save(third);
    // The half-written slot was not copied over the last good copy.
    expect(folder.files.get(PREVIOUS)).toEqual(first);
    expect(folder.files.get(SLOT)).toEqual(third);
    // A completed save clears the suspicion, so the next one keeps the slot again.
    await backend.save(second);
    expect(folder.files.get(PREVIOUS)).toEqual(third);
  });

  it('names the operation and request on every failure', async () => {
    const folder = fakeFolder({ [SLOT]: first });
    const backend = new FileSaveBackend(folder.saves);
    folder.fail('read', SLOT);
    await expect(backend.load()).rejects.toMatchObject({ persistence: { operation: 'load', requestId: 1 } });
    await expect(backend.save(second)).rejects.toMatchObject({ persistence: { operation: 'save', requestId: 2 } });
    folder.heal();
    folder.fail('remove', PREVIOUS);
    await expect(backend.clear()).rejects.toMatchObject({ message: `remove ${PREVIOUS} failed`, persistence: { operation: 'clear', requestId: 3 } });
  });

  it('refuses read results that are not bytes', async () => {
    const folder = fakeFolder();
    folder.saves.read = async () => 'not bytes' as unknown as Uint8Array;
    await expect(new FileSaveBackend(folder.saves).load()).rejects.toThrow('not bytes');
  });

  it('closes without touching the files', () => {
    const folder = fakeFolder({ [SLOT]: first });
    new FileSaveBackend(folder.saves).close();
    expect(folder.calls).toEqual([]);
  });
});
