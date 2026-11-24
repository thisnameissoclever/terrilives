import type {ControlRects} from '../render/annotation-spread.js';

/**
 * The on-screen controls that can cover a bubble: each block of the
 * top-left panel, the Log button and the open Log, the Options panel, the
 * object menu, the Sim dock and sheet, and the debug panel. A hidden control
 * measures zero and covers nothing.
 */
const SELECTORS = '#hud > *, #activity-log-toggle, #activity-log, #options-panel, #object-menu, '
  + '#sim-dock, #sim-sheet, #debug-panel';

interface ClientRect { readonly left: number; readonly top: number; readonly width: number; readonly height: number }

/**
 * Converts client rectangles to canvas pixels relative to the canvas, into
 * `out` as left, top, width, height. Empty rectangles are skipped. Returns
 * how many were written.
 */
export function toCanvasRects(rects: readonly ClientRect[], view: ClientRect, canvasWidth: number,
  canvasHeight: number, out: Float64Array): number {
  const sx = view.width > 0 ? canvasWidth / view.width : 1;
  const sy = view.height > 0 ? canvasHeight / view.height : 1;
  let count = 0;
  for (const rect of rects) {
    if (rect.width <= 0 || rect.height <= 0) continue;
    out[count * 4] = (rect.left - view.left) * sx;
    out[count * 4 + 1] = (rect.top - view.top) * sy;
    out[count * 4 + 2] = rect.width * sx;
    out[count * 4 + 3] = rect.height * sy;
    count++;
  }
  return count;
}

/**
 * The controls' rectangles in canvas pixels, measured again only after a
 * control changes size, style, class or visibility, the page's own
 * attributes change (as when Build moves the top-left panel into its
 * header), or the window or canvas changes size. The frame loop therefore
 * forces no layout and allocates nothing on an ordinary frame.
 */
export class BubbleControls {
  private elements: HTMLElement[] | null = null;
  private dirty = true;
  private width = -1;
  private height = -1;
  private result: {rects: Float64Array; count: number} = {rects: new Float64Array(0), count: 0};
  /** Canvas pixels per CSS pixel, measured with the rectangles. */
  pixelRatio = 1;

  constructor(private readonly document: Document) {}

  private watch(): HTMLElement[] {
    const elements = [...this.document.querySelectorAll<HTMLElement>(SELECTORS)];
    const view = this.document.defaultView;
    const mark = () => { this.dirty = true; };
    if (view && 'ResizeObserver' in view) {
      const observer = new view.ResizeObserver(mark);
      for (const element of elements) observer.observe(element);
    }
    if (view && 'MutationObserver' in view) {
      const moved = new view.MutationObserver(mark);
      for (const element of elements) {
        moved.observe(element, {attributes: true, attributeFilter: ['style', 'class', 'hidden']});
      }
      moved.observe(this.document.body, {attributes: true});
    }
    view?.addEventListener('resize', mark);
    this.result = {rects: new Float64Array(elements.length * 4), count: 0};
    return elements;
  }

  /** The controls in the canvas's own pixels. */
  rects(canvas: HTMLCanvasElement): ControlRects {
    this.elements ??= this.watch();
    if (canvas.width !== this.width || canvas.height !== this.height) this.dirty = true;
    if (this.dirty) {
      this.dirty = false;
      this.width = canvas.width;
      this.height = canvas.height;
      const view = canvas.getBoundingClientRect();
      this.pixelRatio = view.width > 0 ? canvas.width / view.width : 1;
      this.result.count = toCanvasRects(this.elements.map(element => element.getBoundingClientRect()),
        view, canvas.width, canvas.height, this.result.rects);
    }
    return this.result;
  }
}
