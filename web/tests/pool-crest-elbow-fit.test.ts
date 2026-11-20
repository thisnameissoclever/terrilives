import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {defaultAppearance} from '../src/character/schema.js';
import {posedCageSurface} from '../src/render/character/geometry-proof.js';
import {poolContactFixture} from '../src/render/character/pool-contact-preparation.js';
import {evaluatePoolPoseProgram,poolSkinMatrices} from '../src/render/character/pool-contact-sample.js';
import {PoolCycleSource,validatePoolCycleDefinition} from '../src/render/character/pool-cycle-source.js';
import {configuredPoolChainReach} from '../src/render/character/pool-entry-domain.js';
import {observePoolSource} from '../src/render/character/pool-observer.js';
import {parseOwnedPoolFixture} from '../src/render/character/pool-owned-fixture.js';
import {poolSourceRecord} from '../src/render/character/pool-source-policy.js';
import {PreparedBody} from '../src/render/character/prepared-body.js';
import {anatomicalHeight} from '../src/render/character/shape.js';
import {poolBase,poolRig} from './pool-observer-fixture.js';

const directory=new URL('../../assets/models/sims/character-creator/',import.meta.url);
const read=(file:string)=>readFileSync(new URL(file,directory),'utf8');
const sha256=(text:string)=>createHash('sha256').update(text).digest('hex');
const motionV13=read('pool_activity_motion_v13.json'),motionV14=read('pool_activity_motion_v14.json');
const contactsV2=read('clips/pool/contacts-v2.json'),contactsV3=read('clips/pool/contacts-v3.json');
const fixtureV2=parseOwnedPoolFixture(contactsV2);

it('derives the active fixture from the previous bytes by changing the authored motion hash',()=>{
 const previous=sha256(motionV13),current=sha256(motionV14);
 expect(fixtureV2.revisions.poseProducer).toBe(previous);
 expect(Buffer.from(contactsV3).equals(Buffer.from(contactsV2.replace('"poseProducer":"'+previous+'"','"poseProducer":"'+current+'"')))).toBe(true);
 expect(poolContactFixture().revisions.poseProducer).toBe(current);
});

it('requires the v14 crest elbow adjustment at the existing attached hand events',()=>{
 const prior=JSON.parse(motionV13),candidate=JSON.parse(motionV14),crest=candidate.hand.crestElbowPole;
 const {crestElbowPole,...originalHand}=candidate.hand;
 expect({...candidate,version:13,hand:originalHand}).toEqual(prior);
 expect(crestElbowPole).toMatchObject({fromUnit:48000,peakUnit:49600,toUnit:53200,peakUpperArmFraction:.85});
 expect(()=>validatePoolCycleDefinition(prior)).not.toThrow();
 expect(()=>validatePoolCycleDefinition(candidate)).not.toThrow();
 expect(()=>validatePoolCycleDefinition({...prior,hand:{...prior.hand,crestElbowPole:crest}})).toThrow('v13 cannot author');
 for(const invalid of [undefined,null,[],{...crest,extra:0},{...crest,fromUnit:48001},{...crest,peakUnit:48000},
  {...crest,toUnit:49600},{...crest,peakUpperArmFraction:'0.35'},{...crest,peakUpperArmFraction:Infinity},
  {...crest,peakUpperArmFraction:0},{...crest,peakUpperArmFraction:1.01}]){
  expect(()=>validatePoolCycleDefinition({...candidate,hand:{...candidate.hand,crestElbowPole:invalid}})).toThrow('v14 crest elbow pole is invalid');
 }
 for(const unit of [crest.fromUnit,crest.peakUnit,crest.toUnit]){
  const source=poolSourceRecord(poolContactFixture(),{action:'pool_enter',phase:unit/candidate.clockUnits});
  expect(source.kind).toBe('key');
  expect(source.limbs.handL.mode).toBe('support');
  expect(source.limbs.handR.mode).toBe('support');
 }
});

it('clears the measured upper arm crossings by changing the attached elbow poles',()=>{
 const prior:unknown=JSON.parse(motionV13),candidate:unknown=JSON.parse(motionV14);
 validatePoolCycleDefinition(prior);validatePoolCycleDefinition(candidate);
 if(candidate.version!==14)throw new Error('Expected the v14 pool motion');
 const appearance=defaultAppearance('masculine'),shape={presentation:appearance.presentation,...appearance.body,face:appearance.face};
 const selection=new PreparedBody(poolBase,appearance).select(poolRig,appearance,{wear:'bare',prop:'none',fixture:'none',
  eyes_closed:false,includeFixture:false,clip:'pool_enter',swimwear:'trunks'});
 if(!selection.extra)throw new Error('Pool fit requires the selected swimwear');
 const bundle=poolRig.manifest,geometry=[selection.body,selection.extra],top=anatomicalHeight(poolBase.vertices);
 const before=new PoolCycleSource(bundle,shape,top,geometry,fixtureV2,prior);
 const after=new PoolCycleSource(bundle,shape,top,geometry,poolContactFixture(),candidate);
 const crest=candidate.hand.crestElbowPole,phase=crest.peakUnit/candidate.clockUnits,location={action:'pool_enter',phase};
 const first=before.entry(phase),second=after.entry(phase);
 expect(second.preferenceBasis).toEqual(first.preferenceBasis);
 expect(second.policy).toEqual(first.policy);
 expect(second.controls.slice(0,2)).toEqual(first.controls.slice(0,2));
 const beforePose=evaluatePoolPoseProgram(bundle,before.neutral.rest,before.neutral.inverse,first,location);
 const afterPose=evaluatePoolPoseProgram(bundle,after.neutral.rest,after.neutral.inverse,second,location);
 for(const [index,limb] of ['handL','handR'].entries()){
  const {upper,lower,end,state:a}=first.controls[index+2],{state:b}=second.controls[index+2];
  const upperArm=configuredPoolChainReach(before.neutral.rest,upper,lower,end).lengths[0];
  expect(b.pole).toEqual([a.pole[0],a.pole[1]-upperArm*crest.peakUpperArmFraction,a.pole[2]]);
  expect(b.target).toEqual(a.target);
  expect(b.orientation).toEqual(a.orientation);
  expect(b.attached?.parameter).toBe(a.attached?.parameter);
  expect(b.attached?.rawOrientation).toEqual(a.attached?.rawOrientation);
  expect(b.attached?.activeVertex).toBe(a.attached?.activeVertex);
  const shoulder=afterPose.world[upper][12],elbow=afterPose.world[lower][12];
  expect((elbow-shoulder)*(limb==='handL'?1:-1)).toBeGreaterThan(0);
 }
 const upperArmCrossings=(source:PoolCycleSource,pose:typeof beforePose)=>{
  const skin=poolSkinMatrices(pose.world,source.neutral.inverse);
  const surfaces=geometry.map((g,i)=>({geometry:g,points:posedCageSurface(g,source.cages[i],skin)}));
  return observePoolSource(source.fixture,surfaces,location).violations.filter(w=>
   w.part?.startsWith('Creator upper arm skin ')&&w.surface.startsWith('Pool ladder rail '));
 };
 expect(upperArmCrossings(before,beforePose)).toEqual(expect.arrayContaining([
  expect.objectContaining({bodyTriangle:27351,surfaceTriangle:972,part:'Creator upper arm skin L'}),
  expect.objectContaining({bodyTriangle:27613,surfaceTriangle:968,part:'Creator upper arm skin R'}),
 ]));
 expect(upperArmCrossings(after,afterPose)).toEqual([]);
 for(const unchanged of [crest.fromUnit/candidate.clockUnits,crest.toUnit/candidate.clockUnits,.64,.648,.656]){
  expect(after.entry(unchanged).controls.map(c=>c.state.pole)).toEqual(before.entry(unchanged).controls.map(c=>c.state.pole));
 }
 expect(after.paddle(1/12)).toEqual(before.paddle(1/12));
});
