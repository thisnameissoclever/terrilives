export interface WorkConflictPerson {entity: number; name: string; phase: string; remainingMinutes: number; totalMinutes: number}
export interface WorkConflict {token: string; people: WorkConflictPerson[]}
export interface WorkConflictSource {workConflictsOf(participants: readonly number[]): WorkConflict}
export interface WorkConflictView {show(conflict: WorkConflict): void; close(): void; returnFocus(): void; rejected?(): void}
export function formatWorkConflict(conflict: WorkConflict): string {
  const hours = (minutes: number): string => Number((minutes / 60).toFixed(2)).toString();
  return `${conflict.people.map(person => `${person.name}: ${hours(person.remainingMinutes)} of ${hours(person.totalMinutes)} shift hours remaining.`).join('\n')}\n\nThis order delays or interrupts work. Pay and shift rewards depend on time worked. After two missed hours, performance loses ten points per further hour. Missing the entire shift gives zero pay and a zero shift score. Work can resume before the original shift ends; the shift will not be extended.`;
}
/** Hold a single submission outside the simulation until the player decides. */
export class WorkOrderConfirmation {
  private pending: {token: string; submit: (approval?: string) => boolean} | null = null;
  constructor(private readonly source: WorkConflictSource,
    private readonly pause: {suspend(owner: string): void; resume(owner: string): void},
    private readonly view: WorkConflictView) {}
  request(participants: readonly number[], submit: (approval?: string) => boolean): boolean {
    if (this.pending) return false;
    const conflict = this.source.workConflictsOf(participants);
    if (conflict.people.length === 0) return submit();
    this.pending = {token: conflict.token, submit};
    this.pause.suspend('work-order');
    this.view.show(conflict);
    return true;
  }
  proceed(): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    try { if (!pending.submit(pending.token)) this.view.rejected?.(); } finally { this.finish(); }
  }
  cancel(): void {
    if (!this.pending) return;
    this.pending = null;
    this.finish();
  }
  private finish(): void {
    this.view.close();
    this.pause.resume('work-order');
    this.view.returnFocus();
  }
}
