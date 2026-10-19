// Leaving Build mode - docs/specs/2026-10-13-build-confirmation.md. The
// footer's Confirm and Cancel finish the batch and keep paused Build open. Every way
// out (Exit build, the Build button, Escape with nothing selected) reaches the
// furniture builder's exit, whose beforeExit is `gate`: while a change is not
// confirmed, it opens a dialog instead of leaving. Escape anywhere on the page
// comes here too, so the dialog can take it wherever focus is.

import { logError } from '../diagnostics/log.js';

/** What leaving Build mode needs from the page. */
export interface BuildExitHooks {
  /** Whether leaving now would lose a change made since the last Confirm. */
  hasUnconfirmedChanges(): boolean;
  /** Applies the batch; false when it was refused, after the page says why. */
  confirm(): boolean | Promise<boolean>;
  /** Restores the latest confirmed batch while keeping Build open. */
  cancel(): boolean;
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
  /** Why the latest Confirm was refused, or empty when it was not refused with a reason. */
  refusal?(): string;
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
    : 'The changes could not be confirmed. Fix what the tool reports, or choose Cancel to undo the pending changes.';
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
 * opened or closed the dialog or left Build mode. Its second click would
 * otherwise land on whatever took the first one's place: the game, which can
 * order the selected housemate about, or a dialog button, such as Discard
 * changes over Exit build in the phone dock. The browser's own click count
 * decides what belongs to the double-click; this only bounds it.
 */
export const STRAY_CLICK_MS = 1000;

/** A pointer click: when it happened and the browser's count of clicks in its run. */
interface PointerClick { readonly at: number; readonly detail: number }

export class BuildExit {
  private readonly dialog: HTMLDialogElement;
  private readonly keep: HTMLButtonElement;
  /** The dialog's line for a refused Confirm changes, so Discard is offered beside the reason. */
  private readonly status: HTMLElement | null;
  /** What had focus before a Confirm changes that may be refused and ask again. */
  private reaskOpener: Element | null = null;
  /** True only while a chosen Confirm or Discard leaves, so `gate` lets it through. */
  private chosen = false;
  /** The pointer click that chose it, read before the Confirm or Discard did any work. */
  private chosenCause: PointerClick | null = null;
  /** What had focus when the dialog opened; it gets focus back if Build mode stays. */
  private opener: Element | null = null;
  /** The latest pointer click anywhere on the page. */
  private lastPointerClick: PointerClick | null = null;
  /** The pointer click that opened or closed the dialog or left Build mode, while the rest of its run is dropped. */
  private guardClick: PointerClick | null = null;
  private continuation = 0;
  private confirming = false;

  constructor(private readonly document: Document, private readonly hooks: BuildExitHooks,
    private readonly now: () => number = () => performance.now()) {
    const required = <T extends HTMLElement>(id: string): T => {
      const element = document.querySelector<T>(`#${id}`);
      if (!element) throw new Error(`Missing build exit controls: ${id}`);
      return element;
    };
    required('build-batch-confirm').addEventListener('click', () => { void this.confirmBatch(false, this.recentPointerClick()); });
    required('build-batch-cancel').addEventListener('click', () => {
      if (this.confirming) return;
      this.clearExitIntent(); this.hooks.cancel(); this.armAgainstTheRestOf(this.recentPointerClick());
    });
    this.dialog = required<HTMLDialogElement>('build-exit-dialog');
    this.keep = required<HTMLButtonElement>('build-exit-keep');
    this.status = document.querySelector<HTMLElement>('#build-exit-status');
    // The form's method is dialog, so each button closes it with its value;
    // the close event reads the answer.
    this.dialog.addEventListener('close', () => {
      // A pointer close arms the guard whether or not Build mode is left:
      // staying, the second click would land on the build instead.
      const cause = this.recentPointerClick();
      this.armAgainstTheRestOf(cause);
      this.answer(this.dialog.returnValue, cause);
    });
    // Capturing on the document runs before the game view's own click
    // listener, as input.ts does for a menu's stray click.
    document.addEventListener('click', event => this.onClick(event), true);
    // Bubbling, so the game view's own Escape and an open menu's come first.
    document.addEventListener('keydown', event => this.onKeydown(event));
  }

  /** Closes the dialog as Keep building, when something more urgent needs the screen. */
  dismiss(): void {
    this.clearExitIntent();
    if (this.dialog.open) this.dialog.close(KEEP);
  }
  clearExitIntent(): void { this.continuation++; }

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
    const guard = this.guardClick;
    if (guard) {
      // A count that does not go past the guarding click's starts a new run,
      // which is deliberate: a fresh click or double-click soon after goes through.
      if (event.detail <= guard.detail || this.now() - guard.at > STRAY_CLICK_MS) {
        this.guardClick = null;
      } else {
        // The rest of the run, wherever it lands, dialog buttons included.
        // Cancelling the click also stops a dialog button closing the form.
        event.preventDefault();
        event.stopPropagation();
        // Its press already moved focus to what it landed on.
        if (this.dialog.open) this.keep.focus();
        return;
      }
    }
    this.lastPointerClick = { at: this.now(), detail: event.detail };
  }

  /**
   * The pointer click that is closing the dialog or leaving Build mode, or
   * null for a keyboard close. Read on entry, before any slow work, so a
   * slow confirm, discard or redraw cannot age it out.
   */
  private recentPointerClick(): PointerClick | null {
    const click = this.lastPointerClick;
    return click && this.now() - click.at <= CAUSE_MS ? click : null;
  }

  /**
   * After a pointer click opened or closed the dialog or left Build mode, the
   * clicks that continue its run (a double-click's second, as the browser
   * counts them) are dropped. The keyboard passes null and changes nothing,
   * so it never clears a guard already armed.
   */
  private armAgainstTheRestOf(cause: PointerClick | null): void {
    if (cause) this.guardClick = cause;
  }

  /** The builder's beforeExit: true lets Build mode close now. */
  gate(): boolean {
    if (this.dialog.open || (this.confirming && !this.chosen)) return false;
    const cause = this.chosen ? this.chosenCause : this.recentPointerClick();
    if (!this.chosen && this.hooks.hasUnconfirmedChanges()) {
      this.ask();
      // A double-tap on Exit build must not land its second tap on a choice.
      this.armAgainstTheRestOf(cause);
      return false;
    }
    const discarded = this.hooks.discard();
    if (discarded) this.armAgainstTheRestOf(cause);
    return discarded;
  }

  /** Explicit exit confirmation may wait for native room adoption. */
  confirmAndLeave(): boolean | Promise<boolean> {
    return this.confirmAndLeaveFor(this.recentPointerClick());
  }

  /** Explicit Discard restores the baseline while leaving. */
  discardAndLeave(): boolean {
    return this.leaveAsChosen(this.recentPointerClick());
  }

  private confirmAndLeaveFor(cause: PointerClick | null): boolean | Promise<boolean> {
    return this.confirmBatch(true, cause);
  }
  private confirmBatch(leave: boolean, cause: PointerClick | null): boolean | Promise<boolean> {
    if (this.confirming) return false;
    this.confirming = true;
    const generation = ++this.continuation;
    const finish = (adopted: boolean) => {
      this.confirming = false;
      if (generation !== this.continuation) return false;
      if (!adopted) {
        if (leave) this.askAgain();
        return false;
      }
      this.armAgainstTheRestOf(cause);
      return leave ? this.leaveAsChosen(cause) : true;
    };
    const failed = (error: unknown) => {
      logError('Build', 'Confirm threw instead of answering.', { error });
      return finish(false);
    };
    try {
      const result = this.hooks.confirm();
      return typeof result === 'boolean' ? finish(result) : result.then(finish, failed);
    } catch (error) { return failed(error); }
  }

  /**
   * A refused Confirm changes asks again with the reason, so the player who
   * wanted to leave sees why and can still Discard changes or Keep building.
   */
  private askAgain(): void {
    const reason = this.hooks.refusal?.() ?? '';
    if (!reason || this.dialog.open) return;
    const opener = this.reaskOpener;
    this.ask(reason);
    if (opener) this.opener = opener;
  }

  private leaveAsChosen(cause: PointerClick | null): boolean {
    this.chosen = true;
    this.chosenCause = cause;
    try {
      return this.hooks.leave();
    } finally {
      this.chosen = false;
      this.chosenCause = null;
    }
  }

  private ask(reason = ''): void {
    this.hooks.beforeAsk?.();
    this.opener = this.document.activeElement;
    this.dialog.returnValue = '';
    if (this.status) this.status.textContent = reason;
    this.dialog.showModal();
    // The choice that changes nothing, so an accidental Enter is harmless.
    this.keep.focus();
  }

  private answer(value: string, cause: PointerClick | null): void {
    const opener = this.opener;
    this.opener = null;
    if (value !== CONFIRM) this.clearExitIntent();
    this.reaskOpener = opener;
    const left = value === CONFIRM ? this.confirmAndLeaveFor(cause)
      : value === DISCARD ? this.leaveAsChosen(cause) : false;
    // Leaving moves focus to the Build button; staying returns it, unless a
    // refused Confirm changes asked again and the dialog holds focus.
    if (typeof left === 'boolean' && !left && !this.dialog.open) this.restoreFocus(opener);
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
