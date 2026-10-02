// The Walls tool's buttons - [WT-shell]. Which tool is showing is the build
// tool switch's job, in build-tools.ts.

import type { WallTool } from './wall-tool.js';

export class WallToolControls {
  private readonly status: HTMLElement;
  private readonly keyboardHelp: HTMLElement;
  private readonly touchHelp: HTMLElement;

  constructor(document: Document, private readonly tool: WallTool) {
    const required = <T extends HTMLElement>(id: string): T => {
      const element = document.querySelector<T>(`#${id}`);
      if (!element) throw new Error(`Missing wall controls: ${id}`);
      return element;
    };
    this.status = required('wall-status');
    this.keyboardHelp = required('wall-keyboard-help');
    this.touchHelp = required('wall-touch-help');
    this.render();
  }

  /** CSS chooses the pointer hint; Shortcuts remains available in either layout. */
  setCompact(_compact: boolean): void {
    this.keyboardHelp.hidden = false;
    this.touchHelp.hidden = false;
  }

  render(): void {
    this.status.textContent = this.tool.status;
  }
}
