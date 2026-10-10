import { PostcardReader } from './codec.js';

export interface PurchaseQuote {
  readonly title: string;
  readonly price: number;
  readonly home: { readonly shelf: bigint; readonly slot: number };
  readonly nextCopyId: number;
  readonly wire: Uint8Array;
}
export interface SaleQuote {
  readonly copy: number;
  readonly shelf: bigint;
  readonly price: number;
  readonly wire: Uint8Array;
}
export interface ReadingChoice { readonly titleId: string; readonly title: string; readonly progress: number }
export interface QuoteResult<T> { readonly quote: T | null; readonly refusal: string | null }

function check(valid: boolean): asserts valid {
  if (!valid) throw new Error('Malformed native book quote.');
}
function quote<T>(bytes: Uint8Array, read: (reader: PostcardReader) => T): QuoteResult<T> {
  const reader = new PostcardReader(bytes);
  check(reader.byte() === 1);
  const variant = reader.byte();
  check(variant <= 1);
  const result = variant === 0 ? { quote: read(reader), refusal: null } : { quote: null, refusal: reader.text() };
  check(result.refusal === null || result.refusal.trim().length > 0);
  reader.done();
  return result;
}
function shelf(reader: PostcardReader): bigint {
  const value = reader.uint(64);
  check(value <= 0xfffffffen);
  return value;
}
export function decodePurchaseQuote(bytes: Uint8Array): QuoteResult<PurchaseQuote> {
  return quote(bytes, reader => {
    const title = reader.text(), price = reader.number(), home = { shelf: shelf(reader), slot: reader.number(16) };
    const nextCopyId = reader.number();
    check(title.trim().length > 0 && price > 0 && nextCopyId < 0xffffffff);
    return { title, price, home, nextCopyId, wire: bytes.slice() };
  });
}
export function decodeSaleQuote(bytes: Uint8Array): QuoteResult<SaleQuote> {
  return quote(bytes, reader => {
    const copy = reader.number(), home = shelf(reader), price = reader.number();
    check(copy < 0xffffffff);
    return { copy, shelf: home, price, wire: bytes.slice() };
  });
}
export function decodeAutomaticRead(bytes: Uint8Array): ReadingChoice | null {
  const reader = new PostcardReader(bytes);
  check(reader.byte() === 1);
  const result = reader.option(() => {
    const titleId = reader.text(), title = reader.text(), progress = reader.float();
    check(((titleId.trim().length > 0 && title.trim().length > 0) || (titleId === '' && title === '' && progress === 0)) && progress >= 0 && progress <= 100);
    return { titleId, title, progress };
  });
  reader.done();
  return result;
}
