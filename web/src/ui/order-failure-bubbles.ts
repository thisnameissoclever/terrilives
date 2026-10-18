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

/** Keep the body above its person, moving sideways when world controls cover it. */
export function failureBubblePlacement(anchor: {x: number; y: number}, size: {width: number; height: number},
  viewport: ViewRect, controls: readonly ViewRect[]): {left: number; top: number; tailX: number} {
  const gap = 8;
  const top = anchor.y - size.height - 10;
  const minLeft = viewport.left + gap;
  const maxLeft = Math.max(minLeft, viewport.left + viewport.width - size.width - gap);
  const centered = Math.max(minLeft, Math.min(maxLeft, anchor.x - size.width / 2));
  const blockers = controls.filter(rect => rect.width > 0 && rect.height > 0
    && top < rect.top + rect.height + gap && top + size.height > rect.top - gap);
  const candidates = [centered, ...blockers.flatMap(rect => [rect.left - size.width - gap, rect.left + rect.width + gap])];
  const available = candidates.filter(left => left >= minLeft && left <= maxLeft
    && blockers.every(rect => left + size.width <= rect.left - gap || left >= rect.left + rect.width + gap));
  const left = available.sort((a, b) => Math.abs(a - centered) - Math.abs(b - centered))[0] ?? centered;
  return {left, top, tailX: anchor.x - left};
}

export class OrderFailureBubbles {
  private readonly bubbles = new Map<number, HTMLElement>();
  constructor(private readonly root: HTMLElement) {}
  update(failed: ReadonlySet<number>, source: FailureBubbleSource, view: FailureBubbleView,
    headOf: (row: number) => readonly [number, number, number] | null): void {
    if (failed.size === 0 && this.bubbles.size === 0) return;
    const ids = source.ids(), positions = source.positions(), activities = source.activities();
    const controls = [...this.root.ownerDocument.querySelectorAll<HTMLElement>('#hud, #sim-dock, #sim-sheet, #debug-panel')]
      .map(node => node.getBoundingClientRect());
    const viewport = this.root.getBoundingClientRect();
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
        bubble.innerHTML = '<svg class="order-failure-tail" focusable="false" aria-hidden="true"><path/></svg><svg class="order-failure-squiggle" viewBox="0 0 48 26" focusable="false" aria-hidden="true"><path d="M4 15 C5 2 17 2 16 13 S7 25 8 14 S25 4 25 15 S16 23 19 11 S35 5 34 17 S27 22 30 13 S43 8 44 15"/></svg>';
        this.bubbles.set(entity, bubble); this.root.append(bubble);
      }
      bubble.hidden = activities[row] === 6;
      const head = headOf(row) ?? [positions[row * 2], positions[row * 2 + 1], 1.7] as const;
      const anchor = failureBubbleAnchor(head, view);
      if (!anchor) { bubble.hidden = true; continue; }
      if (bubble.hidden) continue;
      const width = bubble.offsetWidth, height = bubble.offsetHeight;
      const placement = failureBubblePlacement(anchor, {width, height}, viewport, controls);
      bubble.style.left = `${placement.left}px`; bubble.style.top = `${placement.top}px`;
      const base = Math.max(width / 4, Math.min(width * 3 / 4, placement.tailX));
      bubble.querySelector<SVGPathElement>('.order-failure-tail path')!.setAttribute('d',
        `M${base - 4} ${height - 5} L${placement.tailX} ${height + 8} L${base + 4} ${height - 5}`);
    }
  }
}
