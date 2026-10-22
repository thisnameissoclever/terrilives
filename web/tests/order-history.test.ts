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
    ids: () => Uint32Array.of(7), kinds: () => Uint32Array.of(0), selectedIndex: () => null,
    simName: (entity: number) => entity === 7 ? 'Tim' : entity === 11 ? 'Retired person' : ''};
  diagnostics.update(0, source);
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
  expect(filter.children.map(option => option.textContent).join(' ')).toContain('Person 9');
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
