import type { SimBridge } from '../bridge.js';
import type { PurchaseQuote, SaleQuote } from '../books/commerce-codec.js';
import { BookResults, bookRefusal } from '../books/results.js';
import { formatFunds } from './game-hud.js';

type CommerceSource = Pick<SimBridge, 'bookPurchaseQuote' | 'bookPurchasePrice' | 'bookSaleQuote' | 'buyAutomaticBook' | 'sellBook' | 'recoverBook' | 'bookState' | 'objectModel' | 'funds'>;

/** Request lifetime belongs here; native quotes own choices and prices. */
export class BookCommerce {
  private readonly root: HTMLElement;
  private readonly count: HTMLElement;
  private readonly buy: HTMLButtonElement;
  private readonly sell: HTMLButtonElement;
  private purchase: PurchaseQuote | null = null;
  private sale: SaleQuote | null = null;
  private signature = '';

  constructor(private readonly source: CommerceSource, private readonly results: BookResults,
    doc: Document, private readonly status: (text: string, error: boolean) => void) {
    this.root = doc.createElement('section'); this.root.className = 'book-commerce'; this.root.hidden = true;
    this.count = doc.createElement('p'); this.root.append(this.count);
    const actions = doc.createElement('div'); actions.className = 'book-commerce-actions'; this.root.append(actions);
    this.buy = doc.createElement('button'); this.sell = doc.createElement('button');
    for (const button of [this.buy, this.sell]) { button.type = 'button'; button.className = 'hud-button'; actions.append(button); }
    this.buy.addEventListener('click', () => this.purchase && this.purchaseBook(this.purchase));
    this.sell.addEventListener('click', () => this.sale && this.sellBook(this.sale));
    const furniture = doc.querySelector('#furniture-tool');
    if (!furniture) throw new Error('Missing furniture controls.');
    furniture.append(this.root);
  }

  private request(stage: () => boolean, success: string): boolean {
    const admitted = this.results.submit(stage, result => {
      this.signature = '';
      this.status(result.refusal ? bookRefusal(result.refusal) : success, result.refusal !== null);
    });
    if (!admitted) this.status('That book action could not be added.', true);
    this.signature = '';
    return admitted;
  }
  purchaseBook(quote: PurchaseQuote): boolean { return this.request(() => this.source.buyAutomaticBook(quote.wire), 'Book bought.'); }
  sellBook(quote: SaleQuote): boolean { return this.request(() => this.source.sellBook(quote.wire), 'Book sold.'); }
  recoverBook(copy: number): boolean { return this.request(() => this.source.recoverBook(copy), 'Book recovered.'); }
  resetAfterLoad(): void { this.purchase = null; this.sale = null; this.signature = ''; this.root.hidden = true; }

  render(object: number | null, blocked = false): void {
    if (object === null || !(this.source.objectModel(object)?.shelfCapacity)) { this.root.hidden = true; return; }
    const purchase = this.source.bookPurchaseQuote().quote, sale = this.source.bookSaleQuote(object).quote;
    const count = this.source.bookState().copies.filter(copy => copy.home?.shelf === BigInt(object)).length;
    const price = purchase?.price ?? this.source.bookPurchasePrice();
    const signature = JSON.stringify([object, count, price, purchase, sale, blocked, this.results.unavailable, this.source.funds()],
      (_, value) => typeof value === 'bigint' ? value.toString() : value);
    if (signature === this.signature && !this.root.hidden) return;
    this.signature = signature; this.purchase = purchase; this.sale = sale; this.root.hidden = false;
    this.count.textContent = `Books: ${count}`;
    const label = (button: HTMLButtonElement, text: string, price: number | undefined) => {
      button.replaceChildren(); const title = button.ownerDocument.createElement('span'); title.textContent = text; button.append(title);
      if (price !== undefined) { const money = button.ownerDocument.createElement('small'); money.className = 'action-price'; money.textContent = `$${formatFunds(price)}`; button.append(money); }
    };
    label(this.buy, 'Buy book', price ?? undefined); label(this.sell, 'Sell book', sale?.price);
    this.buy.disabled = blocked || this.results.unavailable || !purchase || purchase.price > this.source.funds();
    this.sell.disabled = blocked || this.results.unavailable || !sale;
  }
}
