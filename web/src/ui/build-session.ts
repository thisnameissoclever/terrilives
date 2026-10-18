import type { PersistableSim } from './persistence-controller.js';
import type { SimBridge } from '../bridge.js';
import type { BuildReview } from '../rooms/codec.js';
import { roomFailure } from './room-selection.js';

type BuildSource = PersistableSim & Pick<SimBridge, 'flushCommands' | 'buildActive' | 'buildDirty' | 'beginBuild'
  | 'prepareBuildCommit' | 'commitBuild' | 'cancelBuild' | 'endBuild' | 'takeBuildError'>;
export interface BuildSessionHooks {
  /** Stage the current valid preview, or refuse confirmation. */
  prepare(): boolean;
  /** Consume command results; false means a controller queued another edit. */
  settled(): boolean;
  /** Rebuild presentation after the validated world replacement. */
  restored(): void;
  review?(review: BuildReview): Promise<boolean>;
  needsReview?(): boolean;
  replaced?(reason: 'load' | 'cancel' | 'end'): void;
}

/** The paused world is a draft; persistent storage only sees the last confirmed world. */
export class BuildSession implements PersistableSim {
  error = '';
  private confirming = false;
  constructor(private readonly source: BuildSource, private readonly hooks: BuildSessionHooks) {}
  get active(): boolean { return this.source.buildActive(); }
  clockTick(): number { return this.source.clockTick(); }
  dayTicks(): number { return this.source.dayTicks(); }
  saveBytes(): Uint8Array { return this.source.saveBytes(); }

  /**
   * Native semantic dirtiness includes authored edits and normalized names.
   * Browser previews and invalid local text are counted by the page separately.
   */
  hasChanges(): boolean {
    return this.source.buildDirty();
  }

  loadBytes(bytes: Uint8Array): boolean {
    if (!this.source.loadBytes(bytes)) return false;
    this.hooks.replaced?.('load');
    return true;
  }

  begin(): boolean {
    if (this.active) return true;
    if (!this.settle()) return false;
    const result = this.source.beginBuild();
    this.error = result.ok ? '' : roomFailure(result.error);
    return result.ok;
  }

  confirm(): boolean | Promise<boolean> {
    if (this.confirming || !this.active) return false;
    this.error = ''; this.confirming = true;
    try {
      if (!this.settle() || !this.hooks.prepare() || !this.settle()) { this.confirming = false; return false; }
      const prepared = this.source.prepareBuildCommit();
      if (!prepared.ok) { this.error = roomFailure(prepared.error); this.confirming = false; return false; }
      if (prepared.value.groups.length || this.hooks.needsReview?.()) {
        if (!this.hooks.review) { this.error = 'Review the room changes before confirming.'; this.confirming = false; return false; }
        return this.hooks.review(prepared.value).catch(error => {
          this.error = error instanceof Error ? error.message : 'The room review could not be opened.'; return false;
        }).finally(() => { this.confirming = false; });
      }
      const committed = this.source.commitBuild(prepared.value.token);
      this.error = committed.ok ? '' : roomFailure(committed.error); this.confirming = false;
      return committed.ok;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'The build could not be confirmed.';
      this.confirming = false; return false;
    }
  }

  cancel(): boolean {
    if (!this.active) return true;
    const result = this.source.cancelBuild();
    if (!result.ok) { this.error = roomFailure(result.error); return false; }
    this.hooks.replaced?.('cancel');
    this.hooks.restored();
    return true;
  }

  end(): boolean {
    if (!this.active) return true;
    const result = this.source.endBuild();
    if (!result.ok) { this.error = roomFailure(result.error); return false; }
    this.hooks.replaced?.('end'); this.hooks.restored();
    return true;
  }

  private settle(): boolean {
    // Recolour selection can enqueue one successor while consuming a result.
    // Never commit a checkpoint containing an unprocessed build command.
    for (let attempt = 0; attempt < 4; attempt++) {
      this.source.flushCommands();
      const error = this.source.takeBuildError();
      if (!error.ok || error.value !== null) { this.error = roomFailure(error.ok ? error.value! : error.error); return false; }
      if (this.hooks.settled()) return true;
    }
    return false;
  }
}
