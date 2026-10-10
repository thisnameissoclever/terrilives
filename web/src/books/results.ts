import type { BookResult } from './codec.js';
export interface BookResultSource { takeBookResults(): BookResult[]; pendingBookCommands(): number }
const REFUSALS: Readonly<Record<string, string>> = {
  unknown_title: 'That title is unavailable.', unknown_copy: 'That copy is no longer available.',
  unknown_shelf: 'That bookcase is no longer available. No purchase was charged.',
  unknown_person: 'That person is no longer here.', insufficient_funds: 'The household cannot afford this book.',
  borrowed: 'That copy is borrowed and must be returned first.', shelf_full: 'That bookcase is full. The copy stayed where it was.',
  already_borrowing: 'This person must return their current book first.', not_readable: 'No available shelved copy can be read here.',
  unknown_object: 'That object is no longer available.', not_owned_reading_action: 'This object cannot offer owned reading.',
  queue_full: 'The order queue is full.', invalid_state: 'The book command was refused. Check its current location.',
  no_shelf_space: 'There is no room for another book.', no_sale_copy: 'No available book can be sold here.',
  stale_quote: 'The book selection changed. Try again.',
};
export function bookRefusal(reason: string): string { return REFUSALS[reason] ?? `Book command refused (${reason}).`; }

/** One consuming drain across all panels; restored commands cannot become new confirmations. */
export class BookResults {
  private waiting: ((result: BookResult) => void) | null = null;
  private lastSequence = 0n;
  constructor(private readonly source: BookResultSource) { this.resetAfterLoad(); }
  get pending(): boolean { return this.waiting !== null; }
  get unavailable(): boolean { return this.pending || this.source.pendingBookCommands() > 0; }
  submit(stage: () => boolean, completed: (result: BookResult) => void): boolean {
    if (this.unavailable) return false;
    this.drain();
    if (!stage()) return false;
    this.waiting = completed;
    return true;
  }
  drain(): void {
    const results = this.source.takeBookResults();
    for (const result of results) {
      if (result.sequence <= this.lastSequence) throw new Error('Book result sequence moved backwards.');
      this.lastSequence = result.sequence;
    }
    if (!this.waiting || results.length === 0) return;
    const callback = this.waiting;
    this.waiting = null;
    if (results.length !== 1) throw new Error('Book result ownership is inconsistent.');
    callback(results[0]);
  }
  resetAfterLoad(): void {
    this.waiting = null;
    this.lastSequence = 0n;
    this.drain();
  }
}
