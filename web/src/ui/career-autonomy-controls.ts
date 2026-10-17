/**
 * The two career settings in the Options flyout - rule 15 of
 * docs/specs/2026-10-17-careers.md. Like the death setting: the boxes
 * reflect the simulation's state, and a change only enqueues a command,
 * which the drain applies on the next flush.
 */
export class CareerAutonomyControls {
  constructor(
    private readonly source: {
      careerAutonomy(): { change: boolean; search: boolean } | null;
      setCareerAutonomy(change: boolean, search: boolean): boolean;
    },
    private readonly changeInput: { checked: boolean; disabled: boolean },
    private readonly searchInput: { checked: boolean; disabled: boolean },
  ) {}

  update(): void {
    const settings = this.source.careerAutonomy();
    if (settings === null) return;
    this.changeInput.checked = settings.change;
    this.searchInput.checked = settings.search;
  }

  change(): boolean {
    return this.source.setCareerAutonomy(this.changeInput.checked, this.searchInput.checked);
  }

  setDisabled(disabled: boolean): void {
    this.changeInput.disabled = disabled;
    this.searchInput.disabled = disabled;
  }
}
