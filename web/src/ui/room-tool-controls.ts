// The Room tool's controls - [RT-shell]: the status line, Build room and
// Cancel, and the help lines.

import type { RoomTool } from './room-tool.js';

export class RoomToolControls {
  private readonly status: HTMLElement;
  private readonly keyboardHelp: HTMLElement;
  private readonly touchHelp: HTMLElement;

  constructor(document: Document, private readonly tool: RoomTool) {
    const required = <T extends HTMLElement>(id: string): T => {
      const element = document.querySelector<T>(`#${id}`);
      if (!element) throw new Error(`Missing room controls: ${id}`);
      return element;
    };
    this.status = required('room-status');
    this.keyboardHelp = required('room-keyboard-help');
    this.touchHelp = required('room-touch-help');
    this.render();
  }

  /** CSS chooses the pointer hint; Shortcuts remains available in either layout. */
  setCompact(_compact: boolean): void {
    this.keyboardHelp.hidden = false;
    this.touchHelp.hidden = false;
  }

  render(): void {
    const tool = this.tool;
    this.status.textContent = tool.status;
  }
}
