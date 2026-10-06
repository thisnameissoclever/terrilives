import { expect, it } from 'vitest';
import { BookResults } from '../src/books/results.js';
import type { BookResult } from '../src/books/codec.js';
import { BookTool, bookLocation, type BookSource, type BookState } from '../src/ui/book-tool.js';

function fixture() {
  let commands = 0, sequence = 1n;
  let results: BookResult[] = [];
  const sent: unknown[][] = [];
  const state: BookState = { copies: [], shelves: [{ entity: 44, capacity: 1, visible: [null], reserved: [null] }] };
  const title = { id: 'title', title: '<Title>', genre: 'fiction', description: '<unsafe>', readingMinutes: 180, price: 12 };
  const source = {
    bookCatalogue: () => [title], bookState: () => state, bookInterest: () => 0.5, readingProgress: () => null,
    selectedIndex: () => 7, simName: () => 'Person', simIdOf: (entity: number) => entity === 7 ? 500 : null,
    ids: () => Uint32Array.of(7, 44), objectName: () => 'Bookcase', objectDetails: () => undefined, funds: () => 100,
    buyBook: (title: string, shelf: number | null) => { sent.push(['buy', title, shelf]); commands++; return true; },
    transferBook: (copy: number, shelf: number | null) => { sent.push(['transfer', copy, shelf]); commands++; return true; },
    pendingBookCommands: () => commands, takeBookResults: () => { const rows = results; results = []; return rows; },
  };
  const coordinator = new BookResults(source);
  const tool = new BookTool(source as BookSource, coordinator, () => {}); tool.enter(); tool.choose(title.id);
  return { tool, state, source, coordinator, sent,
    savedPending: () => { commands++; },
    finish: (refusal: string | null = null, copy: number | null = 1) => { commands = 0; results = [{ sequence: sequence++, copy, order: null, refusal }]; coordinator.drain(); },
    newWorld: () => { commands = 0; sequence = 1n; results = []; coordinator.resetAfterLoad(); tool.resetAfterLoad(); } };
}
it('stages one purchase and reads its actual inventory fallback across hidden panels', () => {
  const f = fixture(); f.tool.setDestination(44); f.tool.buy(); f.tool.buy(); f.tool.exit();
  expect(f.sent).toEqual([['buy', 'title', 44]]); expect(f.state.copies).toHaveLength(0);
  f.state.copies.push({ id: 1, titleId: 'title', location: { kind: 'inventory' }, home: null, borrowerSimId: null });
  f.finish(); expect(f.tool.pending).toBe(false); expect(f.tool.status).toContain('selected bookcase filled');
});
it('full or stale transfer preserves origin and reports the native refusal', () => {
  const f = fixture(); const copy = { id: 2, titleId: 'title', location: { kind: 'lot' as const, x: 3.5, y: 4 }, home: null, borrowerSimId: null }; f.state.copies.push(copy);
  f.tool.transfer(2, 44); f.finish('shelf_full', null); expect(f.state.copies[0]).toEqual(copy);
  expect(f.tool.status).toContain('stayed where it was');
  f.tool.buy(); f.finish('unknown_shelf', null); expect(f.tool.status).toContain('No purchase was charged');
});
it('keeps restored requests separate and shares one pending slot across all operations', () => {
  const f = fixture(); f.savedPending(); f.tool.buy(); expect(f.sent).toEqual([]); f.finish('unknown_title', null);
  f.tool.buy(); expect(f.coordinator.submit(() => true, () => { throw new Error('stolen'); })).toBe(false);
  f.newWorld(); expect(f.tool.titleId).toBeNull(); expect(f.tool.pending).toBe(false);
  f.tool.choose('title'); f.tool.buy(); f.finish(); expect(f.tool.pending).toBe(false);
});
it('preserves duplicate-title copies, borrower identity and dropped recovery coordinates', () => {
  const f = fixture(); f.state.copies.push(
    { id: 1, titleId: 'title', location: { kind: 'inventory' }, home: null, borrowerSimId: null },
    { id: 2, titleId: 'title', location: { kind: 'carried', simId: 500 }, home: { shelf: 44n, slot: 0 }, borrowerSimId: 500 },
    { id: 3, titleId: 'title', location: { kind: 'lot', x: 1.5, y: 2.5 }, home: null, borrowerSimId: null });
  expect(bookLocation(f.state.copies[1], f.source)).toContain('borrowed by Person');
  f.tool.transfer(2, null); expect(f.sent).toEqual([]);
  expect(bookLocation(f.state.copies[2], f.source)).toContain('(1.5, 2.5)');
  f.tool.transfer(3, null); expect(f.sent).toEqual([['transfer', 3, null]]);
});
it('fails closed on malformed projections instead of showing an empty library', () => {
  const f = fixture(); f.source.bookState = () => { throw new Error('bad'); }; f.tool.refresh(); f.tool.buy();
  expect(f.tool.error).toContain('unavailable'); expect(f.sent).toEqual([]);
});
