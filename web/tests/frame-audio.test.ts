import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import {
  FootstepIdentityLookup,
  sampleFootstepsAfterTick,
  type FootstepFrameSink,
  type FootstepFrameSource,
} from '../src/audio/frame-audio.js';
import { VISUAL_ACTION_WALK } from '../src/frame.js';
import { KIND_AGENT } from '../src/render/instances.js';

const SOURCE = readFileSync(
  new URL('../src/audio/frame-audio.ts', import.meta.url),
  'utf8',
);
const MAIN = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

function source(): FootstepFrameSource {
  return {
    count: 4,
    positions: () => new Float32Array([2, 3, 50, 60, 7, 8, 9, 10]),
    kinds: () => new Uint32Array([KIND_AGENT, 1, KIND_AGENT, KIND_AGENT]),
    ids: () => new Uint32Array([41, 42, 43, 44]),
    visualActions: () =>
      new Uint32Array([VISUAL_ACTION_WALK, VISUAL_ACTION_WALK, 0, VISUAL_ACTION_WALK]),
    simIdOf: (entity) => {
      if (entity === 41) return 7001;
      if (entity === 43) return 7003;
      return null;
    },
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
    const identities = new FootstepIdentityLookup();
    identities.rebuild(input);

    sampleFootstepsAfterTick(input, sink(calls), identities);

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
    const kinds = vi.spyOn(input, 'kinds');
    const ids = vi.spyOn(input, 'ids');
    const visualActions = vi.spyOn(input, 'visualActions');
    const identities = new FootstepIdentityLookup();
    identities.rebuild(input);
    positions.mockClear();
    kinds.mockClear();
    ids.mockClear();
    visualActions.mockClear();

    sampleFootstepsAfterTick(input, sink([]), identities);

    expect(positions).toHaveBeenCalledTimes(1);
    expect(kinds).toHaveBeenCalledTimes(1);
    expect(ids).toHaveBeenCalledTimes(1);
    expect(visualActions).toHaveBeenCalledTimes(1);
  });

  it('never crosses into simIdOf during the steady fixed-tick sample', () => {
    const input = source();
    const simIdOf = vi.spyOn(input, 'simIdOf');
    const identities = new FootstepIdentityLookup();
    identities.rebuild(input);
    expect(simIdOf).toHaveBeenCalledTimes(3);
    simIdOf.mockClear();

    sampleFootstepsAfterTick(input, sink([]), identities);
    sampleFootstepsAfterTick(input, sink([]), identities);

    expect(simIdOf).not.toHaveBeenCalled();
  });

  it('copies zero-copy columns before simIdOf can invalidate WASM views', () => {
    const liveKinds = new Uint32Array([KIND_AGENT, KIND_AGENT]);
    const liveIds = new Uint32Array([41, 43]);
    let firstCall = true;
    const input: FootstepFrameSource = {
      count: 2,
      positions: () => new Float32Array([2, 3, 7, 8]),
      kinds: () => liveKinds,
      ids: () => liveIds,
      visualActions: () => new Uint32Array([VISUAL_ACTION_WALK, 0]),
      simIdOf(entity) {
        if (firstCall) {
          firstCall = false;
          // Models a memory-growing boundary call invalidating both live views.
          liveKinds.fill(0);
          liveIds.fill(0);
        }
        return entity === 41 ? 7001 : entity === 43 ? 7003 : null;
      },
    };
    const identities = new FootstepIdentityLookup();

    identities.rebuild(input);

    expect(identities.simIdAt(0, 41)).toBe(7001);
    expect(identities.simIdAt(1, 43)).toBe(7003);
  });

  it('skips a changed row until the lookup is rebuilt', () => {
    const input = source();
    const identities = new FootstepIdentityLookup();
    identities.rebuild(input);
    input.ids = () => new Uint32Array([99, 42, 43, 44]);
    const calls: string[] = [];

    sampleFootstepsAfterTick(input, sink(calls), identities);

    expect(calls).toEqual(['begin', '7003:7:8:false', 'end']);
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
    const identities = new FootstepIdentityLookup();
    identities.rebuild(input);
    const calls: string[] = [];
    const failingSink: FootstepFrameSink = {
      beginFootstepFrame: () => calls.push('begin'),
      observeFootstep: () => {
        calls.push('observe');
        throw new Error('audio device disappeared');
      },
      endFootstepFrame: () => calls.push('end'),
    };

    expect(() => sampleFootstepsAfterTick(input, failingSink, identities)).toThrow(
      'audio device disappeared',
    );
    expect(calls).toEqual(['begin', 'observe', 'end']);
  });

  it('samples after every fixed tick and never from paused command flushing', () => {
    expect(MAIN).toMatch(
      /const frameSimulation = \{[\s\S]*?tick\(\): void \{\s*sim\.tick\(\);[\s\S]*?sampleFootstepsAfterTick\(sim, audio, footstepIdentities\);[\s\S]*?flushCommands\(\): void \{\s*sim\.flushCommands\(\);/,
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
      /sampleStartedMs = performance\.now\(\)[\s\S]*?sampleFootstepsAfterTick\(sim, audio, footstepIdentities\)[\s\S]*?footstepSamplerTimer\.sample\(performance\.now\(\) - sampleStartedMs\)/,
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

  it('rebuilds stable identity only at startup and after a successful Load', () => {
    expect(MAIN.match(/footstepIdentities\.rebuild\(sim\)/g)).toHaveLength(2);
    expect(MAIN).toMatch(
      /if \(loaded\) \{[\s\S]*?footstepIdentities\.rebuild\(sim\);[\s\S]*?audio\.reset\('load'\)/,
    );
  });
});
