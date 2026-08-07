import type { PreferenceStore } from './help-panel.js';

const LIGHTING_MODE_KEY = 'terrilives.lighting-mode.v1';

export interface LightingModeButton {
  textContent: string | null;
  disabled: boolean;
  setAttribute(name: string, value: string): void;
}

/**
 * Player control for [ML-a11y]'s flat-lighting mode.
 *
 * The saved preference and the system constraint are deliberately separate.
 * Reduced motion may force flat lighting for a while without overwriting what
 * the player chose, so clearing that constraint restores the saved choice.
 */
export class LightingMode {
  private persistedFlat: boolean;
  private systemFlat = false;

  constructor(
    private readonly button: LightingModeButton,
    private readonly store: PreferenceStore | null = null,
  ) {
    this.persistedFlat = this.readPersistedFlat();
    this.reflect();
  }

  /** Whether the renderer must currently use neutral, flat lighting. */
  isFlat(): boolean {
    return this.persistedFlat || this.systemFlat;
  }

  /**
   * Toggles the player's saved choice and returns the resulting effective mode.
   * A system-forced flat mode owns the control and leaves storage untouched.
   */
  toggle(): boolean {
    if (this.systemFlat) return true;

    this.persistedFlat = !this.persistedFlat;
    this.reflect();
    try {
      this.store?.setItem(LIGHTING_MODE_KEY, this.persistedFlat ? '1' : '0');
    } catch {
      // Storage denial must not undo a usable in-memory choice for this session.
    }
    return this.isFlat();
  }

  /** Applies or clears the runtime reduced-motion constraint. */
  setSystemFlat(active: boolean): void {
    this.systemFlat = active;
    this.reflect();
  }

  private readPersistedFlat(): boolean {
    try {
      return this.store?.getItem(LIGHTING_MODE_KEY) === '1';
    } catch {
      return false;
    }
  }

  private reflect(): void {
    const flat = this.isFlat();
    this.button.textContent = flat ? 'Light: flat' : 'Light: auto';
    this.button.setAttribute('aria-pressed', String(flat));
    this.button.disabled = this.systemFlat;
  }
}
