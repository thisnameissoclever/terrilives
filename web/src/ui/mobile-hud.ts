/** Compact-screen ownership for the existing HUD nodes. */

export const COMPACT_HUD_MEDIA_QUERY =
  '(max-width: 600px), (max-height: 480px)';

export interface MobileHudRoot {
  setAttribute(name: string, value: string): void;
}

export interface MobileHudButton {
  hidden: boolean;
  textContent: string | null;
  setAttribute(name: string, value: string): void;
}

export interface MobileHudDetails {
  open: boolean;
}

/**
 * Keeps compact screens on a status strip until the player asks for the HUD.
 * The existing controls remain the only controls; this class owns visibility,
 * not simulation state or duplicated mobile actions.
 */
export class MobileHud {
  private compact = false;
  private open = false;
  private editing: { panels: boolean[]; menuOpen: boolean; compact: boolean } | null = null;

  constructor(
    private readonly root: MobileHudRoot,
    private readonly button: MobileHudButton,
    private readonly details: readonly MobileHudDetails[],
  ) {
    this.reflect();
  }

  /** Applies the current responsive mode and closes a newly compact HUD. */
  setCompact(compact: boolean): void {
    if (compact && !this.compact) {
      this.open = false;
      for (const panel of this.details) panel.open = false;
    }
    this.compact = compact;
    this.reflect();
  }

  /** Toggles only in compact mode and returns whether the menu is now open. */
  toggle(): boolean {
    if (!this.compact) return false;
    this.open = !this.open;
    this.reflect();
    return this.open;
  }

  beginEditing(): void {
    if (this.editing) return;
    this.editing = { panels: this.details.map(panel => panel.open), menuOpen: this.open, compact: this.compact };
    for (const panel of this.details) panel.open = false;
    this.open = false;
    this.reflect();
  }

  endEditing(): void {
    if (!this.editing) return;
    const saved = this.editing;
    this.editing = null;
    if (!this.compact || saved.compact === this.compact) {
      this.details.forEach((panel, index) => { panel.open = saved.panels[index]; });
    }
    if (saved.compact === this.compact) this.open = saved.menuOpen;
    this.reflect();
  }

  private reflect(): void {
    const expanded = this.compact && this.open;
    this.root.setAttribute('data-mobile-open', String(expanded));
    this.button.hidden = !this.compact;
    this.button.textContent = expanded ? 'Close' : 'Menu';
    this.button.setAttribute('aria-expanded', String(expanded));
    this.button.setAttribute(
      'aria-label',
      expanded ? 'Close game menu' : 'Open game menu',
    );
  }
}
