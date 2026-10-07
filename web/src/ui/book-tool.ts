import type { SimBridge } from '../bridge.js';
import type { BookCopy, BookTitle } from '../books/codec.js';
import { BookResults, bookRefusal } from '../books/results.js';
import { furnitureLabel } from './furniture-label.js';

export type BookSource = Pick<SimBridge, 'bookCatalogue' | 'bookState' | 'bookInterest' | 'readingProgress' |
  'selectedIndex' | 'simName' | 'simIdOf' | 'ids' | 'objectName' | 'objectDetails' | 'buyBook' | 'transferBook' | 'funds'> & Partial<Pick<SimBridge, 'positions'>>;
export type BookState = ReturnType<SimBridge['bookState']>;
export function baselineLength(title: BookTitle): string {
  const length = title.readingMinutes <= 120 ? 'Short' : title.readingMinutes <= 180 ? 'Standard length' : 'Long';
  return `${length}: about ${title.readingMinutes} game minutes of reading, usually ${Math.ceil(title.readingMinutes / 60)} sessions`;
}
export function genreLabel(genre: string): string {
  const words = genre.replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
export function copyLabel(id: number): string { return `Copy ${id + 1}`; }
export function bookLocation(copy: BookCopy, source: BookSource): string {
  const shelfName = (shelf: bigint) => furnitureLabel(source, Number(shelf)) || 'Bookcase';
  let where: string;
  switch (copy.location.kind) {
    case 'inventory': where = 'Household inventory'; break;
    case 'lot': where = `Dropped at (${copy.location.x}, ${copy.location.y})`; break;
    case 'shelf': where = `${shelfName(copy.location.home.shelf)}, slot ${copy.location.home.slot + 1}`; break;
    case 'carried': where = 'Carried'; break;
  }
  if (copy.borrowerSimId !== null) {
    const entity = Array.from(source.ids()).find(entity => source.simIdOf(entity) === copy.borrowerSimId);
    where += `; borrowed by ${entity === undefined ? `person ${copy.borrowerSimId}` : source.simName(entity)}`;
    if (copy.home) where += `; home: ${shelfName(copy.home.shelf)}, slot ${copy.home.slot + 1}`;
  }
  if (copy.location.kind === 'lot' && copy.home) where += `; home: ${shelfName(copy.home.shelf)}, slot ${copy.home.slot + 1}`;
  return where;
}

export class BookTool {
  active = false;
  blocked = false;
  titleId: string | null = null;
  destination: number | null = null;
  readonly titles: readonly BookTitle[];
  state: BookState = { copies: [], shelves: [] };
  status = 'Choose a title to buy.';
  error: string | null = null;
  private lastTick = -1;
  private selected: number | null = null;
  private changedState = true;
  constructor(readonly source: BookSource, readonly results: BookResults, private readonly changed: () => void) {
    this.titles = source.bookCatalogue();
  }
  get pending(): boolean { return this.results.unavailable; }
  get chosen(): BookTitle | null { return this.titles.find(title => title.id === this.titleId) ?? null; }
  get canBuy(): boolean { return this.active && !this.blocked && !this.pending && this.error === null && this.chosen !== null && this.chosen.price <= this.source.funds(); }
  enter(): void { this.active = true; this.refresh(); }
  exit(): void { this.active = false; this.changed(); }
  handleKey(key: string): boolean { if (!this.active) return false; if (key === 'Enter') { this.buy(); return true; } return false; }
  setBlocked(blocked: boolean): void { if (this.blocked !== blocked) { this.blocked = blocked; this.changed(); } }
  choose(title: string | null): void {
    if (this.blocked || this.pending) return;
    if (title !== null && !this.titles.some(row => row.id === title)) return;
    this.titleId = title; this.changed();
  }
  setDestination(shelf: number | null): void {
    if (this.blocked || this.pending) return;
    if (shelf !== null && !this.state.shelves.some(row => row.entity === shelf)) return;
    this.destination = shelf; this.changed();
  }
  buy(): void {
    const title = this.chosen; if (!this.canBuy || title === null) return;
    const destination = this.destination;
    if (this.results.submit(() => this.source.buyBook(title.id, destination), result => {
      this.refresh();
      const copy = this.state.copies.find(copy => copy.id === result.copy);
      this.status = result.refusal ? bookRefusal(result.refusal) : copy
        ? `${title.title} bought. ${bookLocation(copy, this.source)}${destination !== null && copy.location.kind === 'inventory' ? ' (the selected bookcase filled).' : '.'}`
        : 'Purchase result unavailable. Check household books.';
      this.changed();
    })) this.status = 'Buying one copy…';
    else this.status = 'The purchase could not be sent.';
    this.changed();
  }
  transfer(copyId: number, destination: number | null): void {
    if (!this.active || this.blocked || this.pending || this.error !== null) return;
    const copy = this.state.copies.find(row => row.id === copyId);
    if (!copy || copy.borrowerSimId !== null) return;
    if (this.results.submit(() => this.source.transferBook(copyId, destination), result => {
      this.refresh();
      const moved = this.state.copies.find(row => row.id === copyId);
      this.status = result.refusal ? bookRefusal(result.refusal) : moved ? `${copyLabel(copyId)} moved. ${bookLocation(moved, this.source)}.` : 'Transfer result unavailable.';
      this.changed();
    })) this.status = `Moving ${copyLabel(copyId).toLowerCase()}…`;
    else this.status = 'The transfer could not be sent.';
    this.changed();
  }
  refresh(): void {
    try { this.state = this.source.bookState(); this.error = null; }
    catch { this.error = 'Book information is unavailable. No book command can be sent.'; }
    this.changedState = false; this.changed();
  }
  invalidate(): void { this.changedState = true; }
  afterCommands(tick: number): void {
    const selected = this.source.selectedIndex();
    if (this.active && (this.changedState || tick !== this.lastTick || selected !== this.selected)) {
      this.lastTick = tick; this.selected = selected; this.refresh();
    }
  }
  resetAfterLoad(): void { this.titleId = null; this.destination = null; this.status = 'Choose a title to buy.'; this.lastTick = -1; this.invalidate(); if (this.active) this.refresh(); }
}
