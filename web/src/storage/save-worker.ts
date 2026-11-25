/**
 * The Origin Private File System side of the save boundary.
 *
 * `createWritable()` is meant to stage its writes and publish them on close,
 * but this code does not rely on every browser doing so: each save first keeps
 * the slot's good bytes in a last good copy, and the `previous` and `restore`
 * requests let the controller fall back to it when the slot cannot be loaded.
 * The worker processes one request at a time as a second
 * line of defense behind the client queue. A named Web Lock also serializes
 * tabs sharing this origin. Secure-context browsers must support Web Locks;
 * without them operations fail closed, because OPFS has no exclusive-create
 * primitive for the one-time recovery backup.
 */

import {serializeErrorDetails,diagnosticMessage,type ErrorDetails} from '../diagnostics/error-details.js';
import { SaveSlot, type SlotDirectory } from './save-slot.js';

type SaveRequest =
  | { readonly id: number; readonly kind: 'load' }
  | { readonly id: number; readonly kind: 'previous' }
  | {
      readonly id: number;
      readonly kind: 'restore';
      /** The last good copy the caller loaded successfully. */
      readonly bytes: ArrayBuffer;
      /** The unreadable slot the caller saw, so a slot changed since is left alone. */
      readonly expected: ArrayBuffer;
    }
  | { readonly id: number; readonly kind: 'save'; readonly bytes: ArrayBuffer }
  | { readonly id: number; readonly kind: 'clear' };

type SaveResponse =
  | {
      readonly id: number;
      readonly ok: true;
      readonly bytes?: ArrayBuffer | null;
      readonly restored?: boolean;
    }
  | {
      readonly id: number;
      readonly ok: false;
      readonly error: string;
      readonly errorDetails: ErrorDetails;
      readonly workerContext: { readonly operation: SaveRequest['kind']; readonly requestId: number };
    };

interface WorkerPort {
  onmessage: ((event: MessageEvent<SaveRequest>) => void) | null;
  postMessage(message: SaveResponse, transfer?: Transferable[]): void;
}

const port = self as unknown as WorkerPort;
let tail: Promise<void> = Promise.resolve();
/** The slot's rules live in save-slot.ts, shared with the installed game. */
const slot = new SaveSlot();

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
      const root = opfsDirectory(await navigator.storage.getDirectory());
      switch (request.kind) {
        case 'load': {
          const bytes = await slot.load(root);
          if (bytes === null) {
            port.postMessage({ id: request.id, ok: true, bytes: null });
          } else {
            port.postMessage({ id: request.id, ok: true, bytes }, [bytes]);
          }
          break;
        }
        case 'save': {
          await slot.save(root, request.bytes);
          port.postMessage({ id: request.id, ok: true });
          break;
        }
        case 'previous': {
          const bytes = await slot.previous(root);
          if (bytes === null) {
            port.postMessage({ id: request.id, ok: true, bytes: null });
          } else {
            port.postMessage({ id: request.id, ok: true, bytes }, [bytes]);
          }
          break;
        }
        case 'restore': {
          const restored = await slot.restore(root, request.bytes, request.expected);
          port.postMessage({ id: request.id, ok: true, restored });
          break;
        }
        case 'clear':
          await slot.clear(root);
          port.postMessage({ id: request.id, ok: true });
          break;
      }
    });
  } catch (error: unknown) {
    const errorDetails = serializeErrorDetails(error);
    port.postMessage({
      id: request.id,
      ok: false,
      error: diagnosticMessage(errorDetails, 'Browser storage operation failed.'),
      errorDetails,
      workerContext: { operation: request.kind, requestId: request.id },
    });
  }
}

/** The slot's files in the Origin Private File System, with the original call order. */
function opfsDirectory(root: FileSystemDirectoryHandle): SlotDirectory {
  return {
    read: (name) => read(root, name),
    write: (name, bytes) => write(root, name, bytes),
    remove: (name) => removeIfPresent(root, name),
  };
}

async function read(root: FileSystemDirectoryHandle, name: string): Promise<ArrayBuffer | null> {
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
  name: string,
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
