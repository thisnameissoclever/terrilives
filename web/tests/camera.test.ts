/**
 * The zoom arithmetic: one clamped scale, reached by two input routes.
 * Pure functions, so every claim the gestures depend on is pinned here
 * without a DOM - the wiring in `attachPointerInput` is the untested
 * remainder, per the same division `time-controls.ts` draws.
 */
import { describe, expect, it } from 'vitest';

import {
  MAX_ZOOM,
  MIN_ZOOM,
  clampZoom,
  pinchZoom,
  pointerDistance,
  wheelZoom,
} from '../src/render/camera.js';

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
