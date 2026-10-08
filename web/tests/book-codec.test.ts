import { describe, expect, it } from 'vitest';
import { decodeModelFacts, decodeBookCatalogue, decodeBookCopies, decodeBookMemory, decodeBookResults, decodeBookShelves, PostcardReader, shelfEntity } from '../src/books/codec.js';

// Checked byte-for-byte by browser_books_postcard_witnesses in terri-wasm.
const TITLES = Uint8Array.from([1,1,116,10,67,97,102,195,169,32,240,159,147,150,4,239,187,191,65,1,103,128,1,128,128,1]);
const COPIES = Uint8Array.from([4,127,1,116,0,0,0,128,1,1,116,1,47,23,1,47,23,1,128,128,1,255,127,1,116,2,128,128,1,1,129,128,128,128,128,128,128,16,255,255,3,1,128,128,1,254,255,255,255,15,1,116,3,0,0,32,64,0,0,80,192,0,0]);
const MEMORY = Uint8Array.from([1,128,128,1,1,116,128,1,0,0,128,62,1,0,0,0,63,0,0,64,63,129,128,128,128,128,128,128,16,2]);

describe('native book postcard witnesses', () => {
  it('preserves a real dropped copy reserved home after its borrower dies', () => {
    const bytes = Uint8Array.from([1,128,128,1,1,116,3,0,0,160,63,0,0,32,64,1,47,23,0]);
    expect(decodeBookCopies(bytes)[0]).toEqual({ id: 16384, titleId: 't', location: { kind: 'lot', x: 1.25, y: 2.5 }, home: { shelf: 47n, slot: 23 }, borrowerSimId: null });
    for (let n = 0; n < bytes.length; n++) expect(() => decodeBookCopies(bytes.slice(0,n))).toThrow();
  });
  it('preserves UTF-8, leading BOM, integer boundaries and all four copy locations', () => {
    const titles = decodeBookCatalogue(TITLES);
    expect(titles[0]).toEqual({ id: 't', title: 'Café 📖', description: '\ufeffA', genre: 'g', readingMinutes: 128, price: 16384 });
    const copies = decodeBookCopies(COPIES, titles);
    expect(copies.map(copy => copy.id)).toEqual([127, 128, 16383, 0xfffffffe]);
    expect(copies.map(copy => copy.location.kind)).toEqual(['inventory', 'shelf', 'carried', 'lot']);
    expect(copies[2].home).toEqual({ shelf: 9007199254740993n, slot: 65535 });
    expect(copies[2].borrowerSimId).toBe(16384);
    expect(copies[3].location).toEqual({ kind: 'lot', x: 2.5, y: -3.25 });
    expect(() => shelfEntity(copies[2].home!.shelf)).toThrow();
    expect(() => shelfEntity(4294967296n)).toThrow();
    expect(decodeBookMemory(MEMORY)).toMatchObject({ progressTicks: 128, progressFraction: 0.25, lastReadTick: 9007199254740993n, familiarity: 0.75 });
  });
  it('rejects every truncation and trailing bytes independently of the happy path', () => {
    for (const [bytes, decode] of [[TITLES, decodeBookCatalogue], [COPIES, decodeBookCopies], [MEMORY, decodeBookMemory]] as const) {
      for (let n = 0; n < bytes.length; n++) expect(() => decode(bytes.slice(0, n))).toThrow();
      expect(() => decode(Uint8Array.from([...bytes, 0]))).toThrow();
    }
    expect(decodeBookCatalogue(Uint8Array.of(0))).toEqual([]);
    expect(decodeBookCopies(Uint8Array.of(0))).toEqual([]);
    expect(decodeBookMemory(Uint8Array.of(0))).toBeNull();
  });
  it('refuses malformed tags, identities, UTF-8, floats and counts', () => {
    const altered = (bytes: Uint8Array, index: number, value: number) => { const copy = bytes.slice(); copy[index] = value; return copy; };
    expect(() => decodeBookCopies(altered(COPIES, 4, 4))).toThrow();
    expect(() => decodeBookCopies(altered(COPIES, 5, 2))).toThrow();
    expect(() => decodeBookCatalogue(altered(TITLES, 7, 255))).toThrow();
    expect(() => decodeBookCatalogue(altered(TITLES, 0, 128))).toThrow();
    expect(() => decodeBookCopies(altered(altered(COPIES, 59, 128), 60, 127))).toThrow();
    expect(() => decodeBookCopies(COPIES, [])).toThrow();
    expect(() => decodeBookCatalogue(Uint8Array.from([2, ...TITLES.slice(1), ...TITLES.slice(1)]))).toThrow();
    expect(() => new PostcardReader(Uint8Array.from([255,255,255,255,16])).uint()).toThrow();
    expect(() => new PostcardReader(Uint8Array.from([128,0])).uint()).toThrow();
    expect(() => new PostcardReader(Uint8Array.from([128,128,128,128,128])).uint()).toThrow();
  });
  it('keeps u64 results exact and rejects ambiguous consuming rows', () => {
    expect(decodeBookResults(['9007199254740993', '4294967294', '18446744073709551615', ''])).toEqual([
      { sequence: 9007199254740993n, copy: 4294967294, order: 18446744073709551615n, refusal: null }]);
    for (const row of [['1'], ['0','','',''], ['1','-1','',''], ['1','','18446744073709551616',''], ['1','','','', '1','','','']]) expect(() => decodeBookResults(row)).toThrow();
    expect(decodeBookResults(['1', '', '', 'future_reason'])[0].refusal).toBe('future_reason');
    expect(() => decodeBookShelves(Uint32Array.of(1))).toThrow();
    expect(() => decodeBookShelves(Uint32Array.of(1, 24, 1, 24))).toThrow();
    expect(() => decodeBookShelves(Uint32Array.of(1, 65536))).toThrow();
  });
});

it('decodes native borrower capacity separately from shelf space and collection places', () => {
  const bytes = Uint8Array.from([1,0,1,115,8,66,111,111,107,99,97,115,101,5,83,104,101,108,102,6,83,104,101,108,102,46,8,98,111,111,107,99,97,115,101,7,115,116,111,114,97,103,101,7,83,116,111,114,97,103,101,1,11,108,105,118,105,110,103,95,114,111,111,109,1,1,24,1,60,2,4,114,101,97,100,11,82,101,97,100,32,97,32,98,111,111,107,60,0,1,0,166,155,68,59,4,0,0,240,65,0,0,0,0,166,155,68,59,0,0,128,63,1,22,65,118,97,105,108,97,98,108,101,32,115,104,101,108,118,101,100,32,98,111,111,107,8,111,114,100,105,110,97,114,121,0,0,7,105,110,115,112,101,99,116,7,73,110,115,112,101,99,116,1,1,1,0,0,0,0,0,0,0,0,8,111,114,100,105,110,97,114,121,1,10,109,101,97,108,95,116,97,98,108,101,1,1,12,112,114,101,112,95,115,117,114,102,97,99,101]);
  const model = decodeModelFacts(bytes)[0];
  expect(model.roles).toEqual(['prep_surface']);
  expect(model.actions[0].optionalRequirements).toEqual([]);
  expect(model.actions[1].optionalRequirements).toEqual(['meal_table']);
  expect(model.shelfCapacity).toBe(24); expect(model.shelfAccessPoints).toBe(1);
  expect(model.actions[0].capacity).toBeNull(); expect(model.actions[1].capacity).toBe(1);
  expect(model.actions[0].seatsAddViewers).toBe(false); expect(model.actions[1].seatsAddViewers).toBe(true);
  // Fixed offsets are pinned by the independent native literal witness above.
  expect(Array.from(bytes.slice(164,167))).toEqual([1,1,0]);
  const noOrdinaryLimit = Uint8Array.from([...bytes.slice(0,164), 0, ...bytes.slice(166)]);
  expect(() => decodeModelFacts(noOrdinaryLimit)).toThrow();
  for (const [offset, value] of [[66,0], [67,0], [164,2], [165,0]]) {
    const malformed = bytes.slice(); malformed[offset] = value;
    expect(() => decodeModelFacts(malformed)).toThrow();
  }
  for (let n = 0; n < bytes.length; n++) expect(() => decodeModelFacts(bytes.slice(0,n))).toThrow();
  expect(() => decodeModelFacts(Uint8Array.from([...bytes, 0]))).toThrow();
});
