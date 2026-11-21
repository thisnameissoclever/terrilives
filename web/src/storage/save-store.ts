/**
 * Browser storage for the single playable-alpha save slot.
 *
 * The simulation owns the bytes and this module owns only their trip to
 * Origin Private File System storage. Calls are serialized so worker I/O
 * cannot overlap. `PersistenceController` separately owns the larger player
 * operation, beginning before save bytes are captured and ending after a
 * loaded world is applied. Browsers are very good at exposing the gap between
 * those two boundaries, which is their little way of keeping us humble.
 */

export interface SaveStore {
  load(): Promise<Uint8Array | null>;
  /** The copy of the save before the latest one, or null when there is none. */
  lastGoodCopy(): Promise<Uint8Array | null>;
  /**
   * Makes a last good copy the slot, after the caller loaded it successfully.
   * The unreadable bytes are kept aside, not discarded. Returns false, changing
   * nothing, when the slot no longer holds `unreadable` or the copy changed.
   */
  restoreLastGood(unreadable: Uint8Array, lastGood: Uint8Array): Promise<boolean>;
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

  lastGoodCopy(): Promise<Uint8Array | null> {
    return this.enqueue(() => this.backend.lastGoodCopy());
  }

  restoreLastGood(unreadable: Uint8Array, lastGood: Uint8Array): Promise<boolean> {
    return this.enqueue(() => this.backend.restoreLastGood(unreadable, lastGood));
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
  | { readonly id: number; readonly kind: 'previous' }
  | {
      readonly id: number;
      readonly kind: 'restore';
      readonly bytes: ArrayBuffer;
      readonly expected: ArrayBuffer;
    }
  | { readonly id: number; readonly kind: 'save'; readonly bytes: ArrayBuffer }
  | { readonly id: number; readonly kind: 'clear' };

type SaveRequestInput =
  | { readonly kind: 'load' }
  | { readonly kind: 'previous' }
  | { readonly kind: 'restore'; readonly bytes: ArrayBuffer; readonly expected: ArrayBuffer }
  | { readonly kind: 'save'; readonly bytes: ArrayBuffer }
  | { readonly kind: 'clear' };

type SaveResponse =
  | {
      readonly id: number;
      readonly ok: true;
      readonly bytes?: ArrayBuffer | null;
      readonly restored?: boolean;
    }
  | { readonly id: number; readonly ok: false; readonly error: string };

/** What a successful worker response carries. */
interface SaveResult {
  readonly bytes?: ArrayBuffer | null;
  readonly restored?: boolean;
}

interface PendingRequest {
  resolve(value: SaveResult): void;
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
        pending.resolve(response);
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
    const { bytes } = await this.request({ kind: 'load' });
    return bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : null;
  }

  async lastGoodCopy(): Promise<Uint8Array | null> {
    const { bytes } = await this.request({ kind: 'previous' });
    return bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : null;
  }

  async restoreLastGood(unreadable: Uint8Array, lastGood: Uint8Array): Promise<boolean> {
    const bytes = lastGood.slice().buffer;
    const expected = unreadable.slice().buffer;
    const { restored } = await this.request({ kind: 'restore', bytes, expected }, [bytes, expected]);
    return restored === true;
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
  ): Promise<SaveResult> {
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
