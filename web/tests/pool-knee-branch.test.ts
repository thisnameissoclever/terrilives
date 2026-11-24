import {expect,it} from 'vitest';
import literals from './pool-knee-branch-literals.json';
import {poolKneePolicies,observePoolKneeBranch} from '../src/render/character/pool-knee-branch.js';
import {poolRig} from './pool-observer-fixture.js';
import contact from './pool-contact-frame-literal.json';
import {inverseAffine,multiply,type Vec3} from '../src/render/character/math.js';
import {composeSkeletonPose} from '../src/render/character/pose-joints.js';
import {interpolatePoolPose} from '../src/render/character/pool-contact-sample.js';
import {properPoolRotation} from '../src/render/character/pool-canonical-pose.js';
import type {PoolIntervalLimb} from '../src/render/character/pool-contact-evaluator.js';

it('rejects the retained opposite-flexion .2 branch while preserving source-consistent .5/.6 controls',()=>{
  const policies=poolKneePolicies(poolRig.manifest);
  for(const policy of policies){
    expect(policy.referenceFrame).toBe(0);expect(policy.sign).toBe(1);
    expect(observePoolKneeBranch(poolRig.manifest.basisActions.pool_enter[8],policy).admissible).toBe(true);
    for(const record of literals.records){const result=observePoolKneeBranch(record.basis,policy);
      if(record.phase===.2&&policy.side==='L')expect(result.admissible).toBe(false);
      else if(record.phase!==.2)expect(result.admissible).toBe(true);
    }
  }
  expect(policies.find(policy=>policy.side==='R')!.sourceOppositeFrames.length).toBeGreaterThan(0);
});

it('preserves the same branch decision through the actual prepared limb-control evaluator',()=>{
  const bundle=poolRig.manifest,rest=contact.rest,inverse=rest.map(inverseAffine),policies=poolKneePolicies(bundle);
  for(const record of literals.records){
    const world=composeSkeletonPose(bundle.bones,rest,record.basis),point=(matrix:readonly number[])=>matrix.slice(12,15) as unknown as Vec3;
    const controls:PoolIntervalLimb[]=policies.map(policy=>{
      const upper=bundle.bones.findIndex(bone=>bone.name==='thigh.'+policy.side),lower=policy.bone,end=bundle.bones.findIndex(bone=>bone.name==='foot.'+policy.side);
      const state={target:point(world[end]),pole:point(world[lower]),orientation:properPoolRotation(world[end])};
      return {upper,lower,end,anchor:[0,0,0,1],from:state,to:state};
    });
    const skin=interpolatePoolPose(bundle,rest,inverse,record.basis,record.basis,.5,controls);
    const actualWorld=rest.map((matrix,bone)=>multiply(skin.subarray(bone*16,bone*16+16),matrix));
    const actualBasis=actualWorld.map((matrix,bone)=>{
      const parent=bundle.bones[bone].parent;if(parent<0)return multiply(inverse[bone],matrix);
      const local=multiply(inverse[parent],rest[bone]);return multiply(inverseAffine(local),multiply(inverseAffine(actualWorld[parent]),matrix));
    });
    for(const policy of policies){const result=observePoolKneeBranch(actualBasis,policy);
      if(record.phase===.2&&policy.side==='L')expect(result.admissible).toBe(false);
      else if(record.phase!==.2)expect(result.admissible).toBe(true);
    }
  }
});
