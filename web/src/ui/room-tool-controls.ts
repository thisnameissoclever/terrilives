// The Room tool's controls - [RT-shell]: the status line, Build room and
// Cancel, and the help lines.

import type { RoomTool } from './room-tool.js';

export class RoomToolControls {
  private readonly status: HTMLElement;
  private readonly build: HTMLButtonElement;
  private readonly cancel: HTMLButtonElement;
  private readonly keyboardHelp: HTMLElement;
  private readonly touchHelp: HTMLElement;

  constructor(document: Document, private readonly tool: RoomTool) {
    const required = <T extends HTMLElement>(id: string): T => {
      const element = document.querySelector<T>(`#${id}`);
      if (!element) throw new Error(`Missing room controls: ${id}`);
      return element;
    };
    this.status = required('room-status');
    this.build = required('room-build');
    this.cancel = required('room-cancel');
    this.keyboardHelp = required('room-keyboard-help');
    this.touchHelp = required('room-touch-help');
    this.build.addEventListener('click', () => tool.build());
    this.cancel.addEventListener('click', () => tool.cancel());
    this.render();
  }

  /** The phone layout reads the touch help, as the other tools' do. */
  setCompact(compact: boolean): void {
    this.keyboardHelp.hidden = compact;
    this.touchHelp.hidden = !compact;
  }

  render(): void {
    const tool = this.tool;
    this.status.textContent = tool.status;
    this.build.disabled = !tool.canBuild;
    this.cancel.disabled = tool.first === null || tool.pending || tool.blocked;
  }
}
