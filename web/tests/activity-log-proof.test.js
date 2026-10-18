import { describe, expect, test } from 'vitest';
import proof from '../../scripts/activity-log-proof.cjs';

function run({ logEnabled, workP95 = 4, logP95 = 0.01, logMax = 0.1, over = 0, simIdOf = 0, records = 5, hz = 120, median = 8.3 }) {
  return {
    logEnabled,
    calibration: { achievedHz: hz, p50: median },
    active: { work: { p95: workP95 }, workFramesOver16_6Ms: over, simIdOfCalls: simIdOf },
    log: { p95: logP95, max: logMax, recordsDrained: logEnabled ? records : 0 },
  };
}

function pair(enabled = {}, disabled = {}) {
  return { enabled: run({ logEnabled: true, ...enabled }), disabled: run({ logEnabled: false, ...disabled }) };
}

describe('the activity log performance verdict', () => {
  test('passes three calibrated pairs within every limit', () => {
    const analysis = proof.analysePerformance([pair(), pair({ workP95: 4.5 }), pair({ workP95: 4.9 })]);
    expect(analysis.medianWorkP95RegressionMs).toBeCloseTo(0.5);
    expect(analysis.pass).toBe(true);
  });

  test('judges the work regression on the median pair, not the worst', () => {
    const analysis = proof.analysePerformance([pair({ workP95: 7 }), pair(), pair()]);
    expect(analysis.workP95RegressionsMs[0]).toBe(3);
    expect(analysis.checks.workRegression).toBe(true);
    expect(proof.analysePerformance([pair({ workP95: 7 }), pair({ workP95: 5.5 }), pair()]).checks.workRegression).toBe(false);
  });

  test.each([
    ['calibrated', pair({ hz: 60, median: 16.7 })],
    ['logP95', pair({ logP95: 0.3 })],
    ['logMax', pair({ logMax: 1.2 })],
    ['noLongWorkFrame', pair({}, { over: 1 })],
    ['noSteadySimIdOf', pair({ simIdOf: 1 })],
    ['recordsArrived', pair({ records: 0 })],
  ])('fails %s from a single run', (check, bad) => {
    const analysis = proof.analysePerformance([pair(), bad, pair()]);
    expect(analysis.checks[check]).toBe(false);
    expect(analysis.pass).toBe(false);
  });

  test('splits log samples by whether the frame drained records', () => {
    const split = proof.splitLogSamples([0.5, 0.01, 0.4, 0.02], [3, 3, 5, 5], 1);
    expect(split.withRecords.count).toBe(2);
    expect(split.withRecords.max).toBe(0.5);
    expect(split.withoutRecords.count).toBe(2);
    expect(split.withoutRecords.max).toBe(0.02);
  });
});

describe('the activity log allocation attribution', () => {
  const node = (functionName, url, selfSize, children = []) => ({
    callFrame: { functionName, url, lineNumber: 0 }, selfSize, children,
  });

  test('charges the log modules and the bridge log methods, nothing else', () => {
    const profile = {
      head: node('(root)', '', 0, [
        node('drain', 'http://127.0.0.1:5174/src/ui/activity-log-store.ts', 0, [
          node('takeActivityLog', 'http://127.0.0.1:5174/src/bridge.ts', 120),
        ]),
        node('appendRow', 'http://127.0.0.1:5174/src/ui/activity-log-panel.ts?t=1', 900),
        node('positions', 'http://127.0.0.1:5174/src/bridge.ts', 4_000),
        node('frame', 'http://127.0.0.1:5174/src/main.ts', 50),
      ]),
    };
    const attributed = proof.attributeAllocation(profile);
    expect(attributed.totalBytes).toBe(5_070);
    expect(attributed.logBytes).toBe(1_020);
    expect(attributed.logFunctions.map((entry) => entry.function)).toEqual([
      'appendRow src/ui/activity-log-panel.ts?t=1:1',
      'takeActivityLog src/bridge.ts:1',
    ]);
  });

  test('bounds the closed panel by one view per drain and the open panel per row', () => {
    const closed = { frames: 100, framesWithRecords: 4, logBytes: 400, visibility: 'visible' };
    const open = { frames: 100, rowsAdded: 3, logBytes: 6_000, visibility: 'visible' };
    expect(proof.analyseAllocation(closed, open, 128).checks).toEqual({
      framesRan: true, closedWithinOneViewPerDrain: true, openWithinRowAllowance: true,
    });
    expect(proof.analyseAllocation({ ...closed, logBytes: 600 }, { ...open, logBytes: 7_000 }, 128).checks).toEqual({
      framesRan: true, closedWithinOneViewPerDrain: false, openWithinRowAllowance: false,
    });
  });
});

describe('the activity log memory verdict', () => {
  const sample = (jsUsedBytes, held = 2_000, drained = 2_500) => ({
    jsUsedBytes, wasmMemoryBytes: 1_000_000, domNodes: 500, held, capacity: 2_000, drained,
  });
  const runs = (enabledGrowth) => [0, 1, 2].flatMap((repetition) => [
    { repetition, logEnabled: true, samples: [sample(10_100_000), sample(10_100_000 + enabledGrowth)] },
    { repetition, logEnabled: false, samples: [sample(10_000_000, 0, 0), sample(10_000_000, 0, 0)] },
  ]);

  test('charges the enabled minus disabled heap after the store fills', () => {
    const analysis = proof.analyseMemory(runs(0));
    expect(analysis.medianRetainedJsBytes).toBe(100_000);
    expect(Object.values(analysis.checks).every(Boolean)).toBe(true);
  });

  test('fails growth after the store is full and an unfilled store', () => {
    expect(proof.analyseMemory(runs(4_096)).checks.noGrowthAfterFull).toBe(false);
    const unfilled = runs(0);
    unfilled[0].samples[0].held = 1_500;
    expect(proof.analyseMemory(unfilled).checks.storeFilled).toBe(false);
  });
});

test('every page is muted and the baseline turns the log off', () => {
  expect(proof.withQuery('http://127.0.0.1:4173/', 0, true)).toBe('http://127.0.0.1:4173/?stress=0&audio=0');
  expect(proof.withQuery('http://127.0.0.1:4173/', 1000, false))
    .toBe('http://127.0.0.1:4173/?stress=1000&audio=0&activitylog=0');
  expect(proof.parseArgs(['memory', '--stress', '100']).stress).toBe(100);
  expect(() => proof.parseArgs(['--stress', '-1'])).toThrow();
});
