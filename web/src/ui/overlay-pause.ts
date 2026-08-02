/**
 * Temporarily stops rendered simulation time while a blocking surface is open.
 *
 * The selected player speed remains separate from the temporary pause. Reading
 * Help or choosing whether to Load is shell time, not a replayable game action,
 * so suspension changes only the fixed-step driver. A speed the player chooses
 * still crosses the command boundary exactly once through `recordSpeed`.
 */
export interface SpeedDriver {
  setSpeed(multiplier: number): void;
}

export type SpeedRecorder = (multiplier: number) => void;

export class OverlayPauseController {
  private readonly blockers = new Set<string>();
  private selectedSpeed: number;

  constructor(
    private readonly driver: SpeedDriver,
    private readonly recordSpeed: SpeedRecorder,
    initialSpeed: number,
  ) {
    this.selectedSpeed = initialSpeed;
  }

  /** Applies a player-selected speed without defeating an active modal pause. */
  selectSpeed(multiplier: number): void {
    this.recordSpeed(multiplier);
    this.selectedSpeed = multiplier;
    if (this.blockers.size === 0) this.driver.setSpeed(multiplier);
  }

  /** Pauses on the first blocking surface. Repeated opens are idempotent. */
  suspend(owner: string): void {
    if (this.blockers.has(owner)) return;
    this.blockers.add(owner);
    if (this.blockers.size === 1) this.driver.setSpeed(0);
  }

  /** Restores the chosen speed after the final blocking surface closes. */
  resume(owner: string): void {
    if (!this.blockers.delete(owner)) return;
    if (this.blockers.size === 0) this.driver.setSpeed(this.selectedSpeed);
  }

  get suspended(): boolean {
    return this.blockers.size > 0;
  }
}
