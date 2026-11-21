/**
 * The Origin Private File System side of the save boundary.
 *
 * `createWritable()` is meant to stage its writes and publish them on close,
 * but this code does not rely on every browser doing so: each save first keeps
 * the slot's good bytes in a last good copy, and `recover` restores it when the
 * slot cannot be loaded. The worker processes one request at a time as a second
 * line of defense behind the client queue. A named Web Lock also serializes
 * tabs sharing this origin. Secure-context browsers must support Web Locks;
 * without them operations fail closed, because OPFS has no exclusive-create
 * primitive for the one-time recovery backup.
 */

import { CURRENT_SAVE_VERSION, isSupportedSavePrefix, saveSchemaVersion } from './save-header.js';

const SAVE_FILE = 'terri-save-1.bin';
const PREVIOUS_FILE = 'terri-save-1.previous.bin';
const DAMAGED_FILE = 'terri-save-1.damaged.bin';

type SaveRequest =
  | { readonly id: number; readonly kind: 'load' }
  | { readonly id: number; readonly kind: 'recover' }
  | { readonly id: number; readonly kind: 'save'; readonly bytes: ArrayBuffer }
  | { readonly id: number; readonly kind: 'clear' };

type SaveResponse =
  | {
      readonly id: number;
      readonly ok: true;
      readonly bytes?: ArrayBuffer | null;
    }
  | { readonly id: number; readonly ok: false; readonly error: string };

interface WorkerPort {
  onmessage: ((event: MessageEvent<SaveRequest>) => void) | null;
  postMessage(message: SaveResponse, transfer?: Transferable[]): void;
}

const port = self as unknown as WorkerPort;
let tail: Promise<void> = Promise.resolve();

port.onmessage = (event): void => {
  const request = event.data;
  tail = tail.then(
    () => handle(request),
    () => handle(request),
  );
};

async function handle(request: SaveRequest): Promise<void> {
  try {
    if (!navigator.locks) {
      throw new Error('Browser Web Locks are unavailable. Saved data has not been changed.');
    }
    await navigator.locks.request('terrilives-save-slot', async () => {
      const root = await navigator.storage.getDirectory();
      switch (request.kind) {
        case 'load': {
          const bytes = await read(root);
          if (bytes === null) {
            port.postMessage({ id: request.id, ok: true, bytes: null });
          } else {
            port.postMessage({ id: request.id, ok: true, bytes }, [bytes]);
          }
          break;
        }
        case 'save': {
          await saveCurrent(root, request.bytes);
          port.postMessage({ id: request.id, ok: true });
          break;
        }
        case 'recover': {
          const bytes = await recoverLastGood(root);
          if (bytes === null) {
            port.postMessage({ id: request.id, ok: true, bytes: null });
          } else {
            port.postMessage({ id: request.id, ok: true, bytes }, [bytes]);
          }
          break;
        }
        case 'clear':
          // New game clears the playable slot and its last good copy, never the
          // historical recovery backups. The copy goes first so a crash between
          // the two removals cannot leave an old game that recovery would revive.
          await removeIfPresent(root, PREVIOUS_FILE);
          await removeIfPresent(root);
          port.postMessage({ id: request.id, ok: true });
          break;
      }
    });
  } catch (error: unknown) {
    port.postMessage({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function read(
  root: FileSystemDirectoryHandle,
  name = SAVE_FILE,
): Promise<ArrayBuffer | null> {
  try {
    const handle = await root.getFileHandle(name);
    return await (await handle.getFile()).arrayBuffer();
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'NotFoundError') {
      return null;
    }
    throw error;
  }
}

/**
 * Writes the current save without ever leaving the slot worse than it was.
 *
 * A page can close in the middle of a write, and not every browser stages the
 * stream's bytes until close. So before the slot is touched, its good bytes are
 * copied to a last good copy, and a failed write puts them back. If the worker
 * is killed outright, the next load finds the damage and asks for
 * `recoverLastGood`. A slot that holds nothing is not a save: it is replaced
 * without complaint, which is what a first save cut off at creation leaves.
 */
async function saveCurrent(root: FileSystemDirectoryHandle, next: ArrayBuffer): Promise<void> {
  const slot = await preserveHistoricalBackup(root, next);
  if (slot !== null) await keepLastGoodCopy(root, slot);
  try {
    await write(root, SAVE_FILE, next);
  } catch (error: unknown) {
    if (slot !== null) {
      try {
        await write(root, SAVE_FILE, slot);
      } catch {
        // The last good copy still holds these bytes. Report the original error.
      }
    }
    throw error;
  }
}

async function keepLastGoodCopy(root: FileSystemDirectoryHandle, slot: ArrayBuffer): Promise<void> {
  try {
    await write(root, PREVIOUS_FILE, slot);
  } catch (error: unknown) {
    // An incomplete copy must not be trusted by a later recovery.
    try {
      await removeIfPresent(root, PREVIOUS_FILE);
    } catch {
      // Report the original error.
    }
    throw error;
  }
}

/**
 * Replaces a slot that could not be loaded with the last good copy, keeping
 * the unreadable bytes in a damaged copy first. Returns null, changing
 * nothing, when there is no usable last good copy.
 */
async function recoverLastGood(root: FileSystemDirectoryHandle): Promise<ArrayBuffer | null> {
  const previous = await read(root, PREVIOUS_FILE);
  if (previous === null || previous.byteLength === 0 || !isSupportedSavePrefix(new Uint8Array(previous))) {
    return null;
  }
  const damaged = await read(root);
  if (damaged !== null && damaged.byteLength > 0) await write(root, DAMAGED_FILE, damaged);
  await write(root, SAVE_FILE, previous);
  return previous;
}

/**
 * Guard every current write and preserve original historical wire bytes: the first
 * current write over an older slot keeps that slot's bytes in a recovery
 * backup. The game never loads a backup by itself; it is kept for deliberate
 * recovery ([RC-save] in docs/specs/2026-09-22-colourways.md). Returns the
 * slot's bytes, or null when the slot is missing or empty.
 */
async function preserveHistoricalBackup(
  root: FileSystemDirectoryHandle,
  next: ArrayBuffer,
): Promise<ArrayBuffer | null> {
  if (saveSchemaVersion(new Uint8Array(next)) !== CURRENT_SAVE_VERSION) {
    throw new Error(`Only current V${CURRENT_SAVE_VERSION} saves can be written. Saved data has not been changed.`);
  }
  const previous = await read(root);
  if (previous === null || previous.byteLength === 0) return null;
  const previousVersion = saveSchemaVersion(new Uint8Array(previous));
  if (previousVersion === null || !isSupportedSavePrefix(new Uint8Array(previous))) {
    throw new Error('The saved file has an unreadable or unsupported version. It was not replaced.');
  }
  if (previousVersion === CURRENT_SAVE_VERSION) return previous;
  const backupFile = `terri-save-1.v${previousVersion}-backup.bin`;
  const existingBackup = await read(root, backupFile);
  if (existingBackup !== null) {
    if (saveSchemaVersion(new Uint8Array(existingBackup)) !== previousVersion
      || !isSupportedSavePrefix(new Uint8Array(existingBackup))) {
      throw new Error(`The existing V${previousVersion} recovery backup is unreadable. The saved game was not replaced.`);
    }
    return previous;
  }
  try {
    await write(root, backupFile, previous);
  } catch (error: unknown) {
    // Remove only the incomplete backup created by this operation, while
    // still holding the origin lock. A retry must not trust an empty file.
    await removeIfPresent(root, backupFile);
    throw error;
  }
  return previous;
}

async function write(
  root: FileSystemDirectoryHandle,
  name: string,
  bytes: ArrayBuffer,
): Promise<void> {
  const file = await root.getFileHandle(name, { create: true });
  const writable = await file.createWritable();
  try {
    await writable.write(bytes);
    await writable.close();
  } catch (error: unknown) {
    try {
      await writable.abort();
    } catch {
      // Already-errored streams may reject abort. Report the original error.
    }
    throw error;
  }
}

async function removeIfPresent(
  root: FileSystemDirectoryHandle,
  name = SAVE_FILE,
): Promise<void> {
  try {
    await root.removeEntry(name);
  } catch (error: unknown) {
    if (!(error instanceof DOMException && error.name === 'NotFoundError')) {
      throw error;
    }
  }
}

export {};
