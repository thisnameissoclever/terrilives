import type { SaveStore } from '../storage/save-store.js';
import { isSupportedSavePrefix, saveSchemaVersion } from '../storage/save-header.js';

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
type PersistenceOperation = 'save' | 'load' | 'clear' | 'export' | 'import';

export interface PersistenceControlState {
  readonly saveDisabled: boolean;
  readonly loadDisabled: boolean;
  readonly newGameDisabled: boolean;
  readonly exportDisabled: boolean;
  readonly importDisabled: boolean;
  readonly confirmationDisabled: boolean;
}

export interface PersistenceControlTargets {
  readonly save: { disabled: boolean };
  readonly load: { disabled: boolean };
  readonly newGame: { disabled: boolean };
  readonly exportSave: { disabled: boolean };
  readonly importSave: { disabled: boolean };
  readonly confirmLoad: { disabled: boolean };
  readonly confirmNewGame: { disabled: boolean };
  readonly confirmImport: { disabled: boolean };
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
  targets.exportSave.disabled = state.exportDisabled;
  targets.importSave.disabled = state.importDisabled;
  targets.confirmLoad.disabled =
    state.loadDisabled || state.confirmationDisabled;
  targets.confirmNewGame.disabled =
    state.newGameDisabled || state.confirmationDisabled;
  targets.confirmImport.disabled =
    state.importDisabled || state.confirmationDisabled;
}

/** Why a chosen file or stored slot could not become the running game. */
function unloadableReason(bytes: Uint8Array, fallback: string): string {
  const version = saveSchemaVersion(bytes);
  return version !== null && !isSupportedSavePrefix(bytes)
    ? `Saved game version ${version} is not supported.`
    : fallback;
}

type SlotLoad =
  | { readonly kind: 'none' | 'loaded' | 'recovered' }
  | { readonly kind: 'unloadable'; readonly bytes: Uint8Array };

const RECOVERED_MESSAGE = 'The latest save could not be read, so the last good copy was loaded';

/** Whether the storage worker will write a current save over this slot. An empty slot holds nothing, so it is replaceable. */
function slotAcceptsCurrentWrite(bytes: Uint8Array): boolean {
  return bytes.byteLength === 0 || isSupportedSavePrefix(bytes);
}

/**
 * Player-facing save lifecycle over one storage slot.
 */
export class PersistenceController {
  private autosaveDay = 0;
  private savedGameAvailable = false;
  private savingPaused = false;
  /** The protected slot's bytes, when known, so Export can deliver them within the click. */
  private protectedBytes: Uint8Array | null = null;
  private activeOperation: PersistenceOperation | null = null;

  constructor(
    private readonly store: SaveStore,
    private readonly sim: PersistableSim,
    private readonly status: SaveStatusTarget,
    private readonly reportError: (error: unknown) => void = () => {},
    private readonly loadPrepared:(bytes:Uint8Array)=>boolean|Promise<boolean>=bytes=>this.sim.loadBytes(bytes),
  ) {}

  async restoreAtStartup(): Promise<StartupRestore> {
    try {
      const slot = await this.loadFromSlot();
      if (slot.kind === 'none') {
        this.savedGameAvailable = false;
        this.armAutosave();
        this.show('No save yet');
        return 'new';
      }
      if (slot.kind === 'unloadable') {
        this.savedGameAvailable = false;
        this.protectSavedGame(slot.bytes);
        return 'invalid';
      }
      this.resumeSaving();
      this.armAutosave();
      this.savedGameAvailable = true;
      this.show(slot.kind === 'recovered' ? RECOVERED_MESSAGE : 'Saved game loaded');
      return 'loaded';
    } catch (error: unknown) {
      this.reportError(error);
      this.protectSavedGame();
      return 'unavailable';
    }
  }

  async save(message = 'Game saved'): Promise<boolean> {
    if (this.savingPaused) return false;
    if (!this.beginOperation('save')) return false;
    this.show('Saving');
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
      this.reportError(error);
      this.show('Save failed. The game is still running.', true);
      return false;
    } finally {
      this.finishOperation('save');
    }
  }

  async load(): Promise<boolean> {
    if (!this.beginOperation('load')) return false;
    this.show('Loading');
    try {
      const slot = await this.loadFromSlot();
      if (slot.kind === 'none') {
        this.savedGameAvailable = false;
        if (this.savingPaused) this.protectSavedGame();
        else this.show('No saved game found', true);
        return false;
      }
      if (slot.kind === 'unloadable') {
        this.savedGameAvailable = false;
        this.protectSavedGame(slot.bytes);
        return false;
      }
      this.resumeSaving();
      this.armAutosave();
      this.savedGameAvailable = true;
      this.show(slot.kind === 'recovered' ? RECOVERED_MESSAGE : 'Saved game loaded');
      return true;
    } catch (error: unknown) {
      this.reportError(error);
      this.protectSavedGame();
      return false;
    } finally {
      this.finishOperation('load');
    }
  }

  async clear(): Promise<boolean> {
    if (!this.beginOperation('clear')) return false;
    this.show('Starting new game');
    try {
      await this.store.clear();
      this.savedGameAvailable = false;
      this.resumeSaving();
      this.armAutosave();
      return true;
    } catch (error: unknown) {
      this.reportError(error);
      this.show(
        this.savingPaused
          ? 'Could not remove the saved game. Saved data kept. Saving paused.'
          : 'Could not remove the saved game.',
        true,
      );
      return false;
    } finally {
      this.finishOperation('clear');
    }
  }

  /**
   * Gives `deliver` the bytes for a save file. While saving is paused, the
   * running world is not the protected household, so the stored bytes are
   * exported unchanged instead.
   */
  async exportSave(deliver: (bytes: Uint8Array) => void): Promise<boolean> {
    if (!this.beginOperation('export')) return false;
    try {
      const protectedSave = this.savingPaused;
      // Known protected bytes are delivered synchronously, still inside the
      // click, because some mobile browsers drop a download started later.
      const bytes = protectedSave
        ? this.protectedBytes ?? await this.store.load()
        : this.sim.saveBytes();
      if (bytes === null || bytes.byteLength === 0) {
        this.showKeepingPausedNote('No saved game found', true);
        return false;
      }
      deliver(bytes);
      this.showKeepingPausedNote(protectedSave ? 'Saved game exported' : 'Game exported');
      return true;
    } catch (error: unknown) {
      this.reportError(error);
      this.showKeepingPausedNote('Export failed. The game is still running.', true);
      return false;
    } finally {
      this.finishOperation('export');
    }
  }

  /**
   * Checks a chosen file before Import asks for confirmation, so the player is
   * not asked to replace their game with something that is not a save.
   */
  acceptImportFile(prefix: Uint8Array): boolean {
    if (saveSchemaVersion(prefix) === null) {
      this.keepCurrentGame('That file is not a Natural Causes save.');
      return false;
    }
    if (!slotAcceptsCurrentWrite(prefix)) {
      this.keepCurrentGame(unloadableReason(prefix, 'Import failed.'));
      return false;
    }
    if (this.savingPaused && this.protectedBytes !== null && !slotAcceptsCurrentWrite(this.protectedBytes)) {
      this.refuseUnreplaceableSlot();
      return false;
    }
    return true;
  }

  /** The browser could not read the chosen file. */
  importFileUnreadable(error: unknown): void {
    this.reportError(error);
    this.keepCurrentGame('Could not read that file.');
  }

  /**
   * Replaces the running game and the saved slot with a chosen file. The file
   * loads first, so a rejected file changes neither. The loaded world is then
   * written in the current format, which also converts an older file.
   */
  async importSave(bytes: Uint8Array): Promise<boolean> {
    if (!this.beginOperation('import')) return false;
    this.show('Importing');
    try {
      // A protected slot the worker will not overwrite would leave the
      // imported world running with saving still paused, and New game would
      // then discard it. Refuse before anything changes instead.
      if (this.savingPaused) {
        let stored: Uint8Array | null;
        try {
          stored = this.protectedBytes ?? await this.store.load();
        } catch (error: unknown) {
          this.reportError(error);
          this.keepCurrentGame('Could not check the saved data in this browser.');
          return false;
        }
        if (stored !== null && !slotAcceptsCurrentWrite(stored)) {
          this.refuseUnreplaceableSlot();
          return false;
        }
      }
      let loaded = false;
      try {
        loaded = await this.loadSupportedSave(bytes);
      } catch (error: unknown) {
        this.reportError(error);
      }
      if (!loaded) {
        this.keepCurrentGame(
          saveSchemaVersion(bytes) === null
            ? 'That file is not a Natural Causes save.'
            : unloadableReason(bytes, 'Import failed.'),
        );
        return false;
      }
      this.armAutosave();
      const importedDay = this.currentDay();
      try {
        await this.store.save(this.sim.saveBytes());
        this.resumeSaving();
        this.savedGameAvailable = true;
        this.autosaveDay = Math.max(this.autosaveDay, importedDay);
        this.show('Imported game loaded and saved');
      } catch (error: unknown) {
        this.reportError(error);
        this.show(
          this.savingPaused
            ? 'Imported game loaded. Saved data kept. Saving paused.'
            : 'Imported game loaded, but saving failed. Use Save to try again.',
          true,
        );
      }
      return true;
    } finally {
      this.finishOperation('import');
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
    void this.save('Autosaved');
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
      exportDisabled: busy,
      importDisabled: busy,
      confirmationDisabled: busy,
    };
  }

  private armAutosave(): void {
    this.autosaveDay = this.currentDay();
  }

  /**
   * Loads the stored slot into the running game. A slot that is empty, cut off
   * or otherwise unreadable falls back to the last good copy, which the store
   * restores while keeping the unreadable bytes aside. A slot from a version
   * this build does not support is never replaced, and an empty slot with no
   * copy holds nothing, so it counts as no save.
   */
  private async loadFromSlot(): Promise<SlotLoad> {
    const bytes = await this.store.load();
    if (bytes === null) return { kind: 'none' };
    if (bytes.byteLength > 0) {
      if (await this.loadSupportedSave(bytes)) return { kind: 'loaded' };
      const version = saveSchemaVersion(bytes);
      if (version !== null && !isSupportedSavePrefix(bytes)) {
        return { kind: 'unloadable', bytes };
      }
    }
    // Load the copy into the game first and replace the slot only once it
    // loads. Replacing first would swap in a copy this build might also reject.
    const lastGood = await this.store.lastGoodCopy();
    let copyLoaded = false;
    if (lastGood !== null && await this.loadSupportedSave(lastGood)) {
      copyLoaded = true;
      if (await this.store.restoreLastGood(bytes, lastGood)) return { kind: 'recovered' };
    }
    // The running game already holds a copy the slot could not take, such as
    // after another tab saved. Treating that slot as no save would let the next
    // autosave write the old copy over it, so keep saving paused instead.
    return bytes.byteLength === 0 && !copyLoaded ? { kind: 'none' } : { kind: 'unloadable', bytes };
  }

  private async loadSupportedSave(bytes: Uint8Array): Promise<boolean> {
    const version = saveSchemaVersion(bytes);
    if (version !== null && !isSupportedSavePrefix(bytes)) return false;
    return this.loadPrepared(bytes);
  }

  private resumeSaving(): void {
    this.savingPaused = false;
    this.protectedBytes = null;
  }

  /** Ends a rejected import or file choice, keeping the paused-saving note visible. */
  private keepCurrentGame(reason: string): void {
    this.showKeepingPausedNote(`${reason} Current game kept.`, true);
  }

  private refuseUnreplaceableSlot(): void {
    this.keepCurrentGame(
      'The saved data in this browser cannot be replaced. Export save to keep it, then New game, then import again.',
    );
  }

  /** While saving is paused, every message keeps saying so, since Save stays disabled. */
  private showKeepingPausedNote(message: string, error = false): void {
    if (!this.savingPaused) {
      this.show(message, error);
      return;
    }
    const sentence = message.endsWith('.') ? message : `${message}.`;
    this.show(`${sentence} Saving paused.`, true);
  }

  private protectSavedGame(bytes?: Uint8Array): void {
    this.savingPaused = true;
    // An empty slot holds nothing to protect or export. Keeping it would also
    // hide a save another tab has since written, so Export and Import re-read.
    const kept = bytes !== undefined && bytes.byteLength > 0 ? bytes : undefined;
    this.protectedBytes = kept ?? null;
    const reason = kept ? unloadableReason(kept, 'Load failed.') : 'Load failed.';
    this.show(
      `${reason} Current game and saved data kept. Saving paused. Retry Load or confirm New game to resume saving.`,
      true,
    );
  }

  private currentDay(): number {
    const dayTicks = this.sim.dayTicks();
    if (!Number.isFinite(dayTicks) || dayTicks <= 0) return 0;
    return Math.floor(this.sim.clockTick() / dayTicks);
  }

  private beginOperation(operation: PersistenceOperation): boolean {
    if (this.activeOperation !== null) return false;
    this.activeOperation = operation;
    return true;
  }

  private finishOperation(operation: PersistenceOperation): void {
    if (this.activeOperation === operation) this.activeOperation = null;
  }

  private show(message: string, error = false): void {
    this.status.textContent = message;
    if (error) this.status.setAttribute('data-kind', 'error');
    else this.status.removeAttribute('data-kind');
  }
}
