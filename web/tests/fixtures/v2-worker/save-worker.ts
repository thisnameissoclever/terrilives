/**
 * The Origin Private File System side of the save boundary.
 *
 * `createWritable()` stages its writes and publishes them on close, so a page
 * crash during a save does not intentionally replace the previous file with a
 * half-written one. The worker processes one request at a time as a second
 * line of defense behind the client queue. A named Web Lock also serializes
 * tabs sharing this origin. Secure-context browsers must support Web Locks;
 * without them operations fail closed, because OPFS has no exclusive-create
 * primitive for the one-time recovery backup.
 */

import { saveSchemaVersion } from './save-header.js';

const SAVE_FILE = 'terri-save-1.bin';
const V1_BACKUP_FILE = 'terri-save-1.v1-backup.bin';

type SaveRequest =
  | { readonly id: number; readonly kind: 'load' }
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
          await preserveV1Backup(root, request.bytes);
          await write(root, SAVE_FILE, request.bytes);
          port.postMessage({ id: request.id, ok: true });
          break;
        }
        case 'clear':
          // New game clears the playable slot, never the recovery backup.
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

/** Preserve the original wire bytes before the first V2 overwrite. */
async function preserveV1Backup(
  root: FileSystemDirectoryHandle,
  next: ArrayBuffer,
): Promise<void> {
  if (saveSchemaVersion(new Uint8Array(next)) !== 2) return;
  const previous = await read(root);
  if (previous === null) return;
  const previousVersion = saveSchemaVersion(new Uint8Array(previous));
  if (previousVersion !== 1 && previousVersion !== 2) {
    throw new Error('The saved file has an unreadable or unsupported version. It was not replaced.');
  }
  if (previousVersion !== 1) return;
  const existingBackup = await read(root, V1_BACKUP_FILE);
  if (existingBackup !== null) {
    if (saveSchemaVersion(new Uint8Array(existingBackup)) !== 1) {
      throw new Error('The existing V1 recovery backup is unreadable. The saved game was not replaced.');
    }
    return;
  }
  try {
    await write(root, V1_BACKUP_FILE, previous);
  } catch (error: unknown) {
    // Remove only the incomplete backup created by this operation, while
    // still holding the origin lock. A retry must not trust an empty file.
    await removeIfPresent(root, V1_BACKUP_FILE);
    throw error;
  }
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
