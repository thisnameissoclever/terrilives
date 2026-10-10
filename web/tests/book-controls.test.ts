import { expect, it } from 'vitest';
import { BookResults } from '../src/books/results.js';
import { BookCommerce } from '../src/ui/book-commerce.js';
import type { BookResult } from '../src/books/codec.js';

class Element {
  ownerDocument!: Document; className = ''; hidden = false; disabled = false; textContent = ''; type = '';
  children: Element[] = []; listeners = new Map<string, () => void>();
  append(...nodes: Element[]) { this.children.push(...nodes); }
  replaceChildren(...nodes: Element[]) { this.children = nodes; }
  addEventListener(name: string, callback: () => void) { this.listeners.set(name, callback); }
  click() { if (!this.disabled) this.listeners.get('click')?.(); }
}

it('renders count and priced Buy/Sell controls, preserves displayed quotes and blocks pending work', () => {
  const furniture = new Element();
  const doc = { createElement: () => Object.assign(new Element(), { ownerDocument: doc }), querySelector: () => furniture } as unknown as Document;
  const wire = Uint8Array.of(1, 0, 8);
  const quote = { title: 'one', price: 20, home: { shelf: 4n, slot: 12 }, nextCopyId: 3, wire };
  let pending = 0, results: BookResult[] = [], submitted: Uint8Array | null = null;
  const source = { objectModel: () => ({ shelfCapacity: 24 }), funds: () => 100,
    bookPurchaseQuote: () => ({ quote, refusal: null }), bookSaleQuote: () => ({ quote: null, refusal: 'no_sale_copy' }),
    bookState: () => ({ copies: [{ home: { shelf: 4n } }] }),
    buyAutomaticBook: (bytes: Uint8Array) => { submitted = bytes; pending++; return true; },
    sellBook: () => true, recoverBook: () => true, pendingBookCommands: () => pending,
    takeBookResults: () => { const batch = results; results = []; return batch; } };
  const coordinator = new BookResults(source), messages: string[] = [];
  const controls = new BookCommerce(source as any, coordinator, doc, message => messages.push(message));
  controls.render(4);
  const panel = furniture.children[0], [buy, sell] = panel.children[1].children;
  expect(panel.children[0].textContent).toBe('Books: 1');
  expect(buy.children.map(node => node.textContent)).toEqual(['Buy book', '$20']);
  expect(sell.disabled).toBe(true);
  buy.click(); expect(submitted).toBe(wire);
  controls.render(4); expect(buy.disabled).toBe(true); expect(controls.purchaseBook(quote)).toBe(false);
  pending = 0; results = [{ sequence: 1n, copy: 3, order: null, refusal: 'stale_quote' }]; coordinator.drain();
  expect(messages.at(-1)).toContain('selection changed');
  controls.render(4); expect(buy.disabled).toBe(false);
  controls.resetAfterLoad(); expect(panel.hidden).toBe(true);
  controls.render(null); expect(panel.hidden).toBe(true);
  controls.render(4, true); expect(buy.disabled).toBe(true);
});
