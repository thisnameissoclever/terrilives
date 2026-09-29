/** Reflect saved simulation state; player changes only enqueue a command. */
export class DeathControls {
  constructor(
    private readonly source: { deathEnabled(): boolean; setDeathEnabled(enabled: boolean): boolean },
    private readonly input: { checked: boolean },
  ) {}

  update(): void { this.input.checked = this.source.deathEnabled(); }
  change(): boolean { return this.source.setDeathEnabled(this.input.checked); }
}
