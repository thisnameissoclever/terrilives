/**
 * Paces the frame loop whether or not the browser is drawing the page.
 *
 * Animation frames drive the game while the tab is on screen. A hidden tab
 * never fires them ([L14]), and an unselected or covered one can receive them
 * only about once a second; a loop driven by them alone stops or slows the
 * simulation along with the drawing. A repeating timer therefore watches for
 * frames that stop arriving and steps the game itself, without presenting,
 * until they resume.
 *
 * Timestamps handed to `step` never go backward, so an animation frame stamped
 * before the timer's last step cannot count the same time twice.
 */

/** One frame's work. `presenting` is false when the step will not be seen. */
export type FrameStep = (nowMs: number, presenting: boolean) => void;

/** The browser services the clock needs, injected so Node can test it. */
export interface FrameClockHost {
  now(): number;
  requestFrame(callback: (nowMs: number) => void): void;
  /** Starts a repeating timer. The returned function stops it. */
  startTimer(callback: () => void): () => void;
}

export class FrameClock {
  private generation = 0;
  private running = false;
  private stopTimer: (() => void) | null = null;
  private lastFrameMs = 0;
  private lastStepMs = -Infinity;

  /**
   * `stallMs` is how long animation frames may be absent before the timer
   * steps instead. Null keeps animation frames as the only driver, for
   * harnesses that step the frame body themselves from a hidden tab.
   */
  constructor(
    private readonly host: FrameClockHost,
    private readonly step: FrameStep,
    private readonly stallMs: number | null,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    const generation = ++this.generation;
    this.lastFrameMs = this.host.now();
    this.requestFrame(generation);
    if (this.stallMs !== null) this.stopTimer = this.host.startTimer(() => this.timerStep(generation));
  }

  /** Halts both drivers. Safe to call from inside a step. */
  stop(): void {
    this.running = false;
    this.generation++;
    this.stopTimer?.();
    this.stopTimer = null;
  }

  private requestFrame(generation: number): void {
    this.host.requestFrame((nowMs) => {
      if (generation !== this.generation) return;
      this.run(nowMs, true);
      this.lastFrameMs = this.host.now();
      if (generation === this.generation) this.requestFrame(generation);
    });
  }

  private timerStep(generation: number): void {
    if (generation !== this.generation || this.stallMs === null) return;
    const now = this.host.now();
    if (now - this.lastFrameMs >= this.stallMs) this.run(now, false);
  }

  /** A throw ends the loop, as it did when only animation frames drove it. */
  private run(nowMs: number, presenting: boolean): void {
    const stepMs = Math.max(nowMs, this.lastStepMs);
    this.lastStepMs = stepMs;
    try {
      this.step(stepMs, presenting);
    } catch (error) {
      this.stop();
      throw error;
    }
  }
}
