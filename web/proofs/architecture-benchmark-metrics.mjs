/** Six permutations balance each arm's position and every ordered adjacency. */
const ORDERS = [
  ['baselineHistorical', 'candidateHistorical', 'candidateFinal'],
  ['candidateHistorical', 'candidateFinal', 'baselineHistorical'],
  ['candidateFinal', 'baselineHistorical', 'candidateHistorical'],
  ['baselineHistorical', 'candidateFinal', 'candidateHistorical'],
  ['candidateFinal', 'candidateHistorical', 'baselineHistorical'],
  ['candidateHistorical', 'baselineHistorical', 'candidateFinal'],
];

export function benchmarkOrder(round) {
  if (!Number.isInteger(round) || round < 0) throw new Error('Round must be a nonnegative integer');
  return [...ORDERS[round % ORDERS.length]];
}

/** Select the producer's floor prefix or remaining walls without changing source rows. */
export function selectGeometryComponent(geometry, component) {
  if (!['all', 'floors', 'walls'].includes(component)
    || !Number.isInteger(geometry.floorCount) || !Number.isInteger(geometry.count)
    || geometry.floorCount < 0 || geometry.floorCount > geometry.count
    || geometry.instances.length < geometry.count * 16 || geometry.lowInstances.length % 16) {
    throw new Error('Component selection requires a valid producer floor prefix');
  }
  const start = component === 'walls' ? geometry.floorCount : 0;
  const end = component === 'floors' ? geometry.floorCount : geometry.count;
  return { instances: geometry.instances.slice(start * 16, end * 16), count: end - start,
    floorCount: component === 'walls' ? 0 : geometry.floorCount,
    lowInstances: component === 'floors' ? new Float32Array() : geometry.lowInstances.slice() };
}

export function distribution(samples) {
  if (!samples.length || samples.some(value => !Number.isFinite(value) || value < 0)) {
    throw new Error('Timing samples must be finite and nonnegative');
  }
  const sorted = [...samples].sort((a, b) => a - b);
  return { samples: [...samples], count: samples.length, min: sorted[0], max: sorted.at(-1),
    p50: sorted[Math.ceil(sorted.length * .5) - 1], p95: sorted[Math.ceil(sorted.length * .95) - 1] };
}

const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };

/** Subtract uint64 values before converting: absolute GPU ticks can exceed JS precision. */
export function timestampDurations(timestamps) {
  if (!timestamps.length || timestamps.length % 2) throw new Error('Timestamp pairs are required');
  const durations = [], nanoseconds = [];
  let quantum = 0n, smallestPositive = null, zeroCount = 0;
  for (let i = 0; i < timestamps.length; i += 2) {
    const start = timestamps[i], end = timestamps[i + 1];
    if (typeof start !== 'bigint' || typeof end !== 'bigint' || start < 0n
      || end > 0xffffffffffffffffn || end < start) {
      throw new Error('GPU timestamp pair must be ordered uint64 values');
    }
    const elapsed = end - start;
    nanoseconds.push(elapsed.toString()); durations.push(Number(elapsed) / 1e6);
    if (elapsed === 0n) zeroCount++;
    else { quantum = gcd(quantum, elapsed); if (smallestPositive === null || elapsed < smallestPositive) smallestPositive = elapsed; }
  }
  return { ...distribution(durations), unit: 'milliseconds', rawTimestampsNs: [...timestamps].map(String),
    durationNs: nanoseconds, zeroDurationCount: zeroCount, allDurationsZero: zeroCount === durations.length,
    smallestPositiveDurationNs: smallestPositive?.toString() ?? null,
    observedDurationDivisorNs: quantum ? quantum.toString() : null,
    resolutionNote: 'Durations are timestamp differences in nanoseconds, converted to milliseconds. The observed common divisor is descriptive, not proof of timer precision. Zero durations are retained; an all-zero block cannot establish cost.' };
}

/** Split one opaque range into adjacent draws without changing instance order. */
export function opaqueBatchPlan(total, floorCount) {
  if (!Number.isInteger(total) || !Number.isInteger(floorCount) || floorCount <= 0 || floorCount >= total) {
    throw new Error('Opaque split requires a nonempty floor prefix and remaining rows');
  }
  return [{ instanceCount: floorCount, firstInstance: 0 },
    { instanceCount: total - floorCount, firstInstance: floorCount }];
}
