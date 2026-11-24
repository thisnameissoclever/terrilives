import {withSelectedPoolBasisInputs} from '../src/render/character/pool-matrix-producer.js';
import {expect,it} from 'vitest';
import motion from '../../assets/models/sims/character-creator/pool_activity_motion_v16.json';
import contacts from '../../assets/models/sims/character-creator/clips/pool/contacts-v5.json?raw';
import {defaultAppearance,validateAppearance} from '../src/character/schema.js';
import {PoolCycleSource,validatePoolCycleDefinition} from '../src/render/character/pool-cycle-source.js';
import {captureSelectedPoolKnot,bindSelectedPoolRoute} from '../src/render/character/pool-selected-cycle.js';
import {parseOwnedPoolFixture} from '../src/render/character/pool-owned-fixture.js';
import {makePoolPoseProgram} from '../src/render/character/pool-pose-program.js';
import {poolSourcePolicy} from '../src/render/character/pool-source-policy.js';
import {PreparedBody} from '../src/render/character/prepared-body.js';
import {anatomicalHeight} from '../src/render/character/shape.js';
import {poolBase,poolRig} from './pool-observer-fixture.js';
import {add,sub,type Vec3} from '../src/render/character/math.js';
import type {NumericBody} from '../src/render/character/pool-numeric-recipe.js';
import type {PoolContactInputV1} from '../src/render/character/pool-contact-types.js';
import {measureRawPoolPhysicalObservation} from '../src/render/character/pool-owned-compilation.js';

function makeSource(){
 const base=defaultAppearance('masculine'),appearance=validateAppearance({...base,body:{height:0,build:100,hips:100,shoulders:100,torso:100}});
 const def:unknown=structuredClone(motion);validatePoolCycleDefinition(def);
 const f=parseOwnedPoolFixture(contacts);
 const selection=new PreparedBody(poolBase,appearance).select(poolRig,appearance,
  {wear:'bare',fixture:'none',prop:'none',clip:'pool_enter',includeFixture:false,eyes_closed:false,swimwear:'trunks'});
 return new PoolCycleSource(poolRig.manifest,{presentation:appearance.presentation,...appearance.body,face:appearance.face},anatomicalHeight(poolBase.vertices),
  [selection.body,selection.extra!],f,def);
}

it('rebinds detached pool controls to a fresh physical source and refuses changed required contacts',()=>{
 const {original,data}=withSelectedPoolBasisInputs(()=>{
  const first=makeSource(),original=first.entry(.05);
  return {original,data:captureSelectedPoolKnot(first,5000,original)};
 });
 const second=makeSource();
 const rebuilt=second.materializeSelectedKnot(data);
 expect(rebuilt.preferenceBasis).toEqual(original.preferenceBasis);
 for(let i=0;i<4;i++){
  expect(rebuilt.controls[i].state.target).toEqual(original.controls[i].state.target);
  expect(rebuilt.controls[i].state.pole).toEqual(original.controls[i].state.pole);
 }
 expect(rebuilt.controls[2].state.attached!.geometry).not.toBe(original.controls[2].state.attached!.geometry);
 const altered=structuredClone(data);altered.limbs.footR.target=add(altered.limbs.footR.target,[.001,0,0]);
 expect(()=>second.materializeSelectedKnot(altered)).toThrow('installed sole');
 const hand=structuredClone(data);hand.limbs.handL.target=add(hand.limbs.handL.target,[0,.001,0]);
 expect(()=>second.materializeSelectedKnot(hand)).toThrow('literal rail construction');
});

it('rejects missing selected prefix units and an unrelated input key',()=>{
 const source=makeSource(),input={key:'selected-pool-request'} as PoolContactInputV1;
 const route={inputKey:input.key,entry:[],withdrawalBody:{hips:[0,0,0] as Vec3,hipPitch:0,trunkPitch:0,headPitch:0}};
 expect(()=>bindSelectedPoolRoute(source,input,route)).toThrow('complete prefix through withdrawal');
 expect(()=>bindSelectedPoolRoute(source,input,{...route,inputKey:'another input'})).toThrow('different motion or physical input');
});

it('continues the selected short broad 62380 seam to the visible swim loop with both wrists and proper release timing',()=>{
 const phase=.6238;
 const intent:NumericBody={hips:[-.5000000452823535,.4808191509361419,1.0223225704720063],hipPitch:0,trunkPitch:30,headPitch:10};
 const data=withSelectedPoolBasisInputs(()=>{
 const src=makeSource(),placed=src['placeBody'](intent),baseline=src.body(phase),point=(m:readonly number[]):Vec3=>[m[12],m[13],m[14]];
 const controls=src.entry(.94).controls.map((chain,i)=>{
   const limb=(['footL','footR','handL','handR'] as const)[i],a=src.anatomy[limb];
   if(limb==='footL'||limb==='footR')return {...chain,state:{target:src['freeFootGoal'](limb,phase,intent),orientation:src['flatFeet'][limb],pole:point(placed.world[a.lower])}};
   const old=src['hand'](limb,phase,baseline);
   return {...chain,state:{...old,pole:add(old.pole,sub(point(placed.world[a.upper]),point(baseline.pose.world[a.upper])))}};
 });
 const previous=makePoolPoseProgram(placed.basis,controls,poolSourcePolicy(src.fixture,'pool_enter',phase));
 return captureSelectedPoolKnot(src,62380,previous);
 });
 const src=makeSource(),start=src.materializeSelectedKnot(data);
 const next=src.withdrawalFrom(start,intent);
 expect(next(.6238)).toBe(start);
 expect(next(.94)).toBe(src.entry(.94));expect(next(1)).toBe(src.paddle(0));expect(next(1)).toBe(src.paddle(1));
 const landed=next(.64),released=next(.656);
 expect(landed.controls[2].state.target).toEqual(start.controls[2].state.target);
 expect(landed.controls[3].state.target).toEqual(start.controls[3].state.target);
 expect(released.controls.slice(2).every(c=>!c.state.attached)).toBe(true);
 for(const p of [.64,.656,.692,.88,.94,1]){
   const node=next(p),m=measureRawPoolPhysicalObservation(src,node,node,0,{action:'pool_enter',phase:p});
   expect(m.unresolved).toEqual([]);expect(m.passed).toBe(true);
 }
},45_000);
