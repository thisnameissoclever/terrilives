import { expect, it } from 'vitest';
import { surfaceMenuEntries } from '../src/ui/object-menu.js';

const wire = Uint8Array.of(1);
const source = {
  entityName: () => 'Bookcase', interactionLabels: () => ['Read'], selectedIndex: () => null,
  objectModel: () => ({ shelfCapacity: 24, actions: [{ id: 'read', reading: true }] }),
  automaticReadingChoice: () => null,
  bookPurchaseQuote: () => ({ quote: { title: 'x', price: 6, home: { shelf: 9n, slot: 20 }, nextCopyId: 3, wire }, refusal: null }),
  bookSaleQuote: () => ({ quote: { copy: 1, shelf: 9n, price: 3, wire }, refusal: null }),
  pendingBookCommands: () => 0,
};

it('exposes Build and exact-price commerce without a selected Sim', () => {
  const menu = surfaceMenuEntries(source, 9);
  expect(menu.entries.find(entry => entry.action.kind === 'build')).toMatchObject({ label: 'Enter build mode', enabled: true, action: { object: 9 } });
  expect(menu.entries.find(entry => entry.action.kind === 'buy-book')).toMatchObject({ enabled: true, price: 6 });
  expect(menu.entries.find(entry => entry.action.kind === 'sell-book')).toMatchObject({ enabled: true, price: 3 });
  expect(menu.entries[0].enabled).toBe(false);
  expect(menu.entries.some(entry => entry.action.kind === 'cancel')).toBe(false);
});

it('decorative furniture can enter Build and never gains fabricated book actions', () => {
  const menu = surfaceMenuEntries({ entityName: () => 'Plant', interactionLabels: () => [], selectedIndex: () => null }, 14);
  expect(menu.entries).toHaveLength(1);
  expect(menu.entries[0].action).toEqual({ kind: 'build', object: 14 });
});

it('uses one automatic reading preview and refuses commerce while a command is pending', () => {
  const menu = surfaceMenuEntries({ ...source, selectedIndex: () => 2,
    automaticReadingChoice: () => ({ titleId: 'x', title: 'An unfinished book', progress: 42 }), pendingBookCommands: () => 1 }, 9);
  expect(menu.entries[0]).toMatchObject({ label: 'Read book', enabled: true, secondary: 'An unfinished book · 42%' });
  expect(menu.entries.find(entry => entry.action.kind === 'buy-book')?.enabled).toBe(false);
  expect(menu.entries.find(entry => entry.action.kind === 'sell-book')?.enabled).toBe(false);
});

it('keeps Build on dirty furniture and disables clean-up without a Sim', () => {
  const menu = surfaceMenuEntries({ ...source, dishPiles: () => Uint32Array.of(9, 0, 1) }, 9);
  expect(menu.object).toBe(9);
  expect(menu.entries.map(entry => [entry.action.kind, entry.enabled])).toEqual([['clean', false], ['build', true]]);
});
