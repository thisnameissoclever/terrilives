import type { AdminSkipHost, SkipResult } from './admin-panel.js';

// Skip ahead's runner (issue 312, [AP-skip] in
// docs/specs/2026-11-20-admin-panel.md). A skip is ordinary ticking: the same
// `Sim::tick`, in the same order, with the same draws as playing at speed, so
// determinism needs nothing more than that no command enters while it runs
// (the panel is modal and locked). The runner holds no clock of its own; the
// frame loop calls `step` once a frame, before it draws, and the runner runs a
// budget of ticks, reports whole hours and ends at a frame boundary.

/** What the runner needs of the game; `main.ts` supplies it. */
export interface SkipWorld {
  /** One simulation tick, with the per-tick sampling sounds off so the events drain silently. */
  tick(): void;
  /** Ticks in an hour of game time, from the day length. */
  ticksPerHour(): number;
  /** The most ticks one frame runs: `admin_skip_ticks_per_frame`. */
  ticksPerFrame(): number;
  /** The living housemates, SimId to name, as of now. */
  living(): ReadonlyMap<number, string>;
}

interface Run {
  readonly handlers: { progress(hoursRun: number): void; finish(result: SkipResult): void };
  readonly asked: number;
  readonly total: number;
  readonly names: ReadonlyMap<number, string>;
  ticks: number;
  stopRequested: boolean;
}

export class SkipRunner implements AdminSkipHost {
  private run: Run | null = null;

  constructor(
    private readonly world: SkipWorld,
    private readonly knobs: () => { readonly maxHours: number; readonly defaultHours: number },
  ) {}

  get running(): boolean {
    return this.run !== null;
  }

  limits(): { readonly maxHours: number; readonly defaultHours: number } {
    return this.knobs();
  }

  start(hours: number, handlers: Run['handlers']): void {
    if (this.run !== null) return;
    this.run = {
      handlers, asked: hours, total: Math.round(hours * this.world.ticksPerHour()),
      names: this.world.living(), ticks: 0, stopRequested: false,
    };
  }

  stop(): void {
    if (this.run !== null) this.run.stopRequested = true;
  }

  cancel(): void {
    this.run = null;
  }

  /**
   * Runs one frame of the skip: nothing when no skip runs. Ends it when the
   * player asked to stop (before any tick of this frame), when the hours are
   * done, or when a housemate who was here at the start is gone by the end of
   * the frame's ticks.
   */
  step(): void {
    const run = this.run;
    if (run === null) return;
    const hoursRun = (): number => Math.min(run.asked, Math.floor(run.ticks / this.world.ticksPerHour()));
    if (run.stopRequested) {
      this.finish(run, { kind: 'stopped', hours: hoursRun() });
      return;
    }
    const budget = Math.min(this.world.ticksPerFrame(), run.total - run.ticks);
    try {
      for (let tick = 0; tick < budget; tick++) {
        this.world.tick();
        run.ticks += 1;
      }
    } catch (error) {
      this.run = null;
      throw error;
    }
    const living = this.world.living();
    for (const [simId, name] of run.names) {
      if (!living.has(simId)) {
        this.finish(run, { kind: 'died', hours: hoursRun(), name });
        return;
      }
    }
    if (run.ticks >= run.total) this.finish(run, { kind: 'done', hours: run.asked });
    else run.handlers.progress(hoursRun());
  }

  private finish(run: Run, result: SkipResult): void {
    // The run ends before the handler runs, so a handler that starts another skip is not ignored.
    if (this.run === run) this.run = null;
    run.handlers.finish(result);
  }
}
