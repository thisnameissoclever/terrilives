import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import {
  sampleFootstepsAfterTick,
  type FootstepFrameSink,
  type FootstepFrameSource,
} from '../src/audio/frame-audio.js';
import { VISUAL_ACTION_WALK } from '../src/frame.js';

const SOURCE = readFileSync(
  new URL('../src/audio/frame-audio.ts', import.meta.url),
  'utf8',
);
const MAIN = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

function source(): FootstepFrameSource {
  return {
    count: 4,
    positions: () => new Float32Array([2, 3, 50, 60, 7, 8, 9, 10]),
    simIds: () => new Uint32Array([7001, 0xffff_ffff, 7003, 0xffff_ffff]),
    visualActions: () =>
      new Uint32Array([VISUAL_ACTION_WALK, VISUAL_ACTION_WALK, 0, VISUAL_ACTION_WALK]),
  };
}

function sink(calls: string[]): FootstepFrameSink {
  return {
    beginFootstepFrame: () => calls.push('begin'),
    observeFootstep: (simId, x, y, walking) => {
      calls.push(`${simId}:${x}:${y}:${walking}`);
    },
    endFootstepFrame: () => calls.push('end'),
  };
}

describe('sampleFootstepsAfterTick', () => {
  it('uses stable Sim ids and includes stopped Sims while ignoring objects and bare agents', () => {
    const calls: string[] = [];
    const input = source();
    sampleFootstepsAfterTick(input, sink(calls));

    expect(calls).toEqual([
      'begin',
      '7001:2:3:true',
      '7003:7:8:false',
      'end',
    ]);
  });

  it('re-reads every aligned view once after the fixed tick', () => {
    const input = source();
    const positions = vi.spyOn(input, 'positions');
    const simIds = vi.spyOn(input, 'simIds');
    const visualActions = vi.spyOn(input, 'visualActions');
    positions.mockClear();
    simIds.mockClear();
    visualActions.mockClear();

    sampleFootstepsAfterTick(input, sink([]));

    expect(positions).toHaveBeenCalledTimes(1);
    expect(simIds).toHaveBeenCalledTimes(1);
    expect(visualActions).toHaveBeenCalledTimes(1);
  });

  it('reads stable Sim identity from the aligned render column', () => {
    const input = source();
    const simIds = vi.spyOn(input, 'simIds');

    sampleFootstepsAfterTick(input, sink([]));
    sampleFootstepsAfterTick(input, sink([]));

    expect(simIds).toHaveBeenCalledTimes(2);
  });

  it('uses the current aligned identity after row topology changes', () => {
    const input = source();
    input.simIds = () => new Uint32Array([7999, 0xffff_ffff, 7003, 0xffff_ffff]);
    const calls: string[] = [];

    sampleFootstepsAfterTick(input, sink(calls));

    expect(calls).toEqual([
      'begin',
      '7999:2:3:true',
      '7003:7:8:false',
      'end',
    ]);
  });

  it('keeps the tick sampler free of per-frame collections and row objects', () => {
    const body = SOURCE.match(
      /export function sampleFootstepsAfterTick[\s\S]*?^}/m,
    )?.[0];
    expect(body).toBeDefined();
    expect(body).not.toMatch(/\bnew\s+(?:Array|Map|Set)\b/);
    expect(body).not.toMatch(/\.(?:map|filter|reduce)\s*\(/);
    expect(body).not.toMatch(/sink\.observeFootstep\s*\(\s*\{/);
  });

  it('closes the scheduler frame when one observation fails', () => {
    const input = source();
    const calls: string[] = [];
    const failingSink: FootstepFrameSink = {
      beginFootstepFrame: () => calls.push('begin'),
      observeFootstep: () => {
        calls.push('observe');
        throw new Error('audio device disappeared');
      },
      endFootstepFrame: () => calls.push('end'),
    };

    expect(() => sampleFootstepsAfterTick(input, failingSink)).toThrow(
      'audio device disappeared',
    );
    expect(calls).toEqual(['begin', 'observe', 'end']);
  });

  it('samples after every fixed tick and never from paused command flushing', () => {
    expect(MAIN).toMatch(
      /const frameSimulation = \{[\s\S]*?tick\(\): void \{\s*sim\.tick\(\);[\s\S]*?sampleFootstepsAfterTick\(sim, audio\);[\s\S]*?flushCommands\(\): void \{\s*sim\.flushCommands\(\);/,
    );
    expect(MAIN).toMatch(
      /advanceSimulationFrame\(driver, deltaMs, frameSimulation\)/,
    );
    expect(MAIN).not.toMatch(
      /flushCommands\(\): void \{[\s\S]{0,120}sampleFootstepsAfterTick/,
    );
  });

  it('exposes footstep-sampler timing and a sampling-disabled baseline', () => {
    expect(MAIN).toMatch(/new FrameTimer\(540\)/);
    expect(MAIN).toMatch(/get\('audio'\) !== '0'/);
    expect(MAIN).toMatch(
      /sampleStartedMs = performance\.now\(\)[\s\S]*?sampleFootstepsAfterTick\(sim, audio\)[\s\S]*?footstepSamplerTimer\.sample\(performance\.now\(\) - sampleStartedMs\)/,
    );
  });

  it('exposes bounded audio and WASM diagnostics only through the stress handle', () => {
    expect(MAIN).toMatch(
      /get wasmMemoryBytes\(\) \{\s*return wasm\.memory\.buffer\.byteLength;/,
    );
    expect(MAIN).toMatch(
      /get activeVoices\(\) \{\s*return audio\.activeVoiceCount\(\);/,
    );
    expect(MAIN).toMatch(
      /get footstepTracks\(\) \{\s*return audio\.activeFootstepTrackCount\(\);/,
    );
    expect(MAIN).toMatch(
      /get footstepCapacity\(\) \{\s*return audio\.footstepTrackCapacity\(\);/,
    );
    expect(MAIN).toMatch(
      /runFootstepSchedulerProbe:[\s\S]*?audio\.beginFootstepFrame\(\);[\s\S]*?audio\.observeFootstep\([\s\S]*?audio\.endFootstepFrame\(\);/,
    );
    expect(MAIN.indexOf('globalThis.__terriStress = {')).toBeGreaterThan(
      MAIN.indexOf("if (stressParam !== null)"),
    );
  });

  it('resets at Load while reconciling both visibility states', () => {
    expect(MAIN).not.toMatch(/audio\.reset\('pause'\)/);
    expect(MAIN).toMatch(
      /if \(loaded\) \{[\s\S]*?audio\.reset\('load'\)/,
    );
    expect(MAIN).toMatch(
      /const hidden = document\.visibilityState === 'hidden';[\s\S]*?audio\.setBackgrounded\(hidden\)/,
    );
  });

  it('routes pointer rejection and roster selection through semantic audio', () => {
    const roster = MAIN.slice(
      MAIN.indexOf('new HouseholdRoster('),
      MAIN.indexOf('const initialHudMs'),
    );
    expect(roster.match(/audio\.emit\(\{ type: 'command\.rejected' \}\)/g)).toHaveLength(1);
    expect(roster.match(/audio\.emit\(\{ type: 'command\.staged' \}\)/g)).toHaveLength(1);
    expect(roster).toMatch(
      /clearCommandFeedback\(commandStatus\);\s*audio\.emit\(\{ type: 'command\.staged' \}\)/,
    );

    const pointer = MAIN.slice(
      MAIN.indexOf('attachPointerInput('),
      MAIN.indexOf('const timer = new FrameTimer'),
    );
    expect(pointer.match(/audio\.emit\(\{ type: 'command\.rejected' \}\)/g)).toHaveLength(1);
    expect(pointer.match(/audio\.emit\(\{ type: 'command\.staged' \}\)/g)).toHaveLength(1);
  });

  it('keeps trusted-gesture recovery armed after the first unlock', () => {
    expect(MAIN).toMatch(
      /const unlockAudio = \(\): void => \{\s*if \(audio\.isUnlocked\(\)\) return;\s*void audio\.unlockFromGesture\(\);\s*\}/,
    );
    expect(MAIN).not.toMatch(/removeEventListener\([^\n]*unlockAudio/);
  });

  it('uses the aligned stable-id column without a rebuild or identity query', () => {
    expect(MAIN).not.toMatch(/footstepIdentities|simIdOf/);
    expect(SOURCE).toMatch(/const simIds = source\.simIds\(\)/);
    expect(SOURCE).not.toMatch(/simIdOf|FootstepIdentityLookup/);
  });
});
