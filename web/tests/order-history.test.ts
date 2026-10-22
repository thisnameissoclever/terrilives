import {expect, it, vi} from 'vitest';
import * as historyUi from '../src/ui/order-history.js';
import {OrderDiagnostics, type OrderEvent} from '../src/ui/player-orders.js';
import {DisclosureDocument} from './helpers/disclosure-dom.js';

it('defaults to All independently of selection and copies all filtered raw fields even when records are closed', async () => {
  const doc = new DisclosureDocument(), disclosure = doc.createElement('details'), filter = doc.createElement('select');
  const list = doc.createElement('div'), notice = doc.createElement('p'), status = doc.createElement('span');
  const button = doc.createElement('button'), summary = doc.createElement('span'), copy = vi.fn(async (_text: string) => {});
  const diagnostics = new OrderDiagnostics({textContent: '', setAttribute() {}}, () => {});
  const records: OrderEvent[] = [
    {sequence:'1',tick:'22',actor:7,counterpart:9,orderId:'9007199254740993',action:'Chat',phase:'started',reason:null,blockingState:'Busy'},
    {sequence:'2',tick:'25',actor:11,counterpart:null,orderId:'21',action:'Work',phase:'completed',reason:'Paid',blockingState:null},
  ];
  const source = {orderEventsSince: () => ({events: records, nextCursor: '2', expired: true}),
    ids: () => Uint32Array.of(7, 9), kinds: () => Uint32Array.of(0, 0), selectedIndex: () => null,
    simName: (entity: number) => entity === 7 ? 'Tim' : entity === 9 ? 'Bill' : entity === 11 ? 'Retired person' : ''};
  diagnostics.update(0, source);
  source.ids = () => Uint32Array.of(7); source.kinds = () => Uint32Array.of(0);
  source.simName = entity => entity === 7 ? 'Tim' : '';
  const panel = new historyUi.OrderHistoryPanel(doc as never, {disclosure, filter, list, notice, status, copy: button, summary} as never,
    diagnostics, () => true, copy);
  panel.update(source);
  expect(list.children).toHaveLength(0);
  expect(filter.value).toBe('all');
  disclosure.open = true; disclosure.fire('toggle');
  expect(list.children).toHaveLength(2);
  expect(list.children.every(record => !record.open)).toBe(true);
  expect(list.textContent).toContain('Retired person');
  expect(notice.textContent).toContain('expired');
  button.fire('click'); await Promise.resolve();
  const copied = copy.mock.calls[0][0];
  expect(copied).toContain('9007199254740993'); expect(copied).toContain('"blockingState": "Busy"');
  expect(copied).toContain('"reason": null'); expect(copied).toContain('"actor": 11');
  const first = list.children[0]; first.open = true; first.fire('toggle');
  expect(first.textContent).toContain('"sequence": "1"');
  first.children[0].focus(); panel.update(source);
  expect(list.children[0]).toBe(first); expect(first.open).toBe(true);
  expect(doc.activeElement).toBe(first.children[0]);
  filter.value = '9'; filter.fire('change');
  expect(list.children).toHaveLength(1);
  expect(filter.children.map(option => option.textContent).join(' ')).toContain('Bill');
  button.fire('click'); await Promise.resolve();
  expect(copy.mock.calls[1][0]).not.toContain('"actor": 11');
  diagnostics.resetAfterLoad('0');
  records.splice(0, records.length, {...records[0], counterpart: null, action: 'Restored world action', blockingState: null});
  diagnostics.update(100, source); panel.update(source);
  expect(filter.value).toBe('all');
  expect(list.children).toHaveLength(1);
  expect(list.children[0]).not.toBe(first);
  expect(list.textContent).toContain('Restored world action');
  expect(list.textContent).not.toContain('Chat');
});

function historyFixture(diagnostics: OrderDiagnostics) {
  const doc = new DisclosureDocument(), disclosure = doc.createElement('details'), filter = doc.createElement('select');
  const list = doc.createElement('div'), notice = doc.createElement('p'), status = doc.createElement('span');
  const button = doc.createElement('button'), summary = doc.createElement('span'); disclosure.open = true;
  const panel = new historyUi.OrderHistoryPanel(doc as never, {disclosure, filter, list, notice, status, copy: button, summary} as never,
    diagnostics, () => true, async () => {});
  return {panel, filter, list};
}

it('keeps an actual object-use counterpart raw without inventing a Person option', async () => {
  const {readFileSync} = await import('node:fs');
  const {default: init, SimHandle} = await import('../src/wasm/terri_wasm.js');
  const {SimBridge} = await import('../src/bridge.js');
  const {memory} = await init({module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm')});
  const handle = SimHandle.from_lot(), source = new SimBridge(handle, memory);
  try {
    const ids = Array.from(source.ids()), kinds = Array.from(source.kinds());
    const actor = ids.find((entity, i) => kinds[i] === 0 && source.simName(entity) === 'Tim')!;
    const object = ids.find((entity, i) => kinds[i] === 1 && source.entityName(entity) === 'Armchair')!;
    const interaction = source.interactionLabels(object).indexOf('Sit');
    expect(actor).toBeDefined(); expect(object).toBeDefined(); expect(interaction).toBeGreaterThanOrEqual(0);
    const diagnostics = new OrderDiagnostics({textContent: '', setAttribute() {}}, () => {});
    expect(source.useObject(actor, object, interaction)).toBe(true); source.flushCommands(); diagnostics.update(0, source);
    expect(source.cancelIntents(actor)).toBe(true); source.flushCommands(); diagnostics.update(1, source);
    expect(diagnostics.events(null).some(event => event.actor === actor && event.counterpart === object && event.phase === 'accepted')).toBe(true);
    const {panel, filter} = historyFixture(diagnostics); panel.update(source);
    expect(filter.children.map(option => option.value)).not.toContain(String(object));
    expect(diagnostics.copyHistory(null)).toContain(`"counterpart": ${object}`);
    expect(diagnostics.copyHistory(null)).toContain('"canceled"');
  } finally {handle.free();}
});

it('retains proven social recipients and unknown actors, while load resets person provenance', () => {
  const diagnostics = new OrderDiagnostics({textContent: '', setAttribute() {}}, () => {});
  let ids = [7, 9, 26];
  let events: OrderEvent[] = [{sequence:'1',tick:'20',actor:7,counterpart:9,orderId:'5',action:'Chat',phase:'accepted',reason:null,blockingState:null},
    {sequence:'2',tick:'21',actor:123,counterpart:26,orderId:'6',action:'Use',phase:'accepted',reason:null,blockingState:null}];
  const source = {ids: () => Uint32Array.from(ids), kinds: () => Uint32Array.from(ids.map(entity => entity === 26 ? 1 : 0)),
    simName: (entity: number) => entity === 7 ? 'Tim' : ids.includes(entity) && entity === 9 ? 'Bill' : '',
    orderEventsSince: () => ({events, nextCursor: events.at(-1)!.sequence, expired: false})};
  diagnostics.update(0, source);
  const {panel, filter, list} = historyFixture(diagnostics); panel.update(source);
  expect(filter.children.map(option => option.value)).toContain('9');
  ids = [7, 26]; panel.update(source);
  expect(filter.children.find(option => option.value === '9')?.textContent).toContain('Bill');
  expect(filter.children.map(option => option.value)).not.toContain('26');
  expect(filter.children.find(option => option.value === '123')?.textContent).toContain('Person 123');
  filter.value = '9'; filter.fire('change'); expect(list.children).toHaveLength(1);
  expect(diagnostics.copyHistory(9)).toContain('"counterpart": 9');
  diagnostics.resetAfterLoad('0'); events = [{...events[0], sequence:'1'}]; diagnostics.update(1, source); panel.update(source);
  expect(filter.children.map(option => option.value)).not.toContain('9');
});
