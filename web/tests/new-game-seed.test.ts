import { expect, it } from 'vitest';
import { newGameSeed } from '../src/new-game-seed.js';

it('requests fresh entropy for both seed words on each new game', () => {
  let draws = 0;
  const source = { getRandomValues<T extends ArrayBufferView | null>(array: T): T {
    const words = array as unknown as Uint32Array;
    expect(words.length).toBe(2);
    words.set([++draws, 0xfedcba98]);
    return array;
  } };
  expect([...newGameSeed(source)]).toEqual([1, 0xfedcba98]);
  expect([...newGameSeed(source)]).toEqual([2, 0xfedcba98]);
});
