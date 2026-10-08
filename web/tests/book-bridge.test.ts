import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.js';
import { BookResults } from '../src/books/results.js';
import { BuyTool } from '../src/ui/buy-tool.js';
import { menuEntries } from '../src/ui/object-menu.js';
let memory: WebAssembly.Memory;
beforeAll(async () => { memory = (await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') })).memory; });
function fundTestHousehold(sim: SimBridge): void {
  // Sell only within this test's independent world, without adding a money setter.
  const shelves = new Set(sim.bookShelves().map(shelf => shelf.entity));
  for (const entity of Array.from(sim.ids())) {
    if (sim.funds() >= 500) break;
    if (shelves.has(entity) || !sim.objectName(entity)) continue;
    const preview = sim.salePreview(entity);
    if (preview.reason === null && preview.payout > 0) { sim.sellObject(entity); sim.flushCommands(); }
  }
  expect(sim.funds()).toBeGreaterThanOrEqual(500);
}

it('decodes the rebuilt runtime and handles a paused purchase, transfer and full destinations atomically', () => {
  const handle = SimHandle.from_lot(); const sim = new SimBridge(handle, memory);
  try {
    fundTestHousehold(sim);
    const title = sim.bookCatalogue()[0], shelf = sim.bookShelves()[0];
    const funds = sim.funds();
    expect(sim.buyBook(title.id, shelf.entity)).toBe(true); expect(sim.funds()).toBe(funds);
    sim.flushCommands(); const purchase = sim.takeBookResults()[0];
    expect(purchase.refusal).toBeNull(); expect(sim.funds()).toBe(funds - title.price);
    expect(sim.bookCopies()).toHaveLength(1); expect(sim.takeBookResults()).toEqual([]);
    expect(sim.transferBook(purchase.copy!, null)).toBe(true); sim.flushCommands(); expect(sim.takeBookResults()[0].refusal).toBeNull();
    for (let n = 0; n < shelf.capacity; n++) { expect(sim.buyBook(title.id, shelf.entity)).toBe(true); sim.flushCommands(); expect(sim.takeBookResults()[0].refusal).toBeNull(); }
    expect(sim.buyBook(title.id, shelf.entity)).toBe(true); sim.flushCommands();
    const fallback = sim.takeBookResults()[0]; expect(sim.bookCopies().find(copy => copy.id === fallback.copy)?.location.kind).toBe('inventory');
    const before = sim.saveBytes(); const beforeFunds = sim.funds();
    expect(sim.transferBook(purchase.copy!, shelf.entity)).toBe(true); sim.flushCommands(); expect(sim.takeBookResults()[0].refusal).toBe('shelf_full');
    expect(sim.saveBytes()).toEqual(before); expect(sim.funds()).toBe(beforeFunds);
    expect(sim.buyBook(title.id, 0xfffffffe)).toBe(true); sim.flushCommands(); expect(sim.takeBookResults()[0].refusal).toBe('unknown_shelf'); expect(sim.funds()).toBe(beforeFunds);
    for (const value of [-1, .5, 0xffffffff, 0x100000000, NaN, Infinity]) {
      expect(sim.buyBook(title.id, value)).toBe(false); expect(sim.transferBook(value, null)).toBe(false); expect(sim.readBook(value, shelf.entity, 'read', title.id, true)).toBe(false);
    }
    expect(sim.bookState().copies).toHaveLength(shelf.capacity + 2);
  } finally { handle.free(); }
});
it('uses stable model/action identity, combines room/need filters and keeps browsing deterministic', () => {
  const handle = SimHandle.from_lot(); const sim = new SimBridge(handle, memory);
  try {
    fundTestHousehold(sim);
    const models = sim.modelFacts(); expect(models.every(model => model.id && model.typeLabel)).toBe(true);
    const bookcase = models.find(model => model.id === 'bookshelf')!;
    expect([bookcase.shelfCapacity, bookcase.shelfAccessPoints]).toEqual([24, 1]);
    expect(bookcase.actions.find(action => action.id === 'read')!.capacity).toBeNull();
    for (const id of ['television', 'radio']) {
      const action = models.find(model => model.id === id)!.actions[0];
      expect(action.capacity).toBe(2);
      expect(action.optionalRequirements).toEqual([]);
      expect(action.additionalDetails).toContain('Social requires liked company using the same device');
      expect(action.additionalDetails).toContain('Comfort depends on the seat actually used');
    }
    const armchairs = sim.catalogue().filter(item => item.model?.typeId === 'armchair');
    expect(armchairs.length).toBeGreaterThan(1); expect(new Set(armchairs.map(item => item.model!.id)).size).toBe(armchairs.length);
    const tool = new BuyTool(sim, handle.lot_width(), handle.lot_height(), { changed() {} }); tool.enter();
    const item = armchairs[0]; const room = item.model!.rooms[0]; tool.setRoomFilter(room); tool.setFilter(5);
    expect(tool.items.filter(item => tool.shows(item)).every(item => item.model?.rooms.includes(room) && (item.needs & (1 << 5)) !== 0)).toBe(true);
    tool.choose(item.definition); expect(tool.chosen?.model?.id).toBe(item.model?.id);
    tool.setRoomFilter('missing'); expect(tool.chosen).toBeNull(); tool.resetAfterLoad(24, 24); expect(tool.roomFilter).toBeNull();
    const person = Array.from(sim.ids()).find(id => sim.simName(id))!; sim.select(person); sim.flushCommands();
    const shelf = sim.bookShelves()[0].entity, title = sim.bookCatalogue()[0].id; sim.buyBook(title, shelf); sim.flushCommands(); sim.takeBookResults();
    const saved = sim.saveBytes(), hash = sim.worldHash();
    for (let n = 0; n < 5; n++) { sim.modelFacts(); sim.bookState(); sim.bookInterest(person, title); sim.readingProgress(person, title); sim.readingChoices(shelf); }
    expect(sim.saveBytes()).toEqual(saved); expect(sim.worldHash()).toBe(hash);
    const menu = menuEntries(sim.objectName(shelf), sim.interactionLabels(shelf), shelf, sim.objectDetails(shelf), sim.readingChoices(shelf));
    expect(menu.entries[0].action).toEqual({ kind: 'use', object: shelf, interaction: 0 });
    expect(menu.entries.find(entry => entry.titleChoice)?.action).toEqual({ kind: 'read', object: shelf, action: 'read', title });
    sim.readBook(person, shelf, 'read', title, false); sim.readBook(person, shelf, 'read', title, false); sim.flushCommands(); sim.takeBookResults();
    expect(sim.actionQueueOf(person).filter(label => label.includes(sim.bookCatalogue()[0].title))).toHaveLength(2);
    const results = new BookResults(sim); const savedPending = (() => { sim.buyBook(title, null); return sim.saveBytes(); })();
    expect(sim.loadBytes(savedPending)).toBe(true); results.resetAfterLoad(); expect(results.submit(() => sim.buyBook(title, null), () => {})).toBe(false);
    sim.flushCommands(); results.drain(); expect(results.submit(() => sim.buyBook(title, null), result => expect(result.refusal).toBeNull())).toBe(true); sim.flushCommands(); results.drain();
  } finally { handle.free(); }
});
it('imports legacy books without adding upgrade prose to the status panel', () => {
  const handle = SimHandle.from_lot(); const sim = new SimBridge(handle, memory);
  try {
    const html = readFileSync('index.html', 'utf8');
    expect(html).not.toContain('id="book-import-notice"');
    expect(sim.takeLegacyBookImportNotice()).toBe(false);
    const old = Uint8Array.from(Buffer.from(readFileSync('../crates/terri-wasm/tests/fixtures/pre-voice-157.hex', 'utf8').replace(/\s/g, ''), 'hex'));
    expect(sim.loadBytes(old)).toBe(true); expect(sim.takeLegacyBookImportNotice()).toBe(true);
    expect(sim.bookCopies()).toHaveLength(5); expect(sim.takeLegacyBookImportNotice()).toBe(false);
    const current = sim.saveBytes(); expect(sim.loadBytes(current)).toBe(true); expect(sim.takeLegacyBookImportNotice()).toBe(false);
    expect(sim.bookCopies()).toHaveLength(5);
    expect(sim.loadBytes(old.slice(0, -1))).toBe(false); expect(sim.takeLegacyBookImportNotice()).toBe(false);
  } finally { handle.free(); }
});
it('shows the real dropped copy and its retained home, then recovers the same copy through transferBook', () => {
  const handle = SimHandle.from_lot(); const sim = new SimBridge(handle, memory);
  try {
    expect(sim.loadBytes(Uint8Array.from(readFileSync('tests/fixtures/owned-reading-dropped.sav')))).toBe(true);
    const state = sim.bookState(), copy = state.copies[0], before = sim.funds();
    expect(copy.location.kind).toBe('lot'); expect(copy.borrowerSimId).toBeNull(); expect(copy.home).not.toBeNull();
    expect(Array.from(sim.ids()).filter(entity => sim.simName(entity))).toHaveLength(2);
    const home = copy.home!; expect(state.shelves.find(shelf => shelf.entity === Number(home.shelf))!.reserved[home.slot]).toBe(copy.id);
    sim.transferBook(copy.id, Number(home.shelf)); sim.flushCommands(); expect(sim.takeBookResults()[0].refusal).toBeNull();
    expect(sim.bookCopies().find(current => current.id === copy.id)).toMatchObject({ titleId: copy.titleId, location: { kind: 'shelf' } });
    expect(sim.funds()).toBe(before);
  } finally { handle.free(); }
});
it('projects the runtime snack program into its existing action row without adding unrelated requirements', () => {
  const handle = SimHandle.from_lot(); const sim = new SimBridge(handle, memory);
  try {
    const fridge = sim.modelFacts().find(model => model.id === 'fridge')!;
    const snack = fridge.actions.find(action => action.id === 'grab_snack')!;
    expect(snack.requirements).toContain('prep_surface');
    expect(snack.durationTicks).toBe(85);
    expect(snack.workKind).toBe('recipe');
    expect(snack.benefits).toEqual([[0, 40]]);
    expect(fridge.actions.some(action => action.id === 'prepare_snack')).toBe(false);
    expect(fridge.actions.map(action => action.id)).toEqual(['grab_snack', 'cook_dinner']);
    expect(sim.interactionLabels(Array.from(sim.ids()).find(entity => sim.objectModel(entity)?.id === 'fridge')!)).toHaveLength(fridge.actions.length);
    expect(sim.modelFacts().find(model => model.id === 'armchair')!.actions.find(action => action.id === 'take_the_chair')!.requirements).toEqual([]);
  } finally { handle.free(); }
});
