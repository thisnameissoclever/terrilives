// The Land tool's controls - rule 8 of docs/specs/2026-10-17-land-expansion.md:
// the three strip buttons, the quote, Buy land, and the confirmation that
// repeats the total before anything is sent. Which tool is showing is the
// build tool switch's job, in build-tools.ts.

import { describeConfirmation, SIDE_NAMES, SIDES, type LandTool } from './land-tool.js';

/** The confirmation dialog, as the document gives it. */
export interface LandDialog {
  readonly open: boolean;
  showModal(): void;
  close(): void;
  addEventListener(type: 'close', listener: () => void): void;
}

export class LandToolControls {
  private readonly sides: readonly HTMLButtonElement[];
  private readonly status: HTMLElement;
  private readonly buy: HTMLButtonElement;
  private readonly keyboardHelp: HTMLElement;
  private readonly touchHelp: HTMLElement;
  private readonly dialog: HTMLDialogElement;
  private readonly dialogText: HTMLElement;
  private readonly confirm: HTMLButtonElement;

  constructor(document: Document, private readonly tool: LandTool) {
    const required = <T extends HTMLElement>(id: string): T => {
      const element = document.querySelector<T>(`#${id}`);
      if (!element) throw new Error(`Missing land controls: ${id}`);
      return element;
    };
    this.sides = SIDES.map(side => required<HTMLButtonElement>(`land-side-${side}`));
    this.sides.forEach((button, side) => {
      button.textContent = SIDE_NAMES[SIDES[side]];
      button.addEventListener('click', () => tool.choose(side));
    });
    this.status = required('land-status');
    this.buy = required<HTMLButtonElement>('land-buy');
    this.buy.addEventListener('click', () => tool.requestBuy());
    this.keyboardHelp = required('land-keyboard-help');
    this.touchHelp = required('land-touch-help');
    this.dialog = required<HTMLDialogElement>('land-dialog');
    this.dialogText = required('land-dialog-text');
    this.confirm = required<HTMLButtonElement>('land-dialog-confirm');
    // The form's method is dialog, so either button closes it; the close
    // event is where the answer is read, and Escape lands here too.
    this.dialog.addEventListener('close', () => {
      if (this.dialog.returnValue === 'confirm') tool.confirmBuy();
      else tool.cancelConfirmation();
      this.buy.focus({ preventScroll: true });
    });
    this.render();
  }

  /** CSS chooses the pointer hint; Shortcuts remains available in either layout. */
  setCompact(_compact: boolean): void {
    this.keyboardHelp.hidden = false;
    this.touchHelp.hidden = false;
  }

  render(): void {
    const tool = this.tool;
    const busy = tool.blocked || tool.pending;
    this.sides.forEach((button, side) => {
      button.setAttribute('aria-pressed', String(tool.side === side));
      button.disabled = busy;
    });
    this.status.textContent = tool.status;
    this.status.setAttribute('data-valid', String(tool.side === null || tool.chosenQuote()?.affordable !== false));
    this.buy.disabled = busy || tool.side === null;
    const quote = tool.confirming ? tool.chosenQuote() : null;
    if (quote !== null && tool.confirming) {
      this.dialogText.textContent = describeConfirmation(quote);
      this.confirm.hidden = !quote.affordable;
      if (!this.dialog.open) {
        this.dialog.returnValue = '';
        this.dialog.showModal();
      }
    } else if (this.dialog.open) {
      this.dialog.close('cancel');
    }
  }
}
