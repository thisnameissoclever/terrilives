/**
 * Browser storage for the single playable-alpha save slot.
 *
 * The simulation owns the bytes and this module owns only their trip to
 * Origin Private File System storage. Calls are serialized so a manual load,
 * an autosave, and a fast double-click cannot race each other. Browsers are
 * very good at making that sort of race intermittent, which is their little
 * way of keeping us humble.
 */

export interface SaveStore {
  load(): Promise<Uint8Array | null>;
  save(bytes: Uint8Array): Promise<void>;
  clear(): Promise<void>;
  close(): void;
}

export interface SaveBackend extends SaveStore {}

/**
 * Makes every operation wait for the previous one, including after a failure.
 */
export class SerializedSaveStore implements SaveStore {
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly backend: SaveBackend) {}

  load(): Promise<Uint8Array | null> {
    return this.enqueue(() => this.backend.load());
  }

  save(bytes: Uint8Array): Promise<void> {
    return this.enqueue(() => this.backend.save(bytes));
  }

  clear(): Promise<void> {
    return this.enqueue(() => this.backend.clear());
  }

  close(): void {
    this.backend.close();
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

type SaveRequest =
  | { readonly id: number; readonly kind: 'load' }
  | { readonly id: number; readonly kind: 'save'; readonly bytes: ArrayBuffer }
  | { readonly id: number; readonly kind: 'clear' };

type SaveRequestInput =
  | { readonly kind: 'load' }
  | { readonly kind: 'save'; readonly bytes: ArrayBuffer }
  | { readonly kind: 'clear' };

type SaveResponse =
  | {
      readonly id: number;
      readonly ok: true;
      readonly bytes?: ArrayBuffer | null;
    }
  | { readonly id: number; readonly ok: false; readonly error: string };

interface PendingRequest {
  resolve(value: ArrayBuffer | null | undefined): void;
  reject(reason: Error): void;
}

/**
 * Thin request/response client for the storage worker.
 */
class WorkerSaveBackend implements SaveBackend {
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();

  constructor(private readonly worker: Worker) {
    worker.addEventListener('message', (event: MessageEvent<SaveResponse>) => {
      const response = event.data;
      const pending = this.pending.get(response.id);
      if (!pending) return;
      this.pending.delete(response.id);
      if (response.ok) {
        pending.resolve(response.bytes);
      } else {
        pending.reject(new Error(response.error));
      }
    });
    worker.addEventListener('error', () => {
      this.rejectAll(new Error('The browser storage worker stopped.'));
    });
    worker.addEventListener('messageerror', () => {
      this.rejectAll(new Error('The browser storage worker returned unreadable data.'));
    });
  }

  async load(): Promise<Uint8Array | null> {
    const value = await this.request({ kind: 'load' });
    return value instanceof ArrayBuffer ? new Uint8Array(value) : null;
  }

  async save(bytes: Uint8Array): Promise<void> {
    // Transfer a copy. The WASM-owned result may be inspected by a caller after
    // this promise settles, and transferring its buffer would detach it.
    const copy = bytes.slice().buffer;
    await this.request({ kind: 'save', bytes: copy }, [copy]);
  }

  async clear(): Promise<void> {
    await this.request({ kind: 'clear' });
  }

  close(): void {
    this.worker.terminate();
    this.rejectAll(new Error('The browser storage worker was closed.'));
  }

  private request(
    request: SaveRequestInput,
    transfer: Transferable[] = [],
  ): Promise<ArrayBuffer | null | undefined> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const message: SaveRequest = { ...request, id };
      this.worker.postMessage(message, transfer);
    });
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

/** Creates the production one-slot OPFS store. */
export function createSaveStore(): SaveStore {
  const worker = new Worker(new URL('./save-worker.ts', import.meta.url), {
    type: 'module',
    name: 'terrilives-save-store',
  });
  return new SerializedSaveStore(new WorkerSaveBackend(worker));
}
