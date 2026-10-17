// Leaving Build mode - docs/specs/2026-10-13-build-confirmation.md. The
// footer's Confirm and Cancel finish the batch and then leave. Every other way
// out (Exit build, the Build button, Escape with nothing selected) reaches the
// furniture builder's exit, whose beforeExit is `gate`: while a change is not
// confirmed, it opens a dialog instead of leaving. Escape anywhere on the page
// comes here too, so the dialog can take it wherever focus is.

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
  /** Escape in Build mode with the dialog closed: clears the selection, or asks to leave. */
  escapeBuild(): void;
  /** Whether Build mode reads Escape now: building, with no menu or other dialog in the way. */
  escapeAllowed(): boolean;
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
 * A pointer click this soon before the dialog closes or Build mode is left
 * is the click that did it. The close event follows its click within a task.
 */
const CAUSE_MS = 250;
/**
 * The longest the rest of a double-click is watched for after the click that
 * closed the dialog or left Build mode. Its second click would otherwise land
 * on the game and could order the selected housemate about. The browser's own
 * click count decides what belongs to the double-click; this only bounds it.
 */
export const STRAY_CLICK_MS = 1000;

/** A pointer click: when it happened and the browser's count of clicks in its run. */
interface PointerClick { readonly at: number; readonly detail: number }

export class BuildExit {
  private readonly dialog: HTMLDialogElement;
  private readonly keep: HTMLButtonElement;
  /** True only while a chosen Confirm or Discard leaves, so `gate` lets it through. */
  private chosen = false;
  /** What had focus when the dialog opened; it gets focus back if Build mode stays. */
  private opener: Element | null = null;
  /** The latest pointer click anywhere on the page. */
  private lastPointerClick: PointerClick | null = null;
  /** The pointer click that closed the dialog or left Build mode, while the rest of its run is dropped. */
  private closingClick: PointerClick | null = null;

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
    // The form's method is dialog, so each button closes it with its value;
    // the close event reads the answer.
    this.dialog.addEventListener('close', () => {
      this.watchForTheRestOfTheClick();
      this.answer(this.dialog.returnValue);
    });
    // Capturing on the document runs before the game view's own click
    // listener, as input.ts does for a menu's stray click.
    document.addEventListener('click', event => this.onClick(event), true);
    // Bubbling, so the game view's own Escape and an open menu's come first.
    document.addEventListener('keydown', event => this.onKeydown(event));
  }

  /** Closes the dialog as Keep building, when something more urgent needs the screen. */
  dismiss(): void {
    if (this.dialog.open) this.dialog.close(KEEP);
  }

  /**
   * Escape in Build mode, from the game view or anywhere else on the page.
   * While the dialog is open it is Keep building and the build behind is left
   * alone. A held key counts once: its repeats do nothing.
   */
  pressEscape(repeat: boolean): void {
    if (repeat) return;
    if (this.dialog.open) this.dialog.close(KEEP);
    else this.hooks.escapeBuild();
  }

  private onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || event.defaultPrevented || !this.hooks.escapeAllowed()) return;
    if (!this.dialog.open) {
      // Another dialog or a text field keeps its own Escape.
      const target = event.target as Element | null;
      if (typeof target?.closest === 'function'
        && target.closest('dialog, input, textarea, select, [contenteditable="true"]')) return;
    }
    this.pressEscape(event.repeat);
    // The browser's own close request would close the dialog with no answer,
    // or reopen nothing on a repeat; this listener has answered already.
    event.preventDefault();
  }

  private onClick(event: MouseEvent): void {
    // A keyboard activation has no click count: neither a cause nor a stray.
    if (event.detail === 0) return;
    const closing = this.closingClick;
    if (closing && this.now() - closing.at <= STRAY_CLICK_MS && event.detail > closing.detail) {
      const target = event.target as Element | null;
      if (!(typeof target?.closest === 'function' && target.closest('dialog[open]'))) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    }
    this.lastPointerClick = { at: this.now(), detail: event.detail };
  }

  /**
   * After the dialog closes or Build mode is left: when a pointer click did
   * it, the clicks that continue its run (a double-click's second, as the
   * browser counts them) are dropped. A later separate click starts a new run
   * and goes through, as do keyboard closes, which arm nothing.
   */
  private watchForTheRestOfTheClick(): void {
    const click = this.lastPointerClick;
    this.closingClick = click && this.now() - click.at <= CAUSE_MS ? click : null;
  }

  /** The builder's beforeExit: true lets Build mode close now. */
  gate(): boolean {
    if (this.dialog.open) return false;
    if (!this.chosen && this.hooks.hasUnconfirmedChanges()) {
      this.ask();
      return false;
    }
    const discarded = this.hooks.discard();
    if (discarded) this.watchForTheRestOfTheClick();
    return discarded;
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
