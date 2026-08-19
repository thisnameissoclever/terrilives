/**
 * Rolling frame-time statistics for the M0 exit criterion.
 *
 * This is the instrument that answers [R1] - whether the WASM/JS bridge in
 * [D11] can carry 1,000 entities inside a 16.6 ms frame - so it is written to
 * two constraints the arithmetic alone would not impose.
 *
 * **It allocates nothing per sample.** `sample()` runs on the render path, and
 * an instrument that allocates while measuring per-frame allocation would sit
 * inside its own reading. The window is a preallocated `Float64Array` ring
 * rather than the array-push-and-shift the plan sketched. Sorting scratch is
 * preallocated for the same reason, though `p95` is off the per-frame path.
 *
 * **It counts frames, not just times.** [L14]: an agent-driven browser tab
 * runs hidden, a hidden tab is not composited, and `requestAnimationFrame`
 * therefore never fires. A timer that only reports mean and p95 reports a
 * flawless budget over zero frames and looks like a pass. The lifetime frame
 * count is part of `report()` so the number that distinguishes "fast" from
 * "never ran" cannot be left out by a caller who forgot it mattered.
 */
export class FrameTimer {
  /** The rolling window, written cyclically. Never reallocated. */
  private readonly window: Float64Array;

  /** Sorting scratch for `p95`, so the percentile never allocates either. */
  private readonly sorted: Float64Array;

  /** Next slot to write. Wraps at `capacity`. */
  private cursor = 0;

  /** Slots written so far, saturating at `capacity`. */
  private filled = 0;

  /** Every sample ever taken. Deliberately does not saturate; see [L14]. */
  private total = 0;

  constructor(private readonly capacity: number) {
    this.window = new Float64Array(capacity);
    this.sorted = new Float64Array(capacity);
  }

  sample(ms: number): void {
    this.window[this.cursor] = ms;
    this.cursor = (this.cursor + 1) % this.capacity;
    if (this.filled < this.capacity) this.filled++;
    this.total++;
  }

  /** Samples currently in the window, capped at the capacity. */
  get windowSize(): number {
    return this.filled;
  }

  /** Frames sampled over the run's whole life. Zero means nothing rendered. */
  get frames(): number {
    return this.total;
  }

  get mean(): number {
    if (this.filled === 0) return 0;
    let sum = 0;
    // Bounded by `filled`, not by `capacity`: before the ring wraps, the
    // trailing slots are zeros that were never a frame.
    for (let i = 0; i < this.filled; i++) sum += this.window[i];
    return sum / this.filled;
  }

  /**
   * p95 matters more than mean here. A good average with a bad tail still
   * reads as stutter to the player.
   */
  get p95(): number {
    if (this.filled === 0) return 0;
    const view = this.sorted.subarray(0, this.filled);
    view.set(this.window.subarray(0, this.filled));
    view.sort();
    const idx = Math.min(this.filled - 1, Math.floor(this.filled * 0.95));
    return view[idx];
  }

  get max(): number {
    let maximum = 0;
    for (let i = 0; i < this.filled; i++) {
      maximum = Math.max(maximum, this.window[i]);
    }
    return maximum;
  }

  report(): string {
    return (
      `frames ${this.total}  window ${this.filled}  ` +
      `mean ${this.mean.toFixed(2)}ms  p95 ${this.p95.toFixed(2)}ms`
    );
  }
}
