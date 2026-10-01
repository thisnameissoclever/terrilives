import { expect, test } from 'vitest';
import { parseMemoryProbeSeed, MemoryProbeTarget } from '../src/stress-memory-probe.js';

test('probe seed is opt-in and accepts decimal unsigned 32-bit endpoints', () => {
  expect(parseMemoryProbeSeed('?probeSeedLow=1&probeSeedHigh=2')).toBeNull();
  expect(parseMemoryProbeSeed('?stress=0')).toBeNull();
  expect(parseMemoryProbeSeed('?stress=1000&probeSeedLow=0&probeSeedHigh=4294967295')).toEqual({low: 0, high: 4294967295});
});

test.each(['probeSeedLow=1', 'probeSeedHigh=2', 'probeSeedLow=&probeSeedHigh=2', 'probeSeedLow=1.5&probeSeedHigh=2', 'probeSeedLow=-1&probeSeedHigh=2', 'probeSeedLow=4294967296&probeSeedHigh=2', 'probeSeedLow=2&probeSeedHigh=', 'probeSeedLow=2&probeSeedHigh=1.5', 'probeSeedLow=2&probeSeedHigh=-1', 'probeSeedLow=2&probeSeedHigh=4294967296'])('rejects invalid opted-in seed %s', parameters => {
  expect(() => parseMemoryProbeSeed(`?stress=0&${parameters}`)).toThrow();
});

test('target budget starts unarmed, validates before arming, and reaches exact completion', () => {
  const target = new MemoryProbeTarget();
  expect(target.remaining(0)).toBeUndefined();
  for (const invalid of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => target.arm(invalid, 0)).toThrow();
    expect(target.remaining(0)).toBeUndefined();
  }
  target.arm(60, 0);
  expect(target.remaining(0)).toBe(60);
  expect(target.remaining(59)).toBe(1);
  expect(target.complete(59)).toBe(false);
  expect(target.remaining(60)).toBe(0);
  expect(target.complete(60)).toBe(true);
  expect(() => target.arm(60, 60)).toThrow();
  target.arm(600, 60);
  expect(target.remaining(60)).toBe(540);
});
