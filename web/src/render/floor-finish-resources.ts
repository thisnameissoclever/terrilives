/** Serial replacement keeps one active and at most one preparing renderer alive. */
export class FloorFinishResources<T> {
  private desired = '';
  private current = '';
  private running = false;
  private version = 0;
  private failed = false;
  private hasRequested=false;
  private readonly waiters:{resolve:()=>void;reject:(error:Error)=>void}[]=[];
  constructor(private readonly hooks: {
    prepare(keys: readonly string[]): Promise<T>;
    publish(value: T): void;
    dispose(value: T): void;
    state(ready: boolean, error: string | null): void;
  }, resident?: readonly string[]) {
    // Startup loads the saved floors' finishes with the first renderer, so
    // the first request for them is already satisfied rather than a second
    // full download and decode of every sprite page.
    if (resident) this.current = floorFinishSet(resident);
  }

  request(keys: readonly string[]): void {
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
    if (!this.failed) return;
    this.failed = false;
    this.version++;
    this.hooks.state(false, null);
    void this.run();
  }

  /** Rebuild the same finishes when the graphics device has been replaced. */
  invalidate():Promise<void> {
    if(!this.hasRequested){this.desired='[]';this.hasRequested=true;}
    this.current='';this.version++;this.failed=false;this.hooks.state(false,null);
    const ready=new Promise<void>((resolve,reject)=>this.waiters.push({resolve,reject}));
    void this.run();return ready;
  }

  private async run(): Promise<void> {
    if (this.running || this.current === this.desired || this.failed) return;
    this.running = true;
    const version = this.version, desired = this.desired;
    try {
      const value = await this.hooks.prepare(JSON.parse(desired) as string[]);
      if (version !== this.version) this.hooks.dispose(value);
      else {
        try { this.hooks.publish(value); }
        catch (error) { this.hooks.dispose(value); throw error; }
        this.current = desired;
        this.hooks.state(true, null);
        for(const waiter of this.waiters.splice(0))waiter.resolve();
      }
    } catch (error) {
      if (version === this.version) {
        this.failed = true;
        this.hooks.state(false, error instanceof Error ? error.message : String(error));
        for(const waiter of this.waiters.splice(0))waiter.reject(error instanceof Error?error:new Error(String(error)));
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
