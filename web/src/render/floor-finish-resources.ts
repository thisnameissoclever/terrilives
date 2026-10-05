/** Serial replacement keeps one active and at most one preparing renderer alive. */
export class FloorFinishResources<T> {
  private desired = '';
  private current = '';
  private running = false;
  private version = 0;
  private failed = false;
  constructor(private readonly hooks: {
    prepare(keys: readonly string[]): Promise<T>;
    publish(value: T): void;
    dispose(value: T): void;
    state(ready: boolean, error: string | null): void;
  }) {}

  request(keys: readonly string[]): void {
    const desired = JSON.stringify([...new Set(keys)].sort());
    if (desired === this.desired) return;
    this.desired = desired;
    this.version++;
    this.failed = false;
    if (!this.current && desired === '[]') this.current = desired;
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
      }
    } catch (error) {
      if (version === this.version) {
        this.failed = true;
        this.hooks.state(false, error instanceof Error ? error.message : String(error));
      }
    } finally {
      this.running = false;
      if (version !== this.version) void this.run();
    }
  }
}
