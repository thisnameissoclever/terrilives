import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import {
  sampleSimAudioAfterTick,
  type SimAudioFrameSink,
  type SimAudioFrameSource,
} from '../src/audio/frame-audio.js';
import {
  VISUAL_ACTION_EAT,
  VISUAL_ACTION_EXERCISE,
  VISUAL_ACTION_READ,
  VISUAL_ACTION_SLEEP,
  VISUAL_ACTION_STANDING_READ,
  VISUAL_ACTION_TALK,
  VISUAL_ACTION_WALK,
} from '../src/frame.js';

const SOURCE = readFileSync(
  new URL('../src/audio/frame-audio.ts', import.meta.url),
  'utf8',
);
const MAIN = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

function source(): SimAudioFrameSource {
  return {
    count: 4,
    positions: () => new Float32Array([2, 3, 50, 60, 7, 8, 9, 10]),
    simIds: () => new Uint32Array([7001, 0xffff_ffff, 7003, 0xffff_ffff]),
    visualActions: () =>
      new Uint32Array([VISUAL_ACTION_WALK, VISUAL_ACTION_WALK, 0, VISUAL_ACTION_WALK]),
    soundActions: () => new Uint32Array(4),
    soundSources: () => new Uint32Array(4).fill(0xffff_ffff),
  };
}

function sink(calls: string[]): SimAudioFrameSink {
  return {
    beginFootstepFrame: () => calls.push('begin'),
    observeFootstep: (simId, x, y, walking) => {
      calls.push(`${simId}:${x}:${y}:${walking}`);
    },
    endFootstepFrame: () => calls.push('end'),
    beginActivityFrame: () => calls.push('activity-begin'),
    observeActivity: (simId, activity) => {
      calls.push(`activity:${simId}:${activity}`);
    },
    endActivityFrame: () => calls.push('activity-end'),
    beginObjectSoundFrame: () => calls.push('object-begin'),
    observeObjectSound: (sourceId, action) => {
      calls.push(`object:${sourceId}:${action}`);
    },
    endObjectSoundFrame: () => calls.push('object-end'),
  };
}

describe('sampleSimAudioAfterTick', () => {
  it('uses stable Sim ids and includes stopped Sims while ignoring objects and bare agents', () => {
    const calls: string[] = [];
    const input = source();
    sampleSimAudioAfterTick(input, sink(calls));

    expect(calls).toEqual([
      'begin',
      'activity-begin',
      'object-begin',
      '7001:2:3:true',
      '7003:7:8:false',
      'object-end',
      'activity-end',
      'end',
    ]);
  });

  it('maps conversation and sleep actions into semantic activity samples', () => {
    const calls: string[] = [];
    const input = source();
    input.visualActions = () =>
      new Uint32Array([
        VISUAL_ACTION_TALK,
        VISUAL_ACTION_TALK,
        VISUAL_ACTION_SLEEP,
        VISUAL_ACTION_WALK,
      ]);

    sampleSimAudioAfterTick(input, sink(calls));

    expect(calls).toEqual([
      'begin',
      'activity-begin',
      'object-begin',
      '7001:2:3:false',
      'activity:7001:conversation',
      '7003:7:8:false',
      'activity:7003:sleep',
      'object-end',
      'activity-end',
      'end',
    ]);
  });

  it('maps authored eating, reading, and exercise actions without guessing the object', () => {
    const calls: string[] = [];
    const input: SimAudioFrameSource = {
      count: 5,
      positions: () => new Float32Array(10),
      simIds: () => new Uint32Array([81, 82, 83, 84, 0xffff_ffff]),
      visualActions: () => new Uint32Array([
        VISUAL_ACTION_EAT,
        VISUAL_ACTION_READ,
        VISUAL_ACTION_STANDING_READ,
        VISUAL_ACTION_EXERCISE,
        VISUAL_ACTION_EAT,
      ]),
      soundActions: () => new Uint32Array(5),
      soundSources: () => new Uint32Array(5).fill(0xffff_ffff),
    };

    sampleSimAudioAfterTick(input, sink(calls));

    expect(calls).toEqual([
      'begin',
      'activity-begin',
      'object-begin',
      '81:0:0:false',
      'activity:81:eating',
      '82:0:0:false',
      'activity:82:reading',
      '83:0:0:false',
      'activity:83:reading',
      '84:0:0:false',
      'activity:84:exercise',
      'object-end',
      'activity-end',
      'end',
    ]);
  });

  it('re-reads every aligned view once after the fixed tick', () => {
    const input = source();
    const positions = vi.spyOn(input, 'positions');
    const simIds = vi.spyOn(input, 'simIds');
    const visualActions = vi.spyOn(input, 'visualActions');
    const soundActions = vi.spyOn(input, 'soundActions');
    const soundSources = vi.spyOn(input, 'soundSources');
    positions.mockClear();
    simIds.mockClear();
    visualActions.mockClear();
    soundActions.mockClear();
    soundSources.mockClear();

    sampleSimAudioAfterTick(input, sink([]));

    expect(positions).toHaveBeenCalledTimes(1);
    expect(simIds).toHaveBeenCalledTimes(1);
    expect(visualActions).toHaveBeenCalledTimes(1);
    expect(soundActions).toHaveBeenCalledTimes(1);
    expect(soundSources).toHaveBeenCalledTimes(1);
  });

  it('reads stable Sim identity from the aligned render column', () => {
    const input = source();
    const simIds = vi.spyOn(input, 'simIds');

    sampleSimAudioAfterTick(input, sink([]));
    sampleSimAudioAfterTick(input, sink([]));

    expect(simIds).toHaveBeenCalledTimes(2);
  });

  it('uses the current aligned identity after row topology changes', () => {
    const input = source();
    input.simIds = () => new Uint32Array([7999, 0xffff_ffff, 7003, 0xffff_ffff]);
    const calls: string[] = [];

    sampleSimAudioAfterTick(input, sink(calls));

    expect(calls).toEqual([
      'begin',
      'activity-begin',
      'object-begin',
      '7999:2:3:true',
      '7003:7:8:false',
      'object-end',
      'activity-end',
      'end',
    ]);
  });

  it('keeps the tick sampler free of per-frame collections and row objects', () => {
    const body = SOURCE.match(
      /export function sampleSimAudioAfterTick[\s\S]*?^}/m,
    )?.[0];
    expect(body).toBeDefined();
    expect(body).not.toMatch(/\bnew\s+(?:Array|Map|Set)\b/);
    expect(body).not.toMatch(/\.(?:map|filter|reduce)\s*\(/);
    expect(body).not.toMatch(/sink\.observeFootstep\s*\(\s*\{/);
  });

  it('closes the scheduler frame when one observation fails', () => {
    const input = source();
    const calls: string[] = [];
    const failingSink: SimAudioFrameSink = {
      beginFootstepFrame: () => calls.push('begin'),
      observeFootstep: () => {
        calls.push('observe');
        throw new Error('audio device disappeared');
      },
      endFootstepFrame: () => calls.push('end'),
      beginActivityFrame: () => calls.push('activity-begin'),
      observeActivity: () => calls.push('activity'),
      endActivityFrame: () => calls.push('activity-end'),
      beginObjectSoundFrame: () => calls.push('object-begin'),
      observeObjectSound: () => calls.push('object'),
      endObjectSoundFrame: () => calls.push('object-end'),
    };

    expect(() => sampleSimAudioAfterTick(input, failingSink)).toThrow(
      'audio device disappeared',
    );
    expect(calls).toEqual([
      'begin',
      'activity-begin',
      'object-begin',
      'observe',
      'object-end',
      'activity-end',
      'end',
    ]);
  });

  it('closes earlier scheduler frames when a later frame cannot begin', () => {
    const input = source();
    const calls: string[] = [];
    const failingSink: SimAudioFrameSink = {
      ...sink(calls),
      beginObjectSoundFrame: () => {
        calls.push('object-begin');
        throw new Error('stale object frame');
      },
    };

    expect(() => sampleSimAudioAfterTick(input, failingSink)).toThrow(
      'stale object frame',
    );
    expect(calls).toEqual([
      'begin',
      'activity-begin',
      'object-begin',
      'activity-end',
      'end',
    ]);
  });

  it('passes authored sound state with exact object source identity', () => {
    const input = source();
    input.soundActions = () => new Uint32Array([1, 2, 2, 0]);
    input.soundSources = () =>
      new Uint32Array([44, 55, 73, 0xffff_ffff]);
    const calls: string[] = [];

    sampleSimAudioAfterTick(input, sink(calls));

    expect(calls).toContain('object:44:1');
    expect(calls).toContain('object:55:2');
    expect(calls).toContain('object:73:2');
  });

  it('samples after every fixed tick and never from paused command flushing', () => {
    expect(MAIN).toMatch(
      /const frameSimulation = \{[\s\S]*?tick\(\): void \{\s*sim\.tick\(\);[\s\S]*?sampleSimAudioAfterTick\(sim, audio\);[\s\S]*?flushCommands\(\): void \{\s*sim\.flushCommands\(\);/,
    );
    expect(MAIN).toMatch(
      /advanceSimulationFrame\(driver, deltaMs, frameSimulation\)/,
    );
    expect(MAIN).not.toMatch(
      /flushCommands\(\): void \{[\s\S]{0,120}sampleSimAudioAfterTick/,
    );
  });

  it('exposes footstep-sampler timing and a sampling-disabled baseline', () => {
    expect(MAIN).toMatch(/new FrameTimer\(540\)/);
    expect(MAIN).toMatch(/get\('audio'\) !== '0'/);
    expect(MAIN).toMatch(
      /sampleStartedMs = performance\.now\(\)[\s\S]*?sampleSimAudioAfterTick\(sim, audio\)[\s\S]*?footstepSamplerTimer\.sample\(performance\.now\(\) - sampleStartedMs\)/,
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
      /get objectSoundTracks\(\) \{\s*return audio\.activeObjectSoundTrackCount\(\);/,
    );
    expect(MAIN).toMatch(
      /get objectSoundCapacity\(\) \{\s*return audio\.objectSoundTrackCapacity\(\);/,
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
