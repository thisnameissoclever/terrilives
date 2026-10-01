import test from 'node:test';
import assert from 'node:assert/strict';
import { benchmarkOrder, distribution, timestampDurations } from './architecture-benchmark-metrics.mjs';

test('six rounds balance arm positions and ordered adjacency', () => {
  const positions = new Map(), adjacency = new Map();
  const orders = Array.from({ length: 6 }, (_, i) => benchmarkOrder(i));
  assert.equal(new Set(orders.map(order => order.join(','))).size, 6);
  for (const order of orders) order.forEach((arm, index) => {
    const key = `${arm}/${index}`; positions.set(key, (positions.get(key) ?? 0) + 1);
    if (index) { const pair = `${order[index - 1]}/${arm}`; adjacency.set(pair, (adjacency.get(pair) ?? 0) + 1); }
  });
  assert.equal(positions.size, 9); assert.ok([...positions.values()].every(n => n === 2));
  assert.equal(adjacency.size, 6); assert.ok([...adjacency.values()].every(n => n === 2));
  assert.deepEqual(benchmarkOrder(6), benchmarkOrder(0));
});

test('uint64 subtraction preserves small elapsed values above Number precision', () => {
  const base = 2n ** 60n;
  const result = timestampDurations(new BigUint64Array([base, base + 100001n, base + 200000n, base + 300002n]));
  assert.deepEqual(result.durationNs, ['100001', '100002']);
  assert.deepEqual(result.samples, [.100001, .100002]);
  assert.equal(result.rawTimestampsNs[0], base.toString());
});

test('zero and quantized durations remain visible instead of being discarded', () => {
  const result = timestampDurations(new BigUint64Array([0n, 0n, 100000n, 200000n, 300000n, 500000n]));
  assert.equal(result.zeroDurationCount, 1); assert.equal(result.allDurationsZero, false);
  assert.equal(result.observedDurationDivisorNs, '100000');
  assert.deepEqual(result.samples, [0, .1, .2]); assert.equal(result.p95, .2);
  const zero = timestampDurations(new BigUint64Array([12n, 12n]));
  assert.equal(zero.allDurationsZero, true); assert.equal(zero.observedDurationDivisorNs, null);
});

test('malformed pairs and negative or empty timing samples are rejected', () => {
  assert.throws(() => timestampDurations([1n]));
  assert.throws(() => timestampDurations([2n, 1n]));
  assert.throws(() => timestampDurations([-1n, 0n]));
  assert.throws(() => timestampDurations([0n, 2n ** 64n]));
  assert.throws(() => distribution([])); assert.throws(() => distribution([-1]));
  assert.throws(() => benchmarkOrder(-1));
});
