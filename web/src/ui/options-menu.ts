/**
 * The Options flyout - [OF2] in `docs/specs/2026-09-22-options-flyout.md`.
 * A gear at the window's top right opens one panel holding Light, Build, the
 * sound controls and the game actions, on every screen size.
 *
 * This is presentation state only, like `MobileHud`: opening it pauses
 * nothing and sends no command. The controls inside keep their own
 * controllers. Escape and a pointer-down outside close it, the way the
 * right-click flyout closes.
 */

/** The gear button: only its expanded state is written. */
export interface OptionsToggle {
  setAttribute(name: string, value: string): void;
}

/** The panel: shown and hidden through its `hidden` attribute. */
export interface OptionsPanel {
  hidden: boolean;
}

export class OptionsMenu {
  private open_ = false;

  constructor(
    private readonly toggleButton: OptionsToggle,
    private readonly panel: OptionsPanel,
  ) {
    this.reflect();
  }

  isOpen(): boolean {
    return this.open_;
  }

  open(): void {
    if (this.open_) return;
    this.open_ = true;
    this.reflect();
  }

  /** Closes the panel; true when it was open, so the caller can move focus. */
  close(): boolean {
    if (!this.open_) return false;
    this.open_ = false;
    this.reflect();
    return true;
  }

  /** Opens a closed panel or closes an open one; returns the new state. */
  toggle(): boolean {
    if (this.open_) this.close();
    else this.open();
    return this.open_;
  }

  /** Escape closes an open panel and reports that it was handled. */
  handleKey(key: string): boolean {
    return key === 'Escape' && this.close();
  }

  /**
   * A pointer-down outside the flyout closes it. One inside, on the gear or
   * a control, must not: the gear toggles on its own click, and a control's
   * press has to reach the control.
   */
  pointerDown(insideFlyout: boolean): void {
    if (!insideFlyout) this.close();
  }

  private reflect(): void {
    this.panel.hidden = !this.open_;
    this.toggleButton.setAttribute('aria-expanded', String(this.open_));
  }
}
