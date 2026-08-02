const HELP_DISMISSED_KEY = 'terrilives.help-dismissed.v1';

export interface PreferenceStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface HelpDialog {
  readonly open: boolean;
  scrollTop: number;
  showModal(): void;
  close(): void;
}

export interface FocusTarget {
  focus(): void;
}

/** Storage can be denied even when localStorage exists, so failure means show. */
export function shouldShowHelp(store: PreferenceStore | null): boolean {
  if (store === null) return true;
  try {
    return store.getItem(HELP_DISMISSED_KEY) !== '1';
  } catch {
    return true;
  }
}

export class HelpPanel {
  constructor(
    private readonly root: HelpDialog,
    private readonly start: FocusTarget,
    private readonly store: PreferenceStore | null,
  ) {}

  /** Opens on a first visit and reports whether it took ownership of focus. */
  showOnFirstRun(): boolean {
    if (!shouldShowHelp(this.store)) return false;
    return this.open();
  }

  /** Opens modally at the beginning of the instructions. */
  open(): boolean {
    if (this.root.open) return false;
    this.root.showModal();
    this.root.scrollTop = 0;
    this.start.focus();
    return true;
  }

  close(): boolean {
    const wasOpen = this.root.open;
    if (wasOpen) this.root.close();
    try {
      this.store?.setItem(HELP_DISMISSED_KEY, '1');
    } catch {
      // The help still closes for this session when browser preferences are
      // blocked. It will appear again next time instead of breaking the game.
    }
    return wasOpen;
  }
}
