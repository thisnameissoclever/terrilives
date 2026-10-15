import { FixedStepDriver } from '../../frame.js';

/** One continuous simulation phase owns both travel and sampled animation. */
export class ProofClock {
  private driver = new FixedStepDriver(10, 5);
  private origin = 0;
  private ticks = 0;
  private phase = 0;
  private active = false;
  get time(): number { return this.phase; }
  get playing(): boolean { return this.active; }
  seek(time: number): void {
    if (!Number.isFinite(time) || time < 0) throw new Error('Invalid proof time');
    this.play(false); this.phase = time; this.origin = time; this.ticks = 0;
    this.driver = new FixedStepDriver(10, 5);
  }
  play(active: boolean): void {
    if (this.active === active) return;
    this.active = active; this.origin = this.phase; this.ticks = 0;
    this.driver = new FixedStepDriver(10, 5);
  }
  advance(milliseconds: number): void {
    if (!this.active) return;
    const alpha = this.driver.advance(milliseconds, () => this.ticks++);
    this.phase = this.origin + this.ticks + alpha;
  }
  step(frameTicks: number): void {
    if (!Number.isFinite(frameTicks) || frameTicks <= 0) throw new Error('Invalid frame duration');
    this.play(false); this.phase = (Math.floor(this.phase/frameTicks)+1)*frameTicks; this.origin = this.phase;
  }
  reset(): void { const active=this.active; this.play(false); this.phase=0; this.origin=0; this.play(active); }
}
