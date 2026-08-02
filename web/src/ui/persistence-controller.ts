import type { SaveStore } from '../storage/save-store.js';

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

/**
 * Player-facing save lifecycle over one storage slot.
 */
export class PersistenceController {
  private autosaveDay = 0;
  private savedGameAvailable = false;

  constructor(
    private readonly store: SaveStore,
    private readonly sim: PersistableSim,
    private readonly status: SaveStatusTarget,
    private readonly reportError: (error: unknown) => void = () => {},
  ) {}

  async restoreAtStartup(): Promise<StartupRestore> {
    try {
      const bytes = await this.store.load();
      if (bytes === null) {
        this.savedGameAvailable = false;
        this.armAutosave();
        this.show('No save yet');
        return 'new';
      }
      if (!this.sim.loadBytes(bytes)) {
        this.savedGameAvailable = false;
        this.armAutosave();
        this.show('Saved game is invalid. Starting a new game.', true);
        return 'invalid';
      }
      this.armAutosave();
      this.savedGameAvailable = true;
      this.show('Saved game loaded');
      return 'loaded';
    } catch (error: unknown) {
      this.reportError(error);
      this.armAutosave();
      this.show('Saving is unavailable. Starting a new game.', true);
      return 'unavailable';
    }
  }

  async save(message = 'Game saved'): Promise<boolean> {
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
    }
  }

  async load(): Promise<boolean> {
    this.show('Loading');
    try {
      const bytes = await this.store.load();
      if (bytes === null) {
        this.savedGameAvailable = false;
        this.show('No saved game found', true);
        return false;
      }
      if (!this.sim.loadBytes(bytes)) {
        this.savedGameAvailable = false;
        this.show('Load failed. Current game kept.', true);
        return false;
      }
      this.armAutosave();
      this.savedGameAvailable = true;
      this.show('Saved game loaded');
      return true;
    } catch (error: unknown) {
      this.reportError(error);
      this.show('Load failed. Current game kept.', true);
      return false;
    }
  }

  async clear(): Promise<boolean> {
    try {
      await this.store.clear();
      this.savedGameAvailable = false;
      return true;
    } catch (error: unknown) {
      this.reportError(error);
      this.show('Could not remove the saved game.', true);
      return false;
    }
  }

  /** Called from the frame loop. It schedules at most one save per new day. */
  updateAutosave(): void {
    const day = this.currentDay();
    if (day <= this.autosaveDay) return;
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

  private armAutosave(): void {
    this.autosaveDay = this.currentDay();
  }

  private currentDay(): number {
    const dayTicks = this.sim.dayTicks();
    if (!Number.isFinite(dayTicks) || dayTicks <= 0) return 0;
    return Math.floor(this.sim.clockTick() / dayTicks);
  }

  private show(message: string, error = false): void {
    this.status.textContent = message;
    if (error) this.status.setAttribute('data-kind', 'error');
    else this.status.removeAttribute('data-kind');
  }
}
