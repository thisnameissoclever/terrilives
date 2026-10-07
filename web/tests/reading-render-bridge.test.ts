import { expect, it } from 'vitest';
import { SimBridge } from '../src/bridge.js';
import type { SimHandle } from '../src/wasm/terri_wasm.js';

it('refreshes independently sized projections on pointer changes, shrink, same-count loads and memory growth', () => {
  const memory = new WebAssembly.Memory({ initial: 1 });
  let pointer = 128, words = 2, drops = 2;
  const handle = {
    entity_count: () => 3,
    shelfBookMasksPtr: () => pointer,
    shelfBookMaskCount: () => words,
    droppedBookIdsPtr: () => pointer + 32,
    droppedBookPositionsPtr: () => pointer + 64,
    droppedBookCount: () => drops,
    seated_places_ptr: () => pointer + 96,
    carriedBooksPtr: () => pointer + 112,
    reading_copies_ptr: () => pointer + 112,
  } as unknown as SimHandle;
  const source = new SimBridge(handle, memory);
  new Uint32Array(memory.buffer, pointer, words).set([1, 2]);
  const old = source.shelfBookMasks();
  expect(source.shelfBookMasks()).toBe(old);
  expect(source.seatedPlaces()).toHaveLength(3);
  new Uint32Array(memory.buffer, pointer + 112, 3).set([0, 0xffffffff, 5]);
  expect(Array.from(source.carriedBooks())).toEqual([0, 0xffffffff, 5]);
  expect(Array.from(source.readingCopies())).toEqual([0, 0xffffffff, 5]);
  pointer = 512;
  new Uint32Array(memory.buffer, pointer, words).set([4, 8]);
  expect(Array.from(source.shelfBookMasks())).toEqual([4, 8]);
  words = 1; drops = 1;
  expect(source.shelfBookMasks()).toHaveLength(1);
  expect(source.droppedBookIds()).toHaveLength(1);
  expect(source.droppedBookPositions()).toHaveLength(2);
  const held = source.droppedBookPositions();
  memory.grow(1);
  expect(source.droppedBookPositions() === held).toBe(false);
  expect(source.droppedBookPositions().buffer).toBe(memory.buffer);
  words = 0; drops = 0;
  expect(source.shelfBookMasks()).toHaveLength(0);
  expect(source.droppedBookIds()).toHaveLength(0);
});
