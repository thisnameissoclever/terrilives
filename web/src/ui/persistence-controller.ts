import type { SaveStore } from '../storage/save-store.js';
import { CURRENT_SAVE_VERSION, saveSchemaVersion } from '../storage/save-header.js';
import { PendingIndicator } from './operation-feedback.js';
import {copyOriginalError,diagnosticMessage,requireDiagnosticKeys,restoreErrorDetails,serializeErrorDetails} from '../diagnostics/error-details.js';

export interface PersistableSim {
  saveBytes(): Uint8Array;
  loadBytes(bytes: Uint8Array): boolean;
  clockTick(): number;
  dayTicks(): number;
}

export interface SaveStatusTarget {
  textContent: string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

export type StartupRestore = 'loaded' | 'new' | 'invalid' | 'unavailable';
type PersistenceOperation = 'save' | 'load' | 'clear';

export interface PersistenceFeedbackEvent {
  readonly operation: PersistenceOperation | 'restore';
  readonly state: 'pending' | 'success' | 'failure';
  readonly automatic: boolean;
  readonly savingPaused: boolean;
  readonly message: string;
}

export interface PersistenceControlState {
  readonly saveDisabled: boolean;
  readonly loadDisabled: boolean;
  readonly newGameDisabled: boolean;
  readonly confirmationDisabled: boolean;
}

export interface PersistenceControlTargets {
  readonly save: { disabled: boolean };
  readonly load: { disabled: boolean };
  readonly newGame: { disabled: boolean };
  readonly confirmLoad: { disabled: boolean };
  readonly confirmNewGame: { disabled: boolean };
}

export interface PersistenceFocusDocument {
  readonly activeElement: Node | null;
  readonly body: Node | null;
}

export interface PersistenceFocusDialog {
  readonly open: boolean;
  contains(node: Node | null): boolean;
}

export interface PersistenceFocusTarget {
  readonly disabled: boolean;
  focus(): void;
}

/**
 * Repairs focus left behind by an explicitly closed persistence dialog.
 * Deliberate focus elsewhere wins, including focus moved while storage was
 * settling. When the opener became unavailable, use the first enabled game
 * action rather than focusing a disabled control.
 */
export function restorePersistenceFocus(
  source: PersistenceFocusDocument,
  dialog: PersistenceFocusDialog,
  opener: PersistenceFocusTarget,
  fallbacks: readonly PersistenceFocusTarget[],
): boolean {
  const active = source.activeElement;
  const stranded =
    active === null ||
    active === source.body ||
    (!dialog.open && dialog.contains(active));
  if (!stranded) return false;

  const target = opener.disabled
    ? fallbacks.find((candidate) => !candidate.disabled)
    : opener;
  if (!target) return false;
  target.focus();
  return true;
}

/** Applies one controller snapshot to both top-level and modal actions. */
export function applyPersistenceControlState(
  state: PersistenceControlState,
  targets: PersistenceControlTargets,
): void {
  targets.save.disabled = state.saveDisabled;
  targets.load.disabled = state.loadDisabled;
  targets.newGame.disabled = state.newGameDisabled;
  targets.confirmLoad.disabled =
    state.loadDisabled || state.confirmationDisabled;
  targets.confirmNewGame.disabled =
    state.newGameDisabled || state.confirmationDisabled;
}

/**
 * Player-facing save lifecycle over one storage slot.
 */
export class PersistenceController {
  private autosaveDay = 0;
  private savedGameAvailable = false;
  private savingPaused = false;
  private activeOperation: PersistenceOperation | null = null;
  private automaticOperation = false;
  private readonly pendingIndicator: PendingIndicator;

  constructor(
    private readonly store: SaveStore,
    private readonly sim: PersistableSim,
    private readonly status: SaveStatusTarget,
    private readonly reportError: (error: unknown) => void = () => {},
    private readonly loadPrepared:(bytes:Uint8Array)=>boolean|Promise<boolean>=bytes=>this.sim.loadBytes(bytes),
    private readonly presentFeedback?: (event: PersistenceFeedbackEvent) => void,
  ) { this.pendingIndicator = new PendingIndicator(status); }

  async restoreAtStartup(): Promise<StartupRestore> {
    try {
      const bytes = await this.store.load();
      if (bytes === null) {
        this.savedGameAvailable = false;
        this.armAutosave();
        this.show('No save yet');
        return 'new';
      }
      if (!await this.loadPrepared(bytes)) {
        this.savedGameAvailable = false;
        this.protectSavedGame(bytes);
        return 'invalid';
      }
      this.savingPaused = false;
      this.armAutosave();
      this.savedGameAvailable = true;
      this.show('Saved game loaded');
      return 'loaded';
    } catch (error: unknown) {
      this.reportFailure(error, 'load');
      this.protectSavedGame();
      return 'unavailable';
    }
  }

  async save(message = 'Game saved'): Promise<boolean> {
    return this.saveWithContext(message, false);
  }

  /** Background persistence carries its provenance independently of its message. */
  async saveAutomatically(): Promise<boolean> {
    return this.saveWithContext('Autosaved', true);
  }

  private async saveWithContext(message: string, automatic: boolean): Promise<boolean> {
    if (this.savingPaused) return false;
    if (!this.beginOperation('save', automatic)) return false;
    this.show('Saving', 'pending');
    try {
      const savedDay = this.currentDay();
      const bytes = this.sim.saveBytes();
      await this.store.save(bytes);
      this.savedGameAvailable = true;
      // Record the day contained in the bytes, not whatever day the live sim
      // reached while storage was writing.
      this.autosaveDay = Math.max(this.autosaveDay, savedDay);
      this.show(message);
      return true;
    } catch (error: unknown) {
      this.reportFailure(error, 'save');
      this.show('Save failed. Try again.', 'failure');
      return false;
    } finally {
      this.finishOperation('save');
    }
  }

  async load(): Promise<boolean> {
    if (!this.beginOperation('load')) return false;
    this.show('Loading', 'pending');
    try {
      const bytes = await this.store.load();
      if (bytes === null) {
        this.savedGameAvailable = false;
        if (this.savingPaused) this.protectSavedGame();
        else this.show('No saved game found', 'failure');
        return false;
      }
      if (!await this.loadPrepared(bytes)) {
        this.savedGameAvailable = false;
        this.protectSavedGame(bytes);
        return false;
      }
      this.savingPaused = false;
      this.armAutosave();
      this.savedGameAvailable = true;
      this.show('Saved game loaded');
      return true;
    } catch (error: unknown) {
      this.reportFailure(error, 'load');
      this.protectSavedGame();
      return false;
    } finally {
      this.finishOperation('load');
    }
  }

  async clear(): Promise<boolean> {
    if (!this.beginOperation('clear')) return false;
    this.show('Starting new game', 'pending');
    try {
      await this.store.clear();
      this.savedGameAvailable = false;
      this.savingPaused = false;
      this.armAutosave();
      if (this.presentFeedback) this.show('');
      return true;
    } catch (error: unknown) {
      this.reportFailure(error, 'clear');
      this.show(
        this.savingPaused
          ? 'Could not remove the saved game. Saving paused. Try New game again.'
          : 'Could not remove the saved game. Try New game again.',
        'failure',
      );
      return false;
    } finally {
      this.finishOperation('clear');
    }
  }

  /** Called from the frame loop. It schedules at most one save per new day. */
  updateAutosave(): void {
    if (this.savingPaused) return;
    const day = this.currentDay();
    if (day <= this.autosaveDay || this.activeOperation !== null) return;
    // Advance before starting the asynchronous write so sixty frames cannot
    // queue sixty copies of the same day.
    this.autosaveDay = day;
    void this.saveWithContext('Autosaved', true);
  }

  close(): void {
    this.store.close();
  }

  /** Whether Load can currently restore a validated or freshly written slot. */
  hasSavedGame(): boolean {
    return this.savedGameAvailable;
  }

  /** Saving is held back on purpose to protect a save this build cannot write over. */
  isSavingPaused(): boolean {
    return this.savingPaused;
  }

  /** Player controls derived from one exclusive persistence operation. */
  controlState(): PersistenceControlState {
    const busy = this.activeOperation !== null;
    return {
      saveDisabled: busy || this.savingPaused,
      loadDisabled: busy || (!this.savedGameAvailable && !this.savingPaused),
      newGameDisabled: busy,
      confirmationDisabled: busy,
    };
  }

  private armAutosave(): void {
    this.autosaveDay = this.currentDay();
  }

  private protectSavedGame(bytes?: Uint8Array): void {
    this.savingPaused = true;
    const version = bytes ? saveSchemaVersion(bytes) : null;
    const reason = version !== null && (version < 1 || version > CURRENT_SAVE_VERSION)
      ? `Saved game version ${version} is not supported.`
      : 'Load failed.';
    this.show(
      `${reason} Saving paused. Retry Load or confirm New game to resume saving.`,
      'failure',
    );
  }

  private reportFailure(value: unknown, operation: PersistenceOperation): void {
    const fallback = 'Save/load operation failed.';
    let error: Error;
    if (value instanceof Error) error = Object.isExtensible(value) ? value : copyOriginalError(value, fallback);
    else {
      const details = serializeErrorDetails(value);
      error = new Error(diagnosticMessage(details, fallback));
      Object.defineProperty(error, 'stack', { value: undefined, writable: true, configurable: true });
      Object.assign(error, { thrownValue: restoreErrorDetails(details, fallback), errorDetails: details });
    }
    const descriptor = Object.getOwnPropertyDescriptor(error, 'persistence'), context: unknown = descriptor?.value;
    let matches = false;
    try {
      requireDiagnosticKeys(context, ['operation', 'requestId'], 'Invalid persistence context.');
      matches = context.operation === operation && (context.requestId === undefined || Number.isSafeInteger(context.requestId) && (context.requestId as number) > 0);
    } catch { /* A local failure may have no storage-worker context. */ }
    if (!matches) {
      if (descriptor && !descriptor.configurable) error = copyOriginalError(error, fallback);
      Object.defineProperty(error, 'persistence', { value: { operation }, writable: true, configurable: true, enumerable: true });
    }
    this.reportError(error);
  }

  private currentDay(): number {
    const dayTicks = this.sim.dayTicks();
    if (!Number.isFinite(dayTicks) || dayTicks <= 0) return 0;
    return Math.floor(this.sim.clockTick() / dayTicks);
  }

  private beginOperation(operation: PersistenceOperation, automatic = false): boolean {
    if (this.activeOperation !== null) return false;
    this.activeOperation = operation;
    this.automaticOperation = automatic;
    if (!this.presentFeedback) this.pendingIndicator.start();
    return true;
  }

  private finishOperation(operation: PersistenceOperation): void {
    if (this.activeOperation === operation) {
      this.activeOperation = null;
      this.automaticOperation = false;
      if (!this.presentFeedback) this.pendingIndicator.stop();
    }
  }

  private show(message: string, state: PersistenceFeedbackEvent['state'] = 'success'): void {
    if (this.presentFeedback) {
      this.presentFeedback({ operation: this.activeOperation ?? 'restore', state,
        automatic: this.automaticOperation, savingPaused: this.savingPaused, message });
      return;
    }
    this.status.textContent = message;
    if (state === 'failure') this.status.setAttribute('data-kind', 'error');
    else this.status.removeAttribute('data-kind');
  }
}
