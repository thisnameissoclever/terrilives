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

import {copyOriginalError,diagnosticMessage,requireDiagnosticKeys,restoreErrorDetails,serializeErrorDetails,validateErrorDetails,type ErrorDetails} from '../diagnostics/error-details.js';

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

interface PendingRequest {
  readonly kind: SaveRequestInput['kind'];
  resolve(value: ArrayBuffer | null | undefined): void;
  reject(reason: Error): void;
}

const STORAGE_FAILURE = 'Browser storage operation failed.';
const INVALID_RESPONSE = 'The browser storage worker returned invalid data.';

function storageError(value: unknown): Error {
  if (value instanceof Error) return Object.isExtensible(value) ? value : copyOriginalError(value, STORAGE_FAILURE);
  const details = serializeErrorDetails(value), error = new Error(diagnosticMessage(details, STORAGE_FAILURE));
  Object.defineProperty(error, 'stack', { value: undefined, writable: true, configurable: true });
  Object.assign(error, { thrownValue: restoreErrorDetails(details, STORAGE_FAILURE), errorDetails: details });
  return error;
}

function withRequestContext(error: Error, id: number, kind: SaveRequestInput['kind']): Error {
  const descriptor = Object.getOwnPropertyDescriptor(error, 'persistence');
  if (!Object.isExtensible(error) || descriptor && !descriptor.configurable) error = copyOriginalError(error, STORAGE_FAILURE);
  Object.defineProperty(error, 'persistence', { value: { operation: kind, requestId: id }, writable: true, configurable: true, enumerable: true });
  return error;
}

/**
 * Thin request/response client for the storage worker.
 */
class WorkerSaveBackend implements SaveBackend {
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();

  constructor(private readonly worker: Worker) {
    worker.addEventListener('message', (event: MessageEvent<unknown>) => this.receive(event.data));
    worker.addEventListener('error', (event: ErrorEvent) => {
      if (!this.pending.size) return;
      const error = event.error instanceof Error ? storageError(event.error) : new Error(event.message?.slice(0, 16384) || 'The browser storage worker stopped.');
      if (!(event.error instanceof Error)) Object.defineProperty(error, 'stack', { value: undefined, writable: true, configurable: true });
      const metadata = {
        ...(event.message ? { message: event.message.slice(0, 16384) } : {}),
        ...(event.filename ? { filename: event.filename.slice(0, 2048) } : {}),
        ...(Number.isFinite(event.lineno) && event.lineno > 0 ? { lineno: event.lineno } : {}),
        ...(Number.isFinite(event.colno) && event.colno > 0 ? { colno: event.colno } : {}),
      };
      Object.assign(error, { workerEvent: metadata });
      if (event.error !== undefined && event.error !== null && !(event.error instanceof Error)) {
        Object.assign(error, { workerThrownValue: restoreErrorDetails(serializeErrorDetails(event.error), STORAGE_FAILURE) });
      }
      this.rejectAll(error);
      event.preventDefault();
    });
    worker.addEventListener('messageerror', () => {
      this.rejectAll(new Error('The browser storage worker returned unreadable data.'));
    });
  }

  private receive(response: unknown): void {
    let id: number | undefined, pending: PendingRequest | undefined;
    try {
      requireDiagnosticKeys(response, ['id', 'ok', 'bytes', 'error', 'errorDetails', 'workerContext'], INVALID_RESPONSE);
      if (!Number.isSafeInteger(response.id) || (response.id as number) < 1) throw new Error(INVALID_RESPONSE);
      id = response.id as number;
      if (response.ok === true) {
        requireDiagnosticKeys(response, ['id', 'ok', 'bytes'], INVALID_RESPONSE);
        if (response.bytes !== undefined && response.bytes !== null && !(response.bytes instanceof ArrayBuffer)) throw new Error(INVALID_RESPONSE);
        pending = this.pending.get(id);
        if (!pending) return;
        if (pending.kind === 'load' ? response.bytes !== null && !(response.bytes instanceof ArrayBuffer) : response.bytes !== undefined) throw new Error(INVALID_RESPONSE);
        this.pending.delete(id);
        pending.resolve(response.bytes as ArrayBuffer | null | undefined);
        return;
      }
      requireDiagnosticKeys(response, ['id', 'ok', 'error', 'errorDetails', 'workerContext'], INVALID_RESPONSE);
      if (response.ok !== false || typeof response.error !== 'string' || response.error.length > 16384) throw new Error(INVALID_RESPONSE);
      let details: ErrorDetails | undefined;
      if (response.errorDetails !== undefined) {
        validateErrorDetails(response.errorDetails, INVALID_RESPONSE);
        details = response.errorDetails;
        if (diagnosticMessage(details, STORAGE_FAILURE) !== response.error) throw new Error(INVALID_RESPONSE);
      }
      if (response.workerContext !== undefined) {
        requireDiagnosticKeys(response.workerContext, ['operation', 'requestId'], INVALID_RESPONSE);
        if (!['load', 'save', 'clear'].includes(response.workerContext.operation as string) || response.workerContext.requestId !== id) throw new Error(INVALID_RESPONSE);
      }
      // A stale ID is quiet only after the complete independent wire shape is valid.
      pending = this.pending.get(id);
      if (!pending) return;
      if (response.workerContext !== undefined && response.workerContext.operation !== pending.kind) throw new Error(INVALID_RESPONSE);
      const restored = details ? restoreErrorDetails(details, STORAGE_FAILURE) : undefined;
      const error = restored instanceof Error ? restored : new Error(response.error);
      if (!(restored instanceof Error)) Object.defineProperty(error, 'stack', { value: undefined, writable: true, configurable: true });
      if (details) Object.assign(error, { workerErrorDetails: details, ...(details.kind !== 'error' ? { workerThrownValue: restored } : {}) });
      const failure = withRequestContext(error, id, pending.kind);
      this.pending.delete(id);
      pending.reject(failure);
    } catch (cause: unknown) {
      const error = new Error(INVALID_RESPONSE, { cause });
      // Retain a bounded data snapshot, never the unchecked incoming object.
      let details: ErrorDetails;
      try { details = serializeErrorDetails(response); } catch { details = { kind: 'limit', reason: 'unsupported' }; }
      Object.assign(error, { workerResponseDetails: details });
      if (pending && id !== undefined) {
        this.pending.delete(id);
        pending.reject(withRequestContext(error, id, pending.kind));
      } else this.rejectAll(error);
    }
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
      this.pending.set(id, { resolve, reject, kind: request.kind });
      const message: SaveRequest = { ...request, id };
      try { this.worker.postMessage(message, transfer); }
      catch (error: unknown) {
        this.pending.delete(id);
        reject(withRequestContext(storageError(error), id, request.kind));
      }
    });
  }

  private rejectAll(error: Error): void {
    for (const [id, pending] of this.pending) pending.reject(withRequestContext(this.pending.size === 1 ? error : copyOriginalError(error, STORAGE_FAILURE), id, pending.kind));
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
