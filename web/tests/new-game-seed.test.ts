import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
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

it('forwards fresh browser entropy through the production startup constructor', () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  // Execute the real construction statements without starting the GPU or game loop.
  const start = main.indexOf('  const [seedLow, seedHigh] =');
  const end = main.indexOf('  const sim = new SimBridge(handle, wasm.memory);', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const construction = main.slice(start, end);
  let draws = 0;
  const entropy = { getRandomValues<T extends ArrayBufferView | null>(array: T): T {
    (array as unknown as Uint32Array).set([++draws, 0xfedcba98]);
    return array;
  } };
  const construct = () => runInNewContext(`${construction}\nhandle;`, {
    newGameSeed: () => newGameSeed(entropy),
    SimHandle: { from_lot_with_seed: (low: number, high: number) => [low, high] },
  });
  expect(construct()).toEqual([1, 0xfedcba98]);
  expect(construct()).toEqual([2, 0xfedcba98]);
});
