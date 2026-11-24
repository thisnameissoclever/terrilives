import type {ScreenRect} from '../render/annotation-spread.js';

/**
 * The on-screen controls that can cover a bubble, the same set the
 * order-failure bubbles avoid: each block of the top-left panel, the Log
 * button, the Sim dock and sheet, and the debug panel. A hidden control
 * measures zero and covers nothing.
 */
const SELECTORS = '#hud > *, #activity-log-toggle, #sim-dock, #sim-sheet, #debug-panel';

export class BubbleControls {
  private elements: HTMLElement[] | null = null;
  private readonly out: ScreenRect[] = [];

  constructor(private readonly document: Document) {}

  /** The controls' rectangles in the canvas's own pixels. */
  rects(canvas: HTMLCanvasElement): readonly ScreenRect[] {
    this.elements ??= [...this.document.querySelectorAll<HTMLElement>(SELECTORS)];
    const view = canvas.getBoundingClientRect();
    const sx = view.width > 0 ? canvas.width / view.width : 1;
    const sy = view.height > 0 ? canvas.height / view.height : 1;
    this.out.length = 0;
    for (const element of this.elements) {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      this.out.push({left: (rect.left - view.left) * sx, top: (rect.top - view.top) * sy,
        width: rect.width * sx, height: rect.height * sy});
    }
    return this.out;
  }
}
