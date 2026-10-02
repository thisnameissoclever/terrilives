// The Floors tool's buttons - [FL-tool]. Which tool is showing is the build
// tool switch's job, in build-tools.ts.

import { type FloorTool } from './floor-tool.js';
import { drawFloorSwatch } from './floor-swatches.js';

export class FloorToolControls {
  private readonly status: HTMLElement;
  private readonly keyboardHelp: HTMLElement;
  private readonly touchHelp: HTMLElement;
  private readonly retryButton: HTMLButtonElement | undefined;

  constructor(document: Document, private readonly tool: FloorTool,
    swatch: (canvas: HTMLCanvasElement, covering: number) => Promise<void> = drawFloorSwatch,
    retry?: () => void) {
    const required = <T extends HTMLElement>(id: string): T => {
      const element = document.querySelector<T>(`#${id}`);
      if (!element) throw new Error(`Missing floor controls: ${id}`);
      return element;
    };
    this.status = required('floor-status');
    this.keyboardHelp = required('floor-keyboard-help');
    this.touchHelp = required('floor-touch-help');
    const samples = document.querySelector<HTMLElement>('#floor-material-samples');
    if (samples) for (const [index, name] of tool.coverings().entries()) {
      const sample = document.createElement('div'); sample.textContent = name;
      const canvas = document.createElement('canvas'); canvas.width = 48; canvas.height = 32;
      canvas.setAttribute('aria-hidden', 'true'); sample.append(canvas); samples.append(sample);
      void swatch(canvas, index + 1).catch(() => { canvas.hidden = true; });
    }
    this.retryButton = document.querySelector<HTMLButtonElement>('#floor-material-retry') ?? undefined;
    if (retry) this.retryButton?.addEventListener('click', retry);
    this.render();
  }

  /** CSS chooses the pointer hint; Shortcuts remains available in either layout. */
  setCompact(_compact: boolean): void {
    this.keyboardHelp.hidden = false;
    this.touchHelp.hidden = false;
  }

  render(): void {
    this.status.textContent = this.tool.resourceStatus ?? this.tool.status;
    if (this.retryButton) this.retryButton.hidden = !this.tool.resourceFailed;
  }
}
