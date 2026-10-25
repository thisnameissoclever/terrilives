/** Serial preparation publishes only the latest requested finish binding state. */
export class FloorFinishResources<T> {
  private desired = '';
  private current = '';
  private running = false;
  private version = 0;
  private failed = false;
  private paused = false;
  private destroyed = false;
  private hasRequested=false;
  private readonly waiters:{resolve:()=>void;reject:(error:unknown)=>void}[]=[];
  constructor(private readonly hooks: {
    prepare(keys: readonly string[]): Promise<T>;
    publish(value: T): void;
    dispose(value: T): void;
    failure?(error: unknown, context: { operation: 'prepare' | 'publish'; finishKeys: readonly string[] }): void;
    state(ready: boolean, error: string | null): void;
  }, resident?: readonly string[]) {
    // Startup loads the saved floors' finishes with the first renderer, so
    // the first request for them is already satisfied rather than a second
    // full download and decode of every sprite page.
    if (resident) this.current = floorFinishSet(resident);
  }

  request(keys: readonly string[]): void {
    if (this.destroyed) return;
    const desired = floorFinishSet(keys);
    if (desired === this.desired) return;
    this.desired = desired;
    this.version++;
    this.failed = false;
    if (!this.hasRequested && desired === '[]') this.current = desired;
    this.hasRequested=true;
    this.hooks.state(this.current === desired, null);
    void this.run();
  }

  retry(): void {
    if (!this.failed || this.destroyed) return;
    this.failed = false;
    this.version++;
    this.hooks.state(false, null);
    void this.run();
  }

  /** Rebuild the same finishes when the graphics device has been replaced. */
  invalidate():Promise<void> {
    if (this.destroyed) return Promise.reject(new Error('Floor resources were disposed'));
    if(!this.hasRequested){this.desired='[]';this.hasRequested=true;}
    this.current='';this.version++;this.failed=false;this.hooks.state(false,null);
    const ready=new Promise<void>((resolve,reject)=>this.waiters.push({resolve,reject}));
    void this.run();return ready;
  }

  /** Device recovery owns rebuilding the base renderer while ordinary finishes wait. */
  pause(): void { this.paused = true; this.version++; }
  resume(resident: readonly string[]): void {
    if (this.destroyed) return;
    this.current = floorFinishSet(resident); this.paused = false; this.failed = false; this.version++;
    if (this.current === this.desired) for (const waiter of this.waiters.splice(0)) waiter.resolve();
    this.hooks.state(this.current === this.desired, null); void this.run();
  }
  destroy(): void {
    this.destroyed = true; this.paused = true; this.version++;
    for (const waiter of this.waiters.splice(0)) waiter.reject(new Error('Floor resources were disposed'));
  }

  private async run(): Promise<void> {
    if (this.running || this.current === this.desired || this.failed || this.paused || this.destroyed) return;
    this.running = true;
    const version = this.version, desired = this.desired;
    const finishKeys = JSON.parse(desired) as string[];
    let operation: 'prepare' | 'publish' = 'prepare';
    try {
      const value = await this.hooks.prepare(finishKeys);
      if (version !== this.version) this.hooks.dispose(value);
      else {
        operation = 'publish';
        try { this.hooks.publish(value); }
        catch (error) { this.hooks.dispose(value); throw error; }
        this.current = desired;
        this.hooks.state(true, null);
        for(const waiter of this.waiters.splice(0))waiter.resolve();
      }
    } catch (error) {
      if (version === this.version) {
        this.failed = true;
        this.hooks.failure?.(error, { operation, finishKeys });
        this.hooks.state(false, error instanceof Error ? error.message : String(error));
        for(const waiter of this.waiters.splice(0))waiter.reject(error);
      }
    } finally {
      this.running = false;
      if (version !== this.version) void this.run();
    }
  }
}

/** The canonical order the renderer is prepared in: unique keys, sorted. */
export function canonicalFloorFinishKeys(keys: readonly string[]): string[] {
  return [...new Set(keys)].sort();
}

function floorFinishSet(keys: readonly string[]): string {
  return JSON.stringify(canonicalFloorFinishKeys(keys));
}
