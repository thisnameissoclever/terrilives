import { describe, expect, test } from 'vitest';
import allocation from '../../scripts/character-allocation-proof.cjs';
import startup from '../../scripts/character-startup-proof.cjs';

const node = (functionName, url, selfSize, children = [], lineNumber = 0) => ({
  callFrame: { functionName, url, lineNumber, columnNumber: 0 }, selfSize, children,
});

describe('the character allocation proof', () => {
  test('charges character modules through the source map, and only them', () => {
    const profile = { head: node('(root)', '', 0, [
      node('frame', 'http://host/assets/index.js', 100, [
        node('composeFromLocals', 'http://host/assets/index.js', 4_000, [], 10),
        node('setTimeout', 'http://host/assets/index.js', 50, [], 20),
      ]),
    ]) };
    const sources = { 10: 'src/render/character/pose-joints.ts', 20: 'src/main.ts' };
    const resolve = (_url, line) => (sources[line] ? { source: sources[line], line: line + 1 } : null);
    const result = allocation.attributeAllocation(profile, resolve);
    expect(result.totalBytes).toBe(4_150);
    expect(result.characterBytes).toBe(4_000);
    expect(result.mappedBytes).toBe(4_050);
    expect(result.topFunctions[0]).toEqual({ function: 'composeFromLocals src/render/character/pose-joints.ts:11', bytes: 4_000, character: true });
  });

  test('passes a visible window within the budget and fails one over it', () => {
    const window = { frames: 100, visibility: 'visible', totalBytes: 10_000, characterBytes: 5_000, mappedBytes: 10_000 };
    expect(allocation.analyseWindow(window, 50).pass).toBe(true);
    expect(allocation.analyseWindow(window, 49).checks.characterWithinBudget).toBe(false);
    expect(allocation.analyseWindow({ ...window, visibility: 'hidden' }, null).checks.framesRan).toBe(false);
    expect(allocation.analyseWindow({ ...window, frames: 0 }, null).pass).toBe(false);
  });

  test('refuses a budget it cannot attribute', () => {
    const window = { frames: 100, visibility: 'visible', totalBytes: 10_000, characterBytes: 0, mappedBytes: 0 };
    expect(allocation.analyseWindow(window, 1_000).checks.attributed).toBe(false);
    expect(allocation.analyseWindow(window, null).pass).toBe(true);
  });

  test('reads its arguments and requires a URL', () => {
    expect(allocation.parseArgs(['--url', 'http://127.0.0.1:4300/', '--stress', '50', '--windows', '3'])).toMatchObject({ stress: 50, windows: 3, samplingInterval: 32_768 });
    expect(() => allocation.parseArgs(['--stress', '0'])).toThrow('--url is required');
    expect(() => allocation.parseArgs(['--url', 'u', '--speed', '4'])).toThrow('--speed');
  });
});

describe('the character start-up proof', () => {
  test('charges sampled time to each function once per stack', () => {
    const profile = {
      nodes: [
        { id: 1, callFrame: { functionName: '(root)', url: '', lineNumber: 0, columnNumber: 0 }, children: [2] },
        { id: 2, callFrame: { functionName: 'prepare', url: 'a.js', lineNumber: 0, columnNumber: 0 }, children: [3] },
        { id: 3, callFrame: { functionName: 'setVisibleParts', url: 'a.js', lineNumber: 4, columnNumber: 0 }, children: [] },
      ],
      samples: [3, 3, 2],
      timeDeltas: [0, 2_000, 3_000],
    };
    const time = startup.attributeTime(profile, () => null);
    expect(time.self).toEqual([{ function: 'setVisibleParts a.js:5', ms: 5 }, { function: 'prepare a.js:1', ms: 0 }]);
    expect(time.inclusive.find((row) => row.function === 'prepare a.js:1').ms).toBe(5);
  });
});
