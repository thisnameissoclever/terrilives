import {expect,it} from 'vitest';
import {describeSplitPoolRoute,type SharedPoolRoute,type PoolShapeRouteKnot} from '../src/render/character/pool-shape-route.js';
import type {PoolCycleDefinition} from '../src/render/character/pool-cycle-source.js';
import {syntheticPoolPolicyFixture} from './pool-policy-fixture.js';
import {readFileSync} from 'node:fs';
import {requirePoolOuterTransfer} from '../src/render/character/pool-exit-transfer.js';

function references(){
  const before=syntheticPoolPolicyFixture(),after=structuredClone(before);
  after.revisions.poseProducer='b'.repeat(64);
  const sample=after.clips.pool_exit_0.samples.find(s=>s.phase>.1&&s.phase<1)!;
  const unit=sample.phase*100000;
  const motion={version:16,clockUnits:100000,reference:{sourceRigSha256:'rig'},
    forwardHop:{launchFromUnit:42000,climbKeys:[{unit,exitReferenceUnit:unit},{unit:100000,entryUnit:0}]}} as unknown as PoolCycleDefinition;
  const knot={unit,action:'pool_exit_0',limbs:{footL:{},footR:{},handL:{},handR:{}}} as PoolShapeRouteKnot;
  const prior:SharedPoolRoute={version:1,rig:'rig',model:before.revisions.model,motion:before.revisions.poseProducer,
    referenceShape:'reference',entry:[],climbOut:[knot]};
  return {before,after,prior,motion,knot,phase:sample.phase};
}

it('retains only the exit poses named by the new motion and binds their destination revision',()=>{
  const {before,after,prior,motion,knot}=references();
  expect(describeSplitPoolRoute(prior,before,motion,after)).toEqual({
    version:2,rig:'rig',model:after.revisions.model,motion:after.revisions.poseProducer,exitReferences:[knot],
  });
});

it('preserves a selected foot swivel and rejects a hand swivel in the release data',()=>{
  const {before,after,prior,motion,knot}=references();
  knot.limbs.footR.kneeOrbit=-.25;
  expect(describeSplitPoolRoute(prior,before,motion,after).exitReferences[0].limbs.footR.kneeOrbit).toBe(-.25);
  knot.limbs.handL.kneeOrbit=0;
  expect(()=>describeSplitPoolRoute(prior,before,motion,after)).toThrow();
});

it.each([NaN,Infinity,-Infinity,1.001,-1.001])('rejects an invalid foot swivel (%s) before shipping the route',value=>{
  const {before,after,prior,motion,knot}=references();
  knot.limbs.footL.kneeOrbit=value;
  expect(()=>describeSplitPoolRoute(prior,before,motion,after)).toThrow();
});

it('rejects a changed support obligation for an individual exit origin',()=>{
  const {before,after,prior,motion,phase}=references();
  after.clips.pool_exit_11.samples.find(s=>s.phase===phase)!.limbs.footL={
    mode:'support',surface:'changed tread',region:{kind:'top-face',triangles:[1]},interval:null,
  };
  expect(()=>describeSplitPoolRoute(prior,before,motion,after)).toThrow('different support policy');
});

it('rejects the original bilateral fixture paired with the right-hand-first declaration',()=>{
  const read=(name:string)=>JSON.parse(readFileSync(new URL('../../assets/models/sims/character-creator/'+name,import.meta.url),'utf8'));
  const motion=read('pool_activity_motion_v18.json'),fixture=read('clips/pool/contacts-v7.json');
  motion.forwardHop.outerGripTransfer={kind:'right-first',rightContactUnit:65000,leftApproachUnit:74030,leftContactUnit:74769};
  expect(()=>requirePoolOuterTransfer(motion,fixture)).toThrow('staggered rail grip');
});
