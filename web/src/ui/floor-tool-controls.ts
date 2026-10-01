// The Floors tool's buttons - [FL-tool]. Which tool is showing is the build
// tool switch's job, in build-tools.ts.

import type { FloorTool } from './floor-tool.js';

export class FloorToolControls {
  private readonly status: HTMLElement;
  private readonly keyboardHelp: HTMLElement;
  private readonly touchHelp: HTMLElement;

  constructor(document: Document, private readonly tool: FloorTool) {
    const required = <T extends HTMLElement>(id: string): T => {
      const element = document.querySelector<T>(`#${id}`);
      if (!element) throw new Error(`Missing floor controls: ${id}`);
      return element;
    };
    this.status = required('floor-status');
    this.keyboardHelp = required('floor-keyboard-help');
    this.touchHelp = required('floor-touch-help');
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
