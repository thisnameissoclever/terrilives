import { describe, it, expect } from 'vitest';
import { FrameTimer } from '../src/perf.js';

// The instrument for the M0 exit criterion, so its own correctness is
// load-bearing: a wrong p95 does not fail loudly, it reports a number that
// looks plausible and settles whether [R1] passed. Every assertion below is
// therefore a golden value chosen so that the obvious wrong implementations -
// max, mean, median, min, "reset when full", "average the whole ring
// including unwritten slots" - each produce a different number.
//
// The [L14] failure is in scope too. A harness that loops on
// requestAnimationFrame in a hidden tab reports beautiful timings for zero
// frames, so the frame count is part of the instrument rather than something
// a caller is trusted to remember to print.

describe('FrameTimer', () => {
  it('reports the mean of its samples, not their median', () => {
    // 10/20/60 rather than 10/20/30: the mean is 30 and the median is 20,
    // so a median implementation cannot pass by coincidence.
    const t = new FrameTimer(100);
    for (const v of [10, 20, 60]) t.sample(v);
    expect(t.mean).toBeCloseTo(30, 5);
  });

  it('averages only the samples taken, not the unwritten window', () => {
    // The ring is preallocated at full capacity, so a mean that divides by
    // `capacity` rather than by the number of samples reads 97 zeros and
    // reports 0.45 instead of 15. Two samples in a 100-slot window make
    // that difference impossible to miss.
    const t = new FrameTimer(100);
    t.sample(10);
    t.sample(20);
    expect(t.mean).toBeCloseTo(15, 5);
  });

  it('reports the 95th percentile, not the maximum or the median', () => {
    // 1..100, all distinct, so every candidate statistic is a different
    // number: p95 is 96, max is 100, mean and median are 50.5, min is 1.
    // An off-by-one in the index lands on 95 or 97 and also fails.
    //
    // Sampled in a scrambled order, which is the load-bearing part. Feeding
    // them ascending puts the window in sorted order already, so the sort
    // could be deleted and this test would still read 96 - the project's
    // recurring shape, a test that names a mechanism it cannot detect. 37 is
    // coprime with 100, so the stride visits every value exactly once.
    const t = new FrameTimer(200);
    for (let i = 0; i < 100; i++) t.sample(((i * 37) % 100) + 1);
    expect(t.p95).toBe(96);

    // Preconditions, so the assertion above is discriminating rather than
    // accidentally equal to something simpler.
    expect(t.mean).toBeCloseTo(50.5, 5);
  });

  it('reports p95 above the bulk of samples', () => {
    const t = new FrameTimer(200);
    for (let i = 0; i < 100; i++) t.sample(i < 95 ? 10 : 100);
    expect(t.p95).toBeGreaterThanOrEqual(10);
    expect(t.p95).toBeLessThanOrEqual(100);
  });

  it('lets a slow tail move p95 while the mean stays comfortable', () => {
    // The reason p95 is the criterion rather than the mean. 5% of frames at
    // 100 ms is visible stutter, and the mean of this window is 14.5 ms,
    // which is inside the 16.6 ms budget. p95 must not be.
    const t = new FrameTimer(100);
    for (let i = 0; i < 100; i++) t.sample(i < 95 ? 10 : 100);
    expect(t.mean).toBeLessThan(16.6);
    expect(t.p95).toBeGreaterThan(16.6);
  });

  it('keeps only the most recent samples', () => {
    const t = new FrameTimer(3);
    for (const v of [100, 100, 100, 1, 1, 1]) t.sample(v);
    expect(t.mean).toBeCloseTo(1, 5);
  });

  it('evicts the oldest sample rather than clearing the window when full', () => {
    // The test above cannot see the difference: an implementation that
    // empties the window once it is full also ends up holding only 1s. Four
    // samples into a window of three separate them - sliding gives
    // [2, 3, 4] and a mean of 3, clearing gives [4] and a mean of 4.
    const t = new FrameTimer(3);
    for (const v of [1, 2, 3, 4]) t.sample(v);
    expect(t.mean).toBeCloseTo(3, 5);
  });

  it('keeps p95 inside the retained window after wrapping', () => {
    // A ring buffer that wraps but sorts the raw slot order, or that leaves
    // an evicted value behind, would still see the discarded 1000.
    const t = new FrameTimer(4);
    for (const v of [1000, 1, 2, 3, 4, 5]) t.sample(v);
    expect(t.p95).toBe(5);
    expect(t.mean).toBeCloseTo(3.5, 5);
  });

  it('reports zero before any sample', () => {
    expect(new FrameTimer(10).mean).toBe(0);
    expect(new FrameTimer(10).p95).toBe(0);
    expect(new FrameTimer(10).frames).toBe(0);
  });

  it('counts every frame ever sampled, not just the ones still in the window', () => {
    // [L14]: a hidden tab never fires requestAnimationFrame, so a harness
    // can report an excellent p95 over zero frames. The lifetime count is
    // the thing that distinguishes "fast" from "never ran", and it must not
    // saturate at the window size.
    const t = new FrameTimer(4);
    for (let i = 0; i < 10; i++) t.sample(5);
    expect(t.frames).toBe(10);
    expect(t.windowSize).toBe(4);
  });

  it('names the frame count, mean and p95 in its report', () => {
    const t = new FrameTimer(8);
    for (const v of [1, 2, 3, 4]) t.sample(v);
    const line = t.report();
    expect(line).toContain('frames 4');
    expect(line).toContain('mean 2.50ms');
    expect(line).toContain('p95 4.00ms');
  });
});
