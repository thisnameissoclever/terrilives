import type { ScenePoint, SceneRect } from './scene-feedback-layout.js';

const EDGE_GAP = 8;
const TARGET_GAP = 24;
const MINIMUM_HEIGHT = 46;

export interface ObjectMenuPlacement {
  readonly left: number;
  readonly top: number;
  readonly height: number;
}

interface Size { readonly width: number; readonly height: number }

/** At each candidate column, a sweep over the controls finds the free vertical bands. */
export function placeObjectMenu(
  target: ScenePoint, size: Size, viewport: Size, keepouts: readonly SceneRect[],
): ObjectMenuPlacement | null {
  const right = viewport.width - EDGE_GAP - size.width;
  const bottom = viewport.height - EDGE_GAP;
  if (right < EDGE_GAP) return null;
  const obstacles = keepouts
    .filter(box => box.right > box.left && box.bottom > box.top)
    .map(box => ({
      left: box.left - EDGE_GAP, right: box.right + EDGE_GAP,
      top: box.top - EDGE_GAP, bottom: box.bottom + EDGE_GAP,
    }))
    .sort((a, b) => a.top - b.top);
  const xs = new Set([
    target.x + TARGET_GAP, target.x - TARGET_GAP - size.width, target.x - size.width / 2,
    EDGE_GAP, right, ...obstacles.flatMap(box => [box.left - size.width, box.right]),
  ].map(x => Math.max(EDGE_GAP, Math.min(right, x))));
  let best: ObjectMenuPlacement | null = null;
  let bestNearTarget = false;
  let bestCoversTarget = true;
  let bestDistance = Infinity;
  for (const left of xs) {
    const right = left + size.width;
    const testBand = (start: number, end: number) => {
      const height = Math.min(size.height, end - start);
      if (height < MINIMUM_HEIGHT) return;
      const offset = Math.min(64, height / 3);
      for (const preferred of [target.y - offset, target.y - height - TARGET_GAP, target.y + TARGET_GAP]) {
        const top = Math.max(start, Math.min(end - height, preferred));
        const coversTarget = target.x > left - 8 && target.x < right + 8 && target.y > top - 8 && target.y < top + height + 8;
        const horizontalGap = Math.max(left - target.x, target.x - right, 0);
        const verticalGap = Math.max(top - target.y, target.y - top - height, 0);
        const nearTarget = !coversTarget && horizontalGap ** 2 + verticalGap ** 2 <= 64 ** 2;
        const distance = horizontalGap ** 2 + (top + offset - target.y) ** 2;
        const better = !best || (nearTarget !== bestNearTarget ? nearTarget
          : height !== best.height ? height > best.height
          : coversTarget !== bestCoversTarget ? !coversTarget : distance < bestDistance);
        if (better) {
          best = { left, top, height };
          bestNearTarget = nearTarget;
          bestCoversTarget = coversTarget;
          bestDistance = distance;
        }
      }
    };

    const testFreeBand = (start: number, end: number) => {
      testBand(start, end);
      if (target.x >= left - EDGE_GAP && target.x <= right + EDGE_GAP && target.y > start && target.y < end) {
        testBand(start, target.y - TARGET_GAP);
        testBand(target.y + TARGET_GAP, end);
      }
    };
    let cursor = EDGE_GAP;
    for (const box of obstacles) {
      if (box.right <= left || box.left >= right || box.bottom <= cursor) continue;
      testFreeBand(cursor, Math.min(box.top, bottom));
      cursor = Math.max(cursor, box.bottom);
      if (cursor >= bottom) break;
    }
    testFreeBand(cursor, bottom);
  }
  return best;
}
