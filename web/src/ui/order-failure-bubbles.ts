import { screenX, screenY } from '../render/iso.js';
import { canvasToClient, type ViewRect } from '../input.js';

export interface FailureBubbleSource {ids(): Uint32Array; positions(): Float32Array; activities(): Uint32Array}
export interface FailureBubbleView {originX: number; originY: number; scale: number; width: number; height: number; rect: ViewRect}
/** Use the same head projection as the activity annotations. */
export function failureBubbleAnchor(head: readonly [number, number, number], view: FailureBubbleView): {x: number; y: number} | null {
  return canvasToClient(screenX(head[0], head[1], view.originX, view.scale),
    screenY(head[0], head[1], view.originY, view.scale) - head[2] * Math.sqrt(1166) * view.scale,
    view.rect, view.width, view.height);
}
export class OrderFailureBubbles {
  private readonly bubbles = new Map<number, HTMLElement>();
  constructor(private readonly root: HTMLElement) {}
  update(failed: ReadonlySet<number>, source: FailureBubbleSource, view: FailureBubbleView,
    headOf: (row: number) => readonly [number, number, number] | null): void {
    if (failed.size === 0 && this.bubbles.size === 0) return;
    const ids = source.ids(), positions = source.positions(), activities = source.activities();
    for (const [entity, bubble] of this.bubbles) {
      if (failed.has(entity) && ids.includes(entity)) continue;
      bubble.remove(); this.bubbles.delete(entity);
    }
    for (let row = 0; row < ids.length; row++) {
      const entity = ids[row];
      if (!failed.has(entity)) continue;
      let bubble = this.bubbles.get(entity);
      if (!bubble) {
        bubble = this.root.ownerDocument.createElement('span');
        bubble.className = 'order-failure-bubble';
        bubble.dataset.entity = String(entity);
        bubble.setAttribute('aria-hidden', 'true');
        bubble.innerHTML = '<svg viewBox="0 0 48 26" focusable="false" aria-hidden="true"><path d="M4 15 C5 2 17 2 16 13 S7 25 8 14 S25 4 25 15 S16 23 19 11 S35 5 34 17 S27 22 30 13 S43 8 44 15"/></svg>';
        this.bubbles.set(entity, bubble); this.root.append(bubble);
      }
      bubble.hidden = activities[row] === 6;
      const head = headOf(row) ?? [positions[row * 2], positions[row * 2 + 1], 1.7] as const;
      const anchor = failureBubbleAnchor(head, view);
      if (!anchor) { bubble.hidden = true; continue; }
      bubble.style.left = `${anchor.x}px`; bubble.style.top = `${anchor.y}px`;
    }
  }
}
