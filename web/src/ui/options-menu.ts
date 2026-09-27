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

/** The page parts the flyout's listeners need; a narrow view of the DOM. */
export interface OptionsDocument {
  readonly activeElement: unknown;
  addEventListener(type: 'pointerdown', listener: (event: { target: unknown }) => void): void;
  addEventListener(
    type: 'keydown',
    listener: (event: OptionsKeyEvent) => void,
    capture: boolean,
  ): void;
}

export interface OptionsKeyEvent {
  readonly key: string;
  readonly target: unknown;
  readonly defaultPrevented: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}

export interface OptionsElements {
  /** The flyout's wrapper: the gear and the panel. */
  contains(node: unknown): boolean;
}

export interface OptionsGear {
  addEventListener(type: 'click', listener: () => void): void;
  focus(): void;
}

/**
 * Wires the flyout to the page - [OF2]. The gear toggles it; a press
 * outside it closes it. Escape is caught on the way down (the capture
 * phase), before the game view's own key handler and Build's, so one Escape
 * closes an open panel and does nothing else. Escape inside a dialog is the
 * dialog's. `insideDialog` answers whether a key's target is in a dialog.
 */
export function attachOptionsMenu(
  doc: OptionsDocument,
  root: OptionsElements,
  gear: OptionsGear,
  menu: OptionsMenu,
  insideDialog: (target: unknown) => boolean,
): void {
  gear.addEventListener('click', () => menu.toggle());
  doc.addEventListener('pointerdown', (event) => menu.pointerDown(root.contains(event.target)));
  doc.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || insideDialog(event.target)) return;
    const focusWasInside = root.contains(doc.activeElement);
    if (!menu.handleKey(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (focusWasInside) gear.focus();
  }, true);
}
