import { expect, it } from 'vitest';
import { decodePurchaseQuote, decodeSaleQuote, decodeAutomaticRead } from '../src/books/commerce-codec.js';

it('decodes exact quote values and preserves the native request bytes', () => {
  const bytes = Uint8Array.of(1, 0, 1, 120, 6, 7, 20, 3);
  const result = decodePurchaseQuote(bytes);
  expect(result.quote).toMatchObject({ title: 'x', price: 6, home: { shelf: 7n, slot: 20 }, nextCopyId: 3 });
  expect(result.quote?.wire).toEqual(bytes);
  bytes[4] = 99;
  expect(result.quote?.wire[4]).toBe(6);
  expect(decodeSaleQuote(Uint8Array.of(1, 0, 3, 7, 3)).quote).toMatchObject({ copy: 3, shelf: 7n, price: 3 });
});

it('rejects truncated, trailing, unsupported and forged protocol values', () => {
  const valid = Uint8Array.of(1, 0, 1, 120, 6, 7, 20, 3);
  for (let cut = 0; cut < valid.length; cut++) expect(() => decodePurchaseQuote(valid.slice(0, cut))).toThrow();
  expect(() => decodePurchaseQuote(Uint8Array.from([...valid, 0]))).toThrow();
  const badVersion = valid.slice(); badVersion[0] = 2;
  expect(() => decodePurchaseQuote(badVersion)).toThrow();
  const zeroPrice = valid.slice(); zeroPrice[4] = 0;
  expect(() => decodePurchaseQuote(zeroPrice)).toThrow();
});

it('keeps native refusals distinct from unavailable automatic reading', () => {
  expect(decodePurchaseQuote(Uint8Array.of(1, 1, 1, 120))).toEqual({ quote: null, refusal: 'x' });
  expect(decodeAutomaticRead(Uint8Array.of(1, 0))).toBeNull();
  const float = new Uint8Array(4); new DataView(float.buffer).setFloat32(0, 42, true);
  expect(decodeAutomaticRead(Uint8Array.from([1, 1, 1, 120, 1, 88, ...float]))).toEqual({ titleId: 'x', title: 'X', progress: 42 });
});
