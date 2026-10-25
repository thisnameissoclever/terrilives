import {expect,it} from 'vitest';
import fixture from '../../assets/models/sims/character-creator/clips/pool/contacts-v1.json';
import type {PoolFixtureV1} from '../src/render/character/pool-contact-types.js';
import {poolSourcePolicy,poolPolicySupportLimbs,requirePoolPolicyInterval} from '../src/render/character/pool-source-policy.js';
import {makePoolPoseProgram} from '../src/render/character/pool-pose-program.js';
import {properPoolRotation} from '../src/render/character/pool-canonical-pose.js';
import {identity} from '../src/render/character/math.js';
const source=fixture as unknown as PoolFixtureV1;

it('derives actual release-start and later free obligations from unchanged source records',()=>{
  const start=poolSourcePolicy(source,'pool_enter',.2),middle=poolSourcePolicy(source,'pool_enter',.2125),end=poolSourcePolicy(source,'pool_enter',.225);
  expect(start.footL.mode).toBe('release');expect(start.footL.required).toBe(true);expect(middle.footL.required).toBe(false);expect(end.footL.mode).toBe('free');
  expect(poolPolicySupportLimbs(start)).toEqual(['handL','handR','footL','footR']);
  expect(()=>requirePoolPolicyInterval(start,end,middle,['handL','handR','footL','footR'])).not.toThrow();
  expect(()=>requirePoolPolicyInterval(start,end,middle,['handL','handR','footR'])).toThrow('source contact policy');
});

it('keeps approach/support and explicit whole-hand release handoffs on their original regions',()=>{
  for(const [left,right] of [[.275,.3],[.475,.48],[.48,.5]] as const){
    const a=poolSourcePolicy(source,'pool_enter',left),b=poolSourcePolicy(source,'pool_enter',right),interior=poolSourcePolicy(source,'pool_enter',(left+right)/2);
    const required=(['handL','handR','footL','footR'] as const).filter(limb=>a[limb].required||b[limb].required||interior[limb].required);
    expect(()=>requirePoolPolicyInterval(a,b,interior,required)).not.toThrow();
  }
  const a=poolSourcePolicy(source,'pool_enter',.2),bad=structuredClone(a);bad.handL.surface='Pool ladder rail 2';
  expect(()=>requirePoolPolicyInterval(a,bad,a,poolPolicySupportLimbs(a))).toThrow('source contact policy');
  const node=makePoolPoseProgram(Array.from({length:17},()=>properPoolRotation(identity())),[],a);expect(Object.isFrozen(node.policy.handL.region)).toBe(true);expect(()=>{node.policy.handL.mode='free';}).toThrow();
});
