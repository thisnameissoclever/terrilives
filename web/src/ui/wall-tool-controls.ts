// The tool switch and the Walls tool's buttons - [WT-shell]. The furniture
// controls keep their own class; this one only decides which set is showing
// and drives the three wall buttons.

import { DOORWAY, OPEN, WALL, type WallStateCode, type WallTool } from './wall-tool.js';

export interface BuildToolHooks {
  /** Switching to Walls drops any furniture preview, so only one is ever drawn. */
  leaveFurniture(): void;
}

export class WallToolControls {
  private readonly furnitureTool: HTMLButtonElement;
  private readonly wallsTool: HTMLButtonElement;
  private readonly furniturePanel: HTMLElement;
  private readonly wallPanel: HTMLElement;
  private readonly status: HTMLElement;
  private readonly buttons: ReadonlyArray<readonly [HTMLButtonElement, WallStateCode]>;

  constructor(document: Document, private readonly tool: WallTool, hooks: BuildToolHooks) {
    const required = <T extends HTMLElement>(id: string): T => {
      const element = document.querySelector<T>(`#${id}`);
      if (!element) throw new Error(`Missing wall controls: ${id}`);
      return element;
    };
    this.furnitureTool = required('build-tool-furniture');
    this.wallsTool = required('build-tool-walls');
    this.furniturePanel = required('furniture-tool');
    this.wallPanel = required('wall-tool');
    this.status = required('wall-status');
    this.buttons = [
      [required<HTMLButtonElement>('wall-build'), WALL],
      [required<HTMLButtonElement>('wall-doorway'), DOORWAY],
      [required<HTMLButtonElement>('wall-remove'), OPEN],
    ];
    this.furnitureTool.addEventListener('click', () => tool.exit());
    this.wallsTool.addEventListener('click', () => {
      hooks.leaveFurniture();
      tool.enter();
    });
    for (const [button, state] of this.buttons) {
      button.addEventListener('click', () => tool.apply(state));
    }
    this.render();
  }

  render(): void {
    const walls = this.tool.active;
    this.furnitureTool.setAttribute('aria-pressed', String(!walls));
    this.wallsTool.setAttribute('aria-pressed', String(walls));
    this.furniturePanel.hidden = walls;
    this.wallPanel.hidden = !walls;
    this.status.textContent = this.tool.status;
    for (const [button, state] of this.buttons) {
      button.disabled = !this.tool.canApply(state);
    }
  }
}
