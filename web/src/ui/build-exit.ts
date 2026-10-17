// Leaving Build mode - docs/specs/2026-10-13-build-confirmation.md. The
// footer's Confirm and Cancel finish the batch and then leave. Every other way
// out (Exit build, the Build button, Escape with nothing selected) reaches the
// furniture builder's exit, whose beforeExit is `gate`: while a change is not
// confirmed, it opens a dialog instead of leaving.

/** What leaving Build mode needs from the page. */
export interface BuildExitHooks {
  /** Whether leaving now would lose a change made since the last Confirm. */
  hasUnconfirmedChanges(): boolean;
  /** Applies the batch; false when it was refused, after the page says why. */
  confirm(): boolean;
  /** Discards what is not confirmed and ends the batch; false when it could not, after saying so. */
  discard(): boolean;
  /** Leaves Build mode through the builder, which calls `gate`; true once Build mode is closed. */
  leave(): boolean;
  /** Gives the game view focus when the control that asked to leave cannot take it back. */
  focusView(): void;
  /** Closes anything the dialog would otherwise leave open behind it. */
  beforeAsk?(): void;
}

/** The values of the dialog's buttons. Escape closes it with neither. */
const CONFIRM = 'confirm';
const DISCARD = 'discard';

export class BuildExit {
  private readonly dialog: HTMLDialogElement;
  private readonly keep: HTMLButtonElement;
  /** True only while a chosen Confirm or Discard leaves, so `gate` lets it through. */
  private chosen = false;
  /** What had focus when the dialog opened; it gets focus back if Build mode stays. */
  private opener: Element | null = null;

  constructor(private readonly document: Document, private readonly hooks: BuildExitHooks) {
    const required = <T extends HTMLElement>(id: string): T => {
      const element = document.querySelector<T>(`#${id}`);
      if (!element) throw new Error(`Missing build exit controls: ${id}`);
      return element;
    };
    required('build-batch-confirm').addEventListener('click', () => { this.confirmAndLeave(); });
    required('build-batch-cancel').addEventListener('click', () => { this.discardAndLeave(); });
    this.dialog = required<HTMLDialogElement>('build-exit-dialog');
    this.keep = required<HTMLButtonElement>('build-exit-keep');
    // The form's method is dialog, so each button closes it with its value
    // and Escape closes it with none; the close event reads the answer.
    this.dialog.addEventListener('close', () => this.answer(this.dialog.returnValue));
  }

  /** The builder's beforeExit: true lets Build mode close now. */
  gate(): boolean {
    if (this.dialog.open) return false;
    if (!this.chosen && this.hooks.hasUnconfirmedChanges()) {
      this.ask();
      return false;
    }
    return this.hooks.discard();
  }

  /** The footer's Confirm and the dialog's Confirm changes. */
  confirmAndLeave(): boolean {
    return this.hooks.confirm() && this.leaveAsChosen();
  }

  /** The footer's Cancel and the dialog's Discard changes. */
  discardAndLeave(): boolean {
    return this.leaveAsChosen();
  }

  private leaveAsChosen(): boolean {
    this.chosen = true;
    try {
      return this.hooks.leave();
    } finally {
      this.chosen = false;
    }
  }

  private ask(): void {
    this.hooks.beforeAsk?.();
    this.opener = this.document.activeElement;
    this.dialog.returnValue = '';
    this.dialog.showModal();
    // The choice that changes nothing, so an accidental Enter is harmless.
    this.keep.focus();
  }

  private answer(value: string): void {
    const opener = this.opener;
    this.opener = null;
    const left = value === CONFIRM ? this.confirmAndLeave()
      : value === DISCARD ? this.discardAndLeave() : false;
    // Leaving moves focus to the Build button; staying returns it.
    if (!left) this.restoreFocus(opener);
  }

  private restoreFocus(opener: Element | null): void {
    const target = opener as HTMLButtonElement | null;
    if (target && target !== this.document.body && target.isConnected && !target.disabled
      && typeof target.focus === 'function') {
      target.focus({ preventScroll: true });
    } else {
      this.hooks.focusView();
    }
  }
}
