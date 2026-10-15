import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Bundle } from '../src/render/character/bundle.js';
import { neutralAppearance } from '../src/render/character/appearance.js';
import { composeSkeletonPose, configuredPose } from '../src/render/character/pose.js';
import { length, multiply, solveLimb, sub } from '../src/render/character/math.js';
const bundle = JSON.parse(readFileSync(new URL('../../assets/models/sims/appearance-proof/export-v2/manifest.json', import.meta.url), 'utf8')) as Bundle;
describe('configured skeleton', () => {
  it('reconstructs every source pose from the rest hierarchy and local animation', () => {
    for(const action of Object.keys(bundle.actions)) for(let frame=0;frame<bundle.actions[action].length;frame++) {
      const pose=composeSkeletonPose(bundle.bones,bundle.bones.map(b=>b.rest),bundle.basisActions[action][frame]);
      for(let bone=0;bone<pose.length;bone++) {
        expect(Math.max(...pose[bone].map((v,i)=>Math.abs(v-bundle.actions[action][frame][bone][i]))),`${action}/${frame}/${bone}`).toBeLessThan(.00002);
      }
    }
  });
  it('does not jump when a slider crosses the neutral checkpoint', () => {
    for (const action of ['idle', 'walk', 'read']) for (let frame = 0; frame < bundle.actions[action].length; frame++) {
      const exact = configuredPose(bundle, neutralAppearance(), action, frame, 2.1);
      const adjacent = configuredPose(bundle, { ...neutralAppearance(), build: 50.00001 }, action, frame, 2.1);
      expect(Math.max(...exact.map((v, i) => Math.abs(v-adjacent[i]))), `${action}/${frame}`).toBeLessThan(.0001);
    }
  });
  it('solves contact without changing either limb length and rejects unreachable targets', () => {
    const start = [0, 0, 1] as const, end = [0, -.3, .2] as const;
    const joint = solveLimb(start, end, .5, .5, [0, -1, .7]);
    expect(length(sub(joint, start))).toBeCloseTo(.5, 10);
    expect(length(sub(end, joint))).toBeCloseTo(.5, 10);
    expect(() => solveLimb(start, [0, 0, -1], .5, .5, [0, 1, 0])).toThrow(/Unreachable/);
  });
  it('produces finite transforms for all candidate configurations and authored frames', () => {
    for (const presentation of ['masculine', 'feminine'] as const) for (const height of [0, 50, 100]) for (const build of [0, 50, 100]) {
      const a = { ...neutralAppearance(), presentation, height, build };
      for (const action of ['idle', 'walk', 'read']) for (let frame = 0; frame < bundle.actions[action].length; frame++) {
        expect(() => {
          const pose = configuredPose(bundle, a, action, frame, 2.1);
          expect(pose.length).toBe(272); expect([...pose].every(Number.isFinite)).toBe(true);
        }, `${presentation}/${height}/${build}/${action}/${frame}`).not.toThrow();
      }
    }
  });
});
