const HELP_DISMISSED_KEY = 'terrilives.help-dismissed.v1';

export interface PreferenceStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface HelpRoot {
  hidden: boolean;
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
    private readonly root: HelpRoot,
    private readonly store: PreferenceStore | null,
  ) {}

  showOnFirstRun(): void {
    this.root.hidden = !shouldShowHelp(this.store);
  }

  open(): void {
    this.root.hidden = false;
  }

  close(): void {
    this.root.hidden = true;
    try {
      this.store?.setItem(HELP_DISMISSED_KEY, '1');
    } catch {
      // The help still closes for this session when browser preferences are
      // blocked. It will appear again next time instead of breaking the game.
    }
  }
}
