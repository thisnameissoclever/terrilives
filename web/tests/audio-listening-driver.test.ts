import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

const DRIVER = readFileSync(
  new URL('../../scripts/audio-listening-driver.cjs', import.meta.url),
  'utf8',
);
const require = createRequire(import.meta.url);
const DRIVER_BEHAVIOR = require('../../scripts/audio-listening-driver.cjs') as {
  ACTIVITY_LISTENING_SCENARIOS: readonly {
    readonly id: string;
    readonly cue: string;
    readonly node: string;
    readonly firstDemandAllowanceMs: number;
  }[];
  createdNodeCount(
    audio: { readonly createdOscillators: number; readonly createdBufferSources: number },
    node: string,
  ): number;
  everyContextIs(states: readonly string[], expectedState: string): boolean;
  hasCompleteActivityEvidence(evidence: {
    readonly observedRenderState: object | null;
    readonly expectedCueDelta: number;
    readonly expectedNodeDelta: number;
  }): boolean;
};

const CONTROLLER = readFileSync(
  new URL('../src/audio/audio-controller.ts', import.meta.url),
  'utf8',
);

describe('audio listening driver activity fixtures', () => {
  it('defines each audible activity by exact command, visual state, cue, and node kind', () => {
    for (const contract of [
      ['conversation', 'Chat', 'talkTo', 1, 4, 'conversation', 'buffer-source', 0],
      ['eating', 'Grab a snack', 'useObject', 2, 3, 'eating', 'oscillator', 0],
      ['reading', 'Read a book', 'useObject', 4, 8, 'page-turn', 'oscillator', 0],
      ['exercise', 'Use the exercise bike', 'useObject', 6, 9, 'exercise', 'oscillator', 0],
      ['sleep', 'Sleep', 'useObject', 9, 5, 'sleep-breath', 'buffer-source', 15000],
    ] as const) {
      expect(DRIVER).toContain(JSON.stringify(contract));
    }
  });

  it('names only cue counts the game reports', () => {
    const counts = CONTROLLER.match(/cuePlayCounts\(\): AudioCuePlayCounts \{[\s\S]*?\n {2}\}/);
    expect(counts).not.toBeNull();
    for (const scenario of DRIVER_BEHAVIOR.ACTIVITY_LISTENING_SCENARIOS) {
      const key = /^[a-z]+$/.test(scenario.cue) ? scenario.cue : `'${scenario.cue}'`;
      expect(counts?.[0]).toContain(`${key}: this.playedCueCounts[`);
    }
  });

  it('waits past the silent first sleep event, which only loads the snores', () => {
    const sleep = DRIVER_BEHAVIOR.ACTIVITY_LISTENING_SCENARIOS.find((s) => s.id === 'sleep');
    // One fetching event, the next event three game seconds later, then a
    // snore no sooner than six real seconds after any earlier one.
    expect(sleep?.firstDemandAllowanceMs).toBeGreaterThanOrEqual(9_000);
    expect(DRIVER).toMatch(/\+ scenario\.firstDemandAllowanceMs/);
  });

  it('requires semantic cue growth and the scenario node kind for each fixture', () => {
    expect(DRIVER).toMatch(/cuePlayCounts/);
    expect(DRIVER).toMatch(/expectedCueDelta/);
    expect(DRIVER).toMatch(/createdNodeCount\(audio, scenario\.node\)/);
    expect(DRIVER).toMatch(/includes\('buffersource'\)/);
    expect(DRIVER).toMatch(/expectedVisualAction/);
    expect(DRIVER).toMatch(/expectedActivity/);
  });

  it('counts the node kind each scenario names', () => {
    const audio = { createdOscillators: 3, createdBufferSources: 7 };
    expect(DRIVER_BEHAVIOR.createdNodeCount(audio, 'oscillator')).toBe(3);
    expect(DRIVER_BEHAVIOR.createdNodeCount(audio, 'buffer-source')).toBe(7);
    expect(() => DRIVER_BEHAVIOR.createdNodeCount(audio, 'gain')).toThrow(/gain/);
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

  it('fails the hidden tab on any new recording as well as any new oscillator', () => {
    expect(DRIVER).toContain(
      'after.createdBufferSources === before.createdBufferSources',
    );
    expect(DRIVER).toContain(
      'after.createdOscillators === before.createdOscillators',
    );
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
      expectedNodeDelta: 1,
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
        expectedNodeDelta: 0,
      }),
    ).toBe(false);
  });
});
