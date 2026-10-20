import type { PersistableSim } from './persistence-controller.js';
import type { SimBridge } from '../bridge.js';
import type { BuildReview, RoomFailure } from '../rooms/codec.js';
import { confirmFailure, enterFailure, failureDetails, failureWhat, type BuildFailureReport } from '../rooms/failure.js';
import { logError, logWarning } from '../diagnostics/log.js';

type BuildSource = PersistableSim & Pick<SimBridge, 'flushCommands' | 'buildActive' | 'buildDirty' | 'beginBuild'
  | 'prepareBuildCommit' | 'commitBuild' | 'cancelBuild' | 'endBuild' | 'takeBuildError'>
  & Partial<Pick<SimBridge, 'buildFailureReport'>>;
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
    if (!this.settle('enter')) return false;
    const result = this.source.beginBuild();
    if (result.ok) { this.error = ''; return true; }
    const report = this.report(result.error);
    this.error = enterFailure(result.error, report);
    logError('Build', 'Build mode could not open.', failureDetails(result.error, report));
    return false;
  }

  confirm(): boolean | Promise<boolean> {
    if (this.confirming || !this.active) return false;
    this.error = ''; this.confirming = true;
    try {
      if (!this.settle() || !this.hooks.prepare() || !this.settle()) { this.confirming = false; return false; }
      const prepared = this.source.prepareBuildCommit();
      if (!prepared.ok) { this.refuse('The changes could not be prepared.', prepared.error); this.confirming = false; return false; }
      if (prepared.value.groups.length || this.hooks.needsReview?.()) {
        if (!this.hooks.review) { this.error = 'Review the room changes before confirming.'; this.confirming = false; return false; }
        return this.hooks.review(prepared.value).catch(error => {
          this.error = error instanceof Error ? error.message : 'The room review could not be opened.';
          logError('Build', 'The room review could not be opened.', { error });
          return false;
        }).finally(() => { this.confirming = false; });
      }
      const committed = this.source.commitBuild(prepared.value.token);
      if (committed.ok) this.error = ''; else this.refuse('The changes could not be committed.', committed.error);
      this.confirming = false;
      return committed.ok;
    } catch (error) {
      this.error = 'The changes could not be confirmed because of an unexpected error. Try Confirm again, or choose Cancel to undo the pending changes.';
      logError('Build', 'Confirm failed unexpectedly.', { error });
      this.confirming = false; return false;
    }
  }

  cancel(): boolean {
    if (!this.active) return true;
    const result = this.source.cancelBuild();
    if (!result.ok) { this.keepFailure('The pending changes could not be cancelled.', result.error); return false; }
    this.hooks.replaced?.('cancel');
    this.hooks.restored();
    return true;
  }

  end(): boolean {
    if (!this.active) return true;
    const result = this.source.endBuild();
    if (!result.ok) { this.keepFailure('The pending changes could not be discarded.', result.error); return false; }
    this.hooks.replaced?.('end'); this.hooks.restored();
    return true;
  }

  private report(error: RoomFailure): BuildFailureReport | undefined {
    return error.code === 10 ? this.source.buildFailureReport?.() : undefined;
  }

  private refuse(message: string, error: RoomFailure): void {
    const report = this.report(error);
    this.error = confirmFailure(error, report);
    logError('Build', message, failureDetails(error, report));
  }

  private keepFailure(message: string, error: RoomFailure): void {
    this.error = `${failureWhat(error)} The pending changes were kept and Build mode stays open.`;
    logError('Build', message, failureDetails(error));
  }

  private settle(phase: 'enter' | 'confirm' = 'confirm'): boolean {
    // Recolour selection can enqueue one successor while consuming a result.
    // Never commit a checkpoint containing an unprocessed build command.
    for (let attempt = 0; attempt < 4; attempt++) {
      this.source.flushCommands();
      const error = this.source.takeBuildError();
      if (!error.ok || error.value !== null) {
        const failure = error.ok ? error.value! : error.error;
        if (phase === 'confirm') this.refuse('A pending build command failed.', failure);
        else {
          this.error = enterFailure(failure);
          logError('Build', 'A command waiting before Build mode opened failed.', failureDetails(failure));
        }
        return false;
      }
      if (this.hooks.settled()) return true;
    }
    this.error = 'The pending changes are still being applied. Try again in a moment.';
    logWarning('Build', 'Build commands did not settle after four drains.');
    return false;
  }
}
