import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {defaultAppearance,validateAppearance} from '../src/character/schema.js';
import {PoolCycleSource,validatePoolCycleDefinition} from '../src/render/character/pool-cycle-source.js';
import {evaluatePoolPoseProgram} from '../src/render/character/pool-contact-sample.js';
import {measureRawPoolPhysicalObservation} from '../src/render/character/pool-owned-compilation.js';
import {parseOwnedPoolFixture} from '../src/render/character/pool-owned-fixture.js';
import type {PoolPoseProgram} from '../src/render/character/pool-pose-program.js';
import {poolSourceEvents} from '../src/render/character/pool-source-policy.js';
import {PreparedBody} from '../src/render/character/prepared-body.js';
import {anatomicalHeight} from '../src/render/character/shape.js';
import {poolBase,poolRig} from './pool-observer-fixture.js';

const directory=new URL('../../assets/models/sims/character-creator/',import.meta.url);
const read=(file:string)=>readFileSync(new URL(file,directory),'utf8');

it('admits the short broad opening from the planted stance through the second rung',()=>{
 const previous:unknown=JSON.parse(read('pool_activity_motion_v14.json')),candidate:unknown=JSON.parse(read('pool_activity_motion_v15.json'));
 validatePoolCycleDefinition(previous);validatePoolCycleDefinition(candidate);
 const base=defaultAppearance('masculine');
 const appearance=validateAppearance({...base,body:{height:0,build:100,shoulders:100,hips:100,torso:100}});
 const shape={presentation:appearance.presentation,...appearance.body,face:appearance.face};
 const selection=new PreparedBody(poolBase,appearance).select(poolRig,appearance,{wear:'bare',prop:'none',fixture:'none',
  eyes_closed:false,includeFixture:false,clip:'pool_enter',swimwear:'trunks'});
 if(!selection.extra)throw new Error('Pool acquisition needs the selected swimwear');
 const bundle=poolRig.manifest,geometry=[selection.body,selection.extra],top=anatomicalHeight(poolBase.vertices);
 const oldFixture=parseOwnedPoolFixture(read('clips/pool/contacts-v3.json')),fixture=parseOwnedPoolFixture(read('clips/pool/contacts-v4.json'));
 const before=new PoolCycleSource(bundle,shape,top,geometry,oldFixture,previous);
 const after=new PoolCycleSource(bundle,shape,top,geometry,fixture,candidate);
 expect(()=>before.entry(.01)).toThrow('Pool source has no forward/reachable actual grip: handL 0.05');
 expect(()=>before.entry(.05)).toThrow('Pool source has no forward/reachable actual grip: handL 0.05');
 const originalGround=before.entry(0),newGround=after.entry(0),keys=poolSourceEvents(fixture,'pool_enter').filter(phase=>phase<=.22001);
 expect(newGround).toEqual(originalGround);
 const programs=new Map<number,PoolPoseProgram>(),failures:unknown[]=[];
 const details=(error:unknown)=>error instanceof Error?{message:error.message,cause:error.cause}:error;
 for(const phase of keys){
  try{programs.set(phase,after.entry(phase));}
  catch(error){failures.push({phase,stage:'source',error:details(error)});}
 }
 const acquisition=programs.get(.05),first=programs.get(.12),second=programs.get(.22);
 if(acquisition){
  expect(acquisition.controls.slice(0,2).map(row=>row.state.target)).toEqual(originalGround.controls.slice(0,2).map(row=>row.state.target));
  expect(acquisition.policy).toMatchObject({
   handL:{required:true,surface:'Pool ladder rail 1'},handR:{required:true,surface:'Pool ladder rail 2'},
   footL:{required:true,surface:'ground:approach'},footR:{required:true,surface:'ground:approach'},
  });
  for(const control of acquisition.controls.slice(2))expect(control.state.attached?.parameter).toBe(5);
 }
 if(first)expect(first.policy).toMatchObject({
  handL:{required:true,surface:'Pool ladder rail 1'},handR:{required:true,surface:'Pool ladder rail 2'},
  footL:{required:true,surface:'Pool outside ladder tread 1'},footR:{required:true,surface:'ground:approach'},
 });
 if(second)expect(second.policy).toMatchObject({
  handL:{required:true,surface:'Pool ladder rail 1'},handR:{required:true,surface:'Pool ladder rail 2'},
  footL:{required:true,surface:'Pool outside ladder tread 1'},footR:{required:true,surface:'Pool outside ladder tread 2'},
 });
 for(const phase of [.05,.064,.12]){
  const node=programs.get(phase);
  if(!node)continue;
  const pose=evaluatePoolPoseProgram(bundle,after.neutral.rest,after.neutral.inverse,node,{action:'pool_enter',phase});
  for(const [index,control] of node.controls.slice(2).entries()){
   const x=pose.world[control.lower][12]-pose.world[control.upper][12];
   expect(x*(index===0?1:-1)).toBeGreaterThan(0);
  }
 }
 for(const phase of [.185,.205,.21999,.22,.22001]){
  const node=programs.get(phase);
  if(!node)continue;
  const original=before.entry(phase);
  expect(node.preferenceBasis).toEqual(original.preferenceBasis);
  expect(node.policy).toEqual(original.policy);
  node.controls.forEach(({state},index)=>{
   const expected=original.controls[index].state;
   expect(state.target).toEqual(expected.target);
   expect(state.orientation).toEqual(expected.orientation);
   expect(state.pole).toEqual(expected.pole);
   expect(state.attached?.parameter).toBe(expected.attached?.parameter);
   expect(state.attached?.activeVertex).toBe(expected.attached?.activeVertex);
  });
 }
 const inspect=(phase:number,left:PoolPoseProgram,right:PoolPoseProgram,amount:number)=>{
  try{
   const result=measureRawPoolPhysicalObservation(after,left,right,amount,{action:'pool_enter',phase});
   if(!result.passed){
    const supports=result.supports.map(({limb,required,satisfied,surface,minimumGap,projectedArea,coveredArea,reasons})=>
     ({limb,required,satisfied,surface,minimumGap,projectedArea,coveredArea,reasons}));
    failures.push({phase,stage:'physical',unresolved:result.unresolved,supports});
   }
  }catch(error){failures.push({phase,stage:'physical',error:details(error)});}
 };
 for(const [phase,program] of programs)inspect(phase,program,program,0);
 for(let index=1;index<keys.length;index++){
  const low=keys[index-1],high=keys[index],left=programs.get(low),right=programs.get(high);
  if(!left||!right)continue;
  for(const amount of [.25,.5,.75])inspect(low+(high-low)*amount,left,right,amount);
 }
 expect(failures).toEqual([]);
},90_000);
