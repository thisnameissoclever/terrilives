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

/** What the page reads to decide whether leaving would lose a change. */
export interface BuildDraftSources {
  readonly session: { hasChanges(): boolean };
  readonly furniture: { readonly hasPlacementChange: boolean; readonly pending: boolean };
  /** Every other Build mode controller; its `pending` is null or false while nothing is on its way. */
  readonly tools: readonly { readonly pending: boolean | number | string | null }[];
  pendingBookCommands(): number;
}

/** No build or book command is on its way to the draft. */
export function buildCommandsIdle(sources: Omit<BuildDraftSources, 'session'>): boolean {
  return !sources.furniture.pending
    && sources.tools.every(tool => tool.pending === null || tool.pending === false)
    && sources.pendingBookCommands() === 0;
}

/**
 * Whether leaving now would lose a change: the draft differs from the last
 * Confirm, a furniture move is shown but not placed, or a command is on its way.
 */
export function hasUnconfirmedChanges(sources: BuildDraftSources): boolean {
  return sources.session.hasChanges() || sources.furniture.hasPlacementChange || !buildCommandsIdle(sources);
}

/** The footer's status when Confirm is refused. */
export function confirmRefusal(furnitureMoveShown: boolean): string {
  return furnitureMoveShown
    ? 'Move the furniture somewhere it fits, or choose Cancel beside it, before confirming.'
    : 'The changes could not be confirmed. Try Confirm again.';
}

/** The values of the dialog's buttons. Escape closes it with neither. */
const CONFIRM = 'confirm';
const DISCARD = 'discard';
const KEEP = 'keep';
/**
 * How long a pointer click outside the dialog is ignored after the dialog
 * closes or Build mode is left. A double-click on a dialog button, or on the
 * footer's Confirm or Cancel, otherwise lands its second click on the game,
 * which can order the selected housemate about. The usual double-click
 * interval on Windows is 500 ms.
 */
export const STRAY_CLICK_MS = 500;

export class BuildExit {
  private readonly dialog: HTMLDialogElement;
  private readonly keep: HTMLButtonElement;
  /** True only while a chosen Confirm or Discard leaves, so `gate` lets it through. */
  private chosen = false;
  /** What had focus when the dialog opened; it gets focus back if Build mode stays. */
  private opener: Element | null = null;
  /** When the dialog last closed or Build mode was last left from here. */
  private strayClicksFrom = -Infinity;

  constructor(private readonly document: Document, private readonly hooks: BuildExitHooks,
    private readonly now: () => number = () => performance.now()) {
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
    this.dialog.addEventListener('close', () => {
      this.strayClicksFrom = this.now();
      this.answer(this.dialog.returnValue);
    });
    // Escape held from the game view opens the dialog, and its repeats then
    // reach the dialog: cancelling them keeps it open until a fresh press.
    this.dialog.addEventListener('keydown', event => {
      if (event.key === 'Escape' && event.repeat) event.preventDefault();
    });
    // Capturing on the document runs before the game view's own click
    // listener, as input.ts does for a menu's stray click.
    document.addEventListener('click', event => this.ignoreStrayClick(event), true);
  }

  /** Closes the dialog as Keep building, when something more urgent needs the screen. */
  dismiss(): void {
    if (this.dialog.open) this.dialog.close(KEEP);
  }

  private ignoreStrayClick(event: MouseEvent): void {
    // A keyboard activation has no click count, and is never a stray.
    if (event.detail === 0 || this.now() - this.strayClicksFrom > STRAY_CLICK_MS) return;
    const target = event.target as Element | null;
    if (typeof target?.closest === 'function' && target.closest('dialog[open]')) return;
    event.preventDefault();
    event.stopPropagation();
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
      const left = this.hooks.leave();
      if (left) this.strayClicksFrom = this.now();
      return left;
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
