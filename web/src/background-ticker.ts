/**
 * A repeating timer that keeps its pace in a hidden tab.
 *
 * Browsers slow main-thread timers in hidden pages to about once a second,
 * and after five minutes to about once a minute. Timers in a dedicated worker
 * are not slowed that way, so the worker keeps the interval and posts a
 * message for each beat. If the worker cannot start or fails, the ticker falls
 * back to a main-thread interval, which still runs, only less often.
 */

/** The parts of `Worker` the ticker uses, so tests can supply a fake. */
export interface TickerWorker {
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: number | null): void;
  terminate(): void;
}

function createTickerWorker(): TickerWorker {
  return new Worker(new URL('./background-ticker-worker.ts', import.meta.url), {
    type: 'module',
    name: 'background-ticker',
  });
}

export class BackgroundTicker {
  /** Undefined until first use; null once the worker is known to be unavailable. */
  private worker: TickerWorker | null | undefined;
  private callback: (() => void) | null = null;
  private fallback: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly intervalMs: number,
    private readonly createWorker: () => TickerWorker = createTickerWorker,
  ) {}

  /** Starts calling `callback` every interval, replacing any earlier one. */
  start(callback: () => void): () => void {
    this.halt();
    this.callback = callback;
    const worker = this.ensureWorker();
    if (worker) worker.postMessage(this.intervalMs);
    else this.fallback = setInterval(callback, this.intervalMs);
    return () => {
      if (this.callback === callback) this.halt();
    };
  }

  private halt(): void {
    this.callback = null;
    this.worker?.postMessage(null);
    clearInterval(this.fallback);
    this.fallback = undefined;
  }

  private ensureWorker(): TickerWorker | null {
    if (this.worker !== undefined) return this.worker;
    try {
      const worker = this.createWorker();
      worker.onmessage = () => this.callback?.();
      worker.onerror = (event) => {
        event.preventDefault();
        this.failWorker();
      };
      this.worker = worker;
    } catch {
      this.worker = null;
    }
    return this.worker;
  }

  private failWorker(): void {
    this.worker?.terminate();
    this.worker = null;
    const callback = this.callback;
    if (callback && this.fallback === undefined) this.fallback = setInterval(callback, this.intervalMs);
  }
}
