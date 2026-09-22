// The Floors tool's buttons - [FL-tool]. Which tool is showing is the build
// tool switch's job, in build-tools.ts.

import { BARE, type FloorTool } from './floor-tool.js';

export class FloorToolControls {
  private readonly status: HTMLElement;
  private readonly keyboardHelp: HTMLElement;
  private readonly touchHelp: HTMLElement;
  private readonly buttons: ReadonlyArray<readonly [HTMLButtonElement, number]>;

  constructor(document: Document, private readonly tool: FloorTool) {
    const required = <T extends HTMLElement>(id: string): T => {
      const element = document.querySelector<T>(`#${id}`);
      if (!element) throw new Error(`Missing floor controls: ${id}`);
      return element;
    };
    this.status = required('floor-status');
    this.keyboardHelp = required('floor-keyboard-help');
    this.touchHelp = required('floor-touch-help');
    const row = required<HTMLElement>('floor-coverings');
    // The coverings are content, so their buttons are built here rather than
    // written into the page: a covering added to content/lot.toml appears
    // without a markup edit ([FL-content]).
    const buttons: Array<readonly [HTMLButtonElement, number]> = [];
    const add = (label: string, covering: number): void => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'hud-button';
      button.textContent = label;
      button.addEventListener('click', () => {
        tool.choose(covering);
        tool.apply();
      });
      row.append(button);
      buttons.push([button, covering]);
    };
    tool.coverings().forEach((name, index) => add(name, index + 1));
    add('Remove', BARE);
    this.buttons = buttons;
    this.render();
  }

  /** The phone layout reads the touch help, as the other tools' do. */
  setCompact(compact: boolean): void {
    this.keyboardHelp.hidden = compact;
    this.touchHelp.hidden = !compact;
  }

  render(): void {
    this.status.textContent = this.tool.status;
    for (const [button, covering] of this.buttons) {
      button.setAttribute('aria-pressed', String(covering === this.tool.chosen));
    }
  }
}
