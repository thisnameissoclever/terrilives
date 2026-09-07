import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

const DRIVER = readFileSync(
  new URL('../../scripts/audio-listening-driver.cjs', import.meta.url),
  'utf8',
);
const require = createRequire(import.meta.url);
const DRIVER_BEHAVIOR = require('../../scripts/audio-listening-driver.cjs') as {
  everyContextIs(states: readonly string[], expectedState: string): boolean;
  hasCompleteActivityEvidence(evidence: {
    readonly observedRenderState: object | null;
    readonly expectedCueDelta: number;
    readonly oscillatorDelta: number;
  }): boolean;
};

describe('audio listening driver activity fixtures', () => {
  it('defines each audible activity by exact command, visual state, and cue', () => {
    for (const contract of [
      ['conversation', 'Chat', 'talkTo', 1, 4, 'conversation'],
      ['eating', 'Grab a snack', 'useObject', 2, 3, 'eating'],
      ['reading', 'Read a book', 'useObject', 4, 8, 'page-turn'],
      ['exercise', 'Use the exercise bike', 'useObject', 6, 9, 'exercise'],
      ['sleep', 'Sleep', 'useObject', 9, 5, 'sleep-breath'],
    ] as const) {
      expect(DRIVER).toContain(JSON.stringify(contract));
    }
  });

  it('requires both semantic cue growth and an oscillator for each fixture', () => {
    expect(DRIVER).toMatch(/cuePlayCounts/);
    expect(DRIVER).toMatch(/expectedCueDelta/);
    expect(DRIVER).toMatch(/createdOscillators/);
    expect(DRIVER).toMatch(/expectedVisualAction/);
    expect(DRIVER).toMatch(/expectedActivity/);
  });

  it('finds stable Sims and targets from live bridge identity instead of row order', () => {
    expect(DRIVER).toMatch(/simIds\[row\] !== 0xffff_ffff/);
    expect(DRIVER).toMatch(/interactionLabels\(ids\[row\]\)/);
    expect(DRIVER).toMatch(/matches\.length !== 1/);
    expect(DRIVER).not.toMatch(/ids\[[0-9]+\]/);
  });

  it('uses real rejected actions for audible and hidden-tab rejection checks', () => {
    expect(DRIVER).toMatch(/document\.querySelector\('#stop-orders'\)/);
    expect(DRIVER).toContain("page.locator('#stop-orders').click()");
    expect(DRIVER).not.toMatch(/parkUnrelatedSims|prepareQuietActivity|parking/);
  });

  it('waits for foreground audio hardware before testing recovery', () => {
    expect(DRIVER).toMatch(
      /foregroundContextStates[\s\S]*?everyContextIs\(states, 'running'\)[\s\S]*?beforeRecovery/,
    );
  });

  it('rejects empty or partially transitioned audio-context state', () => {
    expect(DRIVER_BEHAVIOR.everyContextIs([], 'running')).toBe(false);
    expect(DRIVER_BEHAVIOR.everyContextIs(['running', 'suspended'], 'running')).toBe(
      false,
    );
    expect(DRIVER_BEHAVIOR.everyContextIs(['running', 'running'], 'running')).toBe(
      true,
    );
  });

  it('requires visual, semantic, and browser-node evidence together', () => {
    const complete = {
      observedRenderState: { visualAction: 6, activity: 9 },
      expectedCueDelta: 1,
      oscillatorDelta: 1,
    };
    expect(DRIVER_BEHAVIOR.hasCompleteActivityEvidence(complete)).toBe(true);
    expect(
      DRIVER_BEHAVIOR.hasCompleteActivityEvidence({
        ...complete,
        observedRenderState: null,
      }),
    ).toBe(false);
    expect(
      DRIVER_BEHAVIOR.hasCompleteActivityEvidence({
        ...complete,
        expectedCueDelta: 0,
      }),
    ).toBe(false);
    expect(
      DRIVER_BEHAVIOR.hasCompleteActivityEvidence({
        ...complete,
        oscillatorDelta: 0,
      }),
    ).toBe(false);
  });
});
