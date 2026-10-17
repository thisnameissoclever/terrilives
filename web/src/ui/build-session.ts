import type { PersistableSim } from './persistence-controller.js';

interface BuildSource extends PersistableSim { flushCommands(): void }
export interface BuildSessionHooks {
  /** Stage the current valid preview, or refuse confirmation. */
  prepare(): boolean;
  /** Consume command results; false means a controller queued another edit. */
  settled(): boolean;
  /** Rebuild presentation after the validated world replacement. */
  restored(): void;
}

/** The paused world is a draft; persistent storage only sees the last confirmed world. */
export class BuildSession implements PersistableSim {
  private baseline: Uint8Array | null = null;
  constructor(private readonly source: BuildSource, private readonly hooks: BuildSessionHooks) {}
  get active(): boolean { return this.baseline !== null; }
  clockTick(): number { return this.source.clockTick(); }
  dayTicks(): number { return this.source.dayTicks(); }
  saveBytes(): Uint8Array { return this.baseline?.slice() ?? this.source.saveBytes(); }

  /**
   * Whether the draft differs from the last confirmed world. A command still
   * queued is not counted until it is applied; the caller asks its tools.
   */
  hasChanges(): boolean {
    const baseline = this.baseline;
    if (!baseline) return false;
    const draft = this.source.saveBytes();
    return draft.length !== baseline.length || draft.some((byte, index) => byte !== baseline[index]);
  }

  loadBytes(bytes: Uint8Array): boolean {
    if (!this.source.loadBytes(bytes)) return false;
    // A successful Load replaces the household, including the cancellation target.
    if (this.active) this.baseline = this.source.saveBytes();
    return true;
  }

  begin(): boolean {
    if (this.active) return true;
    if (!this.settle()) return false;
    this.baseline = this.source.saveBytes();
    return true;
  }

  confirm(): boolean {
    if (!this.active || !this.settle() || !this.hooks.prepare() || !this.settle()) return false;
    this.baseline = this.source.saveBytes();
    return true;
  }

  cancel(): boolean {
    if (!this.baseline) return true;
    if (!this.source.loadBytes(this.baseline)) return false;
    this.hooks.restored();
    return true;
  }

  end(): boolean {
    if (!this.cancel()) return false;
    this.baseline = null;
    return true;
  }

  private settle(): boolean {
    // Recolour selection can enqueue one successor while consuming a result.
    // Never commit a checkpoint containing an unprocessed build command.
    for (let attempt = 0; attempt < 4; attempt++) {
      this.source.flushCommands();
      if (this.hooks.settled()) return true;
    }
    return false;
  }
}
