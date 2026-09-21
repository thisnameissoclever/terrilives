// The Walls tool's buttons - [WT-shell]. Which tool is showing is the build
// tool switch's job, in build-tools.ts.

import { DOORWAY, OPEN, WALL, type WallStateCode, type WallTool } from './wall-tool.js';

export class WallToolControls {
  private readonly status: HTMLElement;
  private readonly keyboardHelp: HTMLElement;
  private readonly touchHelp: HTMLElement;
  private readonly buttons: ReadonlyArray<readonly [HTMLButtonElement, WallStateCode]>;

  constructor(document: Document, private readonly tool: WallTool) {
    const required = <T extends HTMLElement>(id: string): T => {
      const element = document.querySelector<T>(`#${id}`);
      if (!element) throw new Error(`Missing wall controls: ${id}`);
      return element;
    };
    this.status = required('wall-status');
    this.keyboardHelp = required('wall-keyboard-help');
    this.touchHelp = required('wall-touch-help');
    this.buttons = [
      [required<HTMLButtonElement>('wall-build'), WALL],
      [required<HTMLButtonElement>('wall-doorway'), DOORWAY],
      [required<HTMLButtonElement>('wall-remove'), OPEN],
    ];
    for (const [button, state] of this.buttons) {
      button.addEventListener('click', () => tool.apply(state));
    }
    this.render();
  }

  /** The phone layout reads the touch help, as the furniture tool's does. */
  setCompact(compact: boolean): void {
    this.keyboardHelp.hidden = compact;
    this.touchHelp.hidden = !compact;
  }

  render(): void {
    this.status.textContent = this.tool.status;
    for (const [button, state] of this.buttons) {
      button.disabled = !this.tool.canApply(state);
    }
  }
}
