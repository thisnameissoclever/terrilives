/**
 * The household's career setting in the Options flyout: whether people
 * change path on their own (rule 15 of docs/specs/2026-10-17-careers.md).
 * Job search is each person's own setting, in the Career tab
 * (docs/specs/2026-10-18-job-search-per-person.md). Like the death
 * setting: the box reflects the simulation's state, and a change only
 * enqueues a command, which the drain applies on the next flush.
 */
export class CareerAutonomyControls {
  constructor(
    private readonly source: {
      careerChangeAutonomy(): boolean | null;
      setCareerChangeAutonomy(change: boolean): boolean;
    },
    private readonly changeInput: { checked: boolean; disabled: boolean },
  ) {}

  update(): void {
    const change = this.source.careerChangeAutonomy();
    if (change === null) return;
    this.changeInput.checked = change;
  }

  change(): boolean {
    return this.source.setCareerChangeAutonomy(this.changeInput.checked);
  }

  setDisabled(disabled: boolean): void {
    this.changeInput.disabled = disabled;
  }
}
