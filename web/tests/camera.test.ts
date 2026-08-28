/**
 * The zoom arithmetic: one clamped scale, reached by two input routes.
 * Pure functions, so every claim the gestures depend on is pinned here
 * without a DOM - the wiring in `attachPointerInput` is the untested
 * remainder, per the same division `time-controls.ts` draws.
 */
import { describe, expect, it } from 'vitest';

import {
  DRAG_THRESHOLD_PX,
  MAX_ZOOM,
  MIN_ZOOM,
  PAN_KEEP_VISIBLE_PX,
  clampOrigin,
  clampZoom,
  lotExtent,
  pinchZoom,
  pointerDistance,
  wheelZoom,
  zoomAnchoredOrigin,
} from '../src/render/camera.js';
import {
  TILE_HALF_HEIGHT,
  TILE_HALF_WIDTH,
  cameraOrigin,
  screenX,
  screenY,
} from '../src/render/iso.js';

describe('clampZoom', () => {
  it('pins the band the design chose', () => {
    // Golden per [L5]: the band is a design decision (0.5x fits the lot
    // with margin, 2.5x counts a sim's buttons), not a free parameter,
    // and the picking, the statics and the shader all assume the scale
    // stays finite and positive.
    expect(MIN_ZOOM).toBe(0.5);
    expect(MAX_ZOOM).toBe(2.5);
  });

  it('clamps both ends and passes the interior through', () => {
    expect(clampZoom(0.1)).toBe(MIN_ZOOM);
    expect(clampZoom(99)).toBe(MAX_ZOOM);
    expect(clampZoom(1.7)).toBe(1.7);
  });

  it('answers a NaN with 1 rather than a clamp edge', () => {
    // Math.min/max propagate NaN, so without the explicit check a
    // corrupt delta would stick the camera at NaN forever - every
    // instance position becomes NaN and the whole lot vanishes with no
    // error anywhere. 1 is "camera sane", not "camera wide".
    expect(clampZoom(Number.NaN)).toBe(1);
  });
});

describe('wheelZoom', () => {
  it('zooms in on wheel-up and out on wheel-down', () => {
    // Wheel-up is negative deltaY. Getting the sign backwards matches
    // no map the player has ever scrolled, and no other test notices.
    expect(wheelZoom(1, -100)).toBeGreaterThan(1);
    expect(wheelZoom(1, 100)).toBeLessThan(1);
  });

  it('is the same RATIO at every scale, which is what smooth means', () => {
    // Exponential in the delta: one notch is one fraction of the
    // current zoom, wherever the camera is in the band. A linear step
    // would crawl at 2.5x and lurch at 0.5x. Two starting scales, one
    // delta, one ratio.
    const notch = -100;
    const fromOne = wheelZoom(1, notch) / 1;
    const fromTwo = wheelZoom(2, notch) / 2;
    expect(fromOne).toBeCloseTo(fromTwo, 10);
    // And the ratio is worth seeing: about 12% per notch, eight notches
    // to double. A rate change is a feel change and should fail a test,
    // not slip through a constant nobody reads.
    expect(fromOne).toBeCloseTo(Math.exp(0.12), 2);
  });

  it('undoes itself: a notch in and a notch out land where they began', () => {
    const inThenOut = wheelZoom(wheelZoom(1.3, -120), 120);
    expect(inThenOut).toBeCloseTo(1.3, 10);
  });

  it('saturates at the band instead of running away', () => {
    let scale = 1;
    for (let i = 0; i < 100; i++) scale = wheelZoom(scale, -500);
    expect(scale).toBe(MAX_ZOOM);
    for (let i = 0; i < 100; i++) scale = wheelZoom(scale, 500);
    expect(scale).toBe(MIN_ZOOM);
  });
});

describe('pinchZoom', () => {
  it('scales by the spread ratio from the gesture start', () => {
    // Fingers twice as far apart as when the pinch began is twice the
    // zoom the pinch began at - the ratio, not the absolute distance,
    // so the same gesture means the same thing on a phone and a tablet.
    expect(pinchZoom(1, 100, 200)).toBe(2);
    expect(pinchZoom(2, 100, 50)).toBe(1);
  });

  it('anchors to the start scale rather than compounding per event', () => {
    // The same spread reported twice must not zoom twice: move events
    // arrive at whatever rate the platform feels like, and compounding
    // would turn event-rate jitter into zoom jitter. The claim is that
    // the function is a pure map from (start, spread) - calling it
    // repeatedly with one spread is one answer.
    const first = pinchZoom(1, 100, 150);
    const again = pinchZoom(1, 100, 150);
    expect(again).toBe(first);
  });

  it('clamps to the band like the wheel does', () => {
    expect(pinchZoom(2, 100, 500)).toBe(MAX_ZOOM);
    expect(pinchZoom(0.6, 100, 10)).toBe(MIN_ZOOM);
  });

  it('answers a degenerate start spread with the start scale', () => {
    // Two fingers can land on one pixel. A division by zero here is an
    // Infinity clamped to MAX_ZOOM - a tap that slams the camera wide.
    expect(pinchZoom(1.4, 0, 80)).toBe(1.4);
  });
});

describe('pointerDistance', () => {
  it('is the euclidean distance, both orders', () => {
    expect(pointerDistance(0, 0, 3, 4)).toBe(5);
    expect(pointerDistance(3, 4, 0, 0)).toBe(5);
  });
});

describe('zoomAnchoredOrigin', () => {
  it('keeps the world point under the anchor exactly still', () => {
    // The whole claim of cursor-centred zoom, stated as the projection
    // itself: pick a world point, put the anchor on its screen position,
    // zoom, and the same world point must land on the same pixel. Three
    // world points and both zoom directions, because the degenerate
    // implementations (returning the origin unchanged, scaling the
    // origin alone) agree with the real one whenever the anchor happens
    // to sit ON the origin.
    let checked = 0;
    for (const [wx, wy] of [
      [3, 2],
      [0, 0],
      [10, 7],
    ]) {
      for (const [oldScale, newScale] of [
        [1, 2],
        [2, 0.8],
      ]) {
        const originX = 400;
        const originY = 180;
        const anchorX = screenX(wx, wy, originX, oldScale);
        const anchorY = screenY(wx, wy, originY, oldScale);
        const moved = zoomAnchoredOrigin(
          originX,
          originY,
          anchorX,
          anchorY,
          oldScale,
          newScale,
        );
        expect(screenX(wx, wy, moved.x, newScale)).toBeCloseTo(anchorX, 6);
        expect(screenY(wx, wy, moved.y, newScale)).toBeCloseTo(anchorY, 6);
        checked += 1;
      }
    }
    expect(checked).toBe(6);
  });

  it('is the identity at an unchanged scale', () => {
    expect(zoomAnchoredOrigin(400, 180, 100, 90, 1.5, 1.5)).toEqual({
      x: 400,
      y: 180,
    });
  });

  it('answers a degenerate old scale with the origin unchanged', () => {
    // Cannot happen from the clamped gestures, but this function does
    // not know its caller, and a division by zero here is a NaN origin
    // that blanks the whole lot.
    expect(zoomAnchoredOrigin(400, 180, 100, 90, 0, 2)).toEqual({
      x: 400,
      y: 180,
    });
  });
});

describe('lotExtent and clampOrigin', () => {
  // The shipped-lot shape, scale 1: numbers small enough to hand-check.
  const EXTENT = lotExtent(14, 10, 99, 99, 1);

  it('describes the drawn box in the projection constants', () => {
    // West boundary column at (-1, 9), east at (13, -1), each half a
    // diamond wider; top is the tallest sprite over the boundary row,
    // bottom the last tile row plus its anchor.
    expect(EXTENT.left).toBe(-11 * TILE_HALF_WIDTH);
    expect(EXTENT.right).toBe(15 * TILE_HALF_WIDTH);
    expect(EXTENT.top).toBe(-TILE_HALF_HEIGHT - 99);
    expect(EXTENT.bottom).toBe(23 * TILE_HALF_HEIGHT);
    // And it scales as one shape: a zoomed lot is the same box times
    // the zoom, which is what keeps the clamp band honest at 2.5x.
    const doubled = lotExtent(14, 10, 99, 99, 2);
    expect(doubled.left).toBe(EXTENT.left * 2);
    expect(doubled.bottom).toBe(EXTENT.bottom * 2);
  });

  it('lets a pan park the lot mostly but never entirely off screen', () => {
    // Fling the origin far off to the left: the clamp must stop with
    // the lot's RIGHT edge still the visibility margin inside the
    // canvas, and symmetrically on every other side.
    const canvasW = 1280;
    const canvasH = 720;
    const flungLeft = clampOrigin(-99999, 300, EXTENT, canvasW, canvasH);
    expect(flungLeft.x + EXTENT.right).toBe(PAN_KEEP_VISIBLE_PX);
    const flungRight = clampOrigin(99999, 300, EXTENT, canvasW, canvasH);
    expect(flungRight.x + EXTENT.left).toBe(canvasW - PAN_KEEP_VISIBLE_PX);
    const flungUp = clampOrigin(300, -99999, EXTENT, canvasW, canvasH);
    expect(flungUp.y + EXTENT.bottom).toBe(PAN_KEEP_VISIBLE_PX);
    const flungDown = clampOrigin(300, 99999, EXTENT, canvasW, canvasH);
    expect(flungDown.y + EXTENT.top).toBe(canvasH - PAN_KEEP_VISIBLE_PX);
  });

  it('passes an origin already inside the band through untouched', () => {
    // The centred origin of a 1280x720 canvas is well inside the band,
    // and a clamp that moved it would fight every applyCamera.
    expect(clampOrigin(400, 200, EXTENT, 1280, 720)).toEqual({
      x: 400,
      y: 200,
    });
  });

  it('centres rather than fighting when the band inverts', () => {
    // The interval inverts when the lot's drawn span is SMALLER than
    // twice the margin and the canvas is smaller still - a tiny lot at
    // minimum zoom in a sliver of a window. (A big lot never inverts:
    // its span alone outweighs both margins, which is why this fixture
    // is a 2x2 lot at 0.5x and not the shipped one.) The answer is the
    // band's midpoint, not an oscillation between impossible bounds.
    const small = lotExtent(2, 2, 10, 10, 0.5);
    const tiny = clampOrigin(0, 0, small, 40, 40);
    const lo = PAN_KEEP_VISIBLE_PX - small.right;
    const hi = 40 - PAN_KEEP_VISIBLE_PX - small.left;
    expect(lo).toBeGreaterThan(hi);
    expect(tiny.x).toBeCloseTo((lo + hi) / 2, 6);
    expect(Number.isFinite(tiny.y)).toBe(true);
  });

  it('pins the drag threshold and the visibility margin', () => {
    // Both are feel decisions with reasons recorded on them: 5 is the
    // platforms' own tap slop, and 96 keeps a draggable corner of lot
    // on screen as the way back from any fling.
    expect(DRAG_THRESHOLD_PX).toBe(5);
    expect(PAN_KEEP_VISIBLE_PX).toBe(96);
  });
});

describe('lotExtent against cameraOrigin', () => {
  // The vertical reservation is written out in both files, because
  // `camera.ts` must not import the origin it is clamping and `iso.ts`
  // must not know about panning. Two copies of one formula drift, and
  // the drift is invisible: the opening frame looks right and the pan
  // band is wrong by however much they disagree, so the house can be
  // dragged down past empty canvas it never fills - or, worse, cannot
  // be dragged far enough to see the corner that started all this.
  it('reserves the same headroom the opening view does', () => {
    // Deliberately spanning the crossover: walls dominate in the first
    // pair, furniture in the last, so a copy that dropped either term
    // fails on one row of this table.
    for (const [tallest, boundary] of [
      [40, 100],
      [100, 100],
      [200, 40],
      [136, 109],
    ]) {
      for (const scale of [0.5, 1, 2]) {
        const extent = lotExtent(16, 12, tallest, boundary, scale);
        const origin = cameraOrigin(
          1280,
          720,
          16,
          12,
          tallest,
          boundary,
          scale,
        );
        // `lotExtent` is relative to the origin, so adding the origin
        // back must land on the topmost pixel the opening view draws.
        const topmost = Math.min(
          screenY(-1, -1, origin.y, scale) +
            (TILE_HALF_HEIGHT - boundary) * scale,
          screenY(0, 0, origin.y, scale) +
            (TILE_HALF_HEIGHT - tallest) * scale,
        );
        expect(origin.y + extent.top).toBeCloseTo(topmost, 6);
      }
    }
  });
});
