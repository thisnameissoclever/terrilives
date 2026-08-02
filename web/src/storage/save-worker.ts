/**
 * The Origin Private File System side of the save boundary.
 *
 * `createWritable()` stages its writes and publishes them on close, so a page
 * crash during a save does not intentionally replace the previous file with a
 * half-written one. The worker processes one request at a time as a second
 * line of defense behind the client queue.
 */

const SAVE_FILE = 'terri-save-1.bin';

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
        const file = await root.getFileHandle(SAVE_FILE, { create: true });
        const writable = await file.createWritable();
        await writable.write(request.bytes);
        await writable.close();
        port.postMessage({ id: request.id, ok: true });
        break;
      }
      case 'clear':
        await removeIfPresent(root);
        port.postMessage({ id: request.id, ok: true });
        break;
    }
  } catch (error: unknown) {
    port.postMessage({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function read(root: FileSystemDirectoryHandle): Promise<ArrayBuffer | null> {
  try {
    const handle = await root.getFileHandle(SAVE_FILE);
    return await (await handle.getFile()).arrayBuffer();
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'NotFoundError') {
      return null;
    }
    throw error;
  }
}

async function removeIfPresent(root: FileSystemDirectoryHandle): Promise<void> {
  try {
    await root.removeEntry(SAVE_FILE);
  } catch (error: unknown) {
    if (!(error instanceof DOMException && error.name === 'NotFoundError')) {
      throw error;
    }
  }
}

export {};
