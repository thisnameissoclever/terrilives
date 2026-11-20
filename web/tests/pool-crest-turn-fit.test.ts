import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {defaultAppearance,validateAppearance} from '../src/character/schema.js';
import {PoolCycleSource,validatePoolCycleDefinition} from '../src/render/character/pool-cycle-source.js';
import {measureRawPoolPhysicalObservation} from '../src/render/character/pool-owned-compilation.js';
import {configuredPoolChainReach} from '../src/render/character/pool-entry-domain.js';
import {length,sub,type Vec3} from '../src/render/character/math.js';
import {evaluatePoolPoseProgram} from '../src/render/character/pool-contact-sample.js';
import {parseOwnedPoolFixture} from '../src/render/character/pool-owned-fixture.js';
import type {PoolPoseProgram} from '../src/render/character/pool-pose-program.js';
import {poolSourceEvents} from '../src/render/character/pool-source-policy.js';
import {PreparedBody} from '../src/render/character/prepared-body.js';
import {anatomicalHeight} from '../src/render/character/shape.js';
import {poolBase,poolRig} from './pool-observer-fixture.js';

const directory=new URL('../../assets/models/sims/character-creator/',import.meta.url);
const read=(name:string)=>readFileSync(new URL(name,directory),'utf8');

function sources(){
 const prior:unknown=JSON.parse(read('pool_activity_motion_v14.json')),candidate:unknown=JSON.parse(read('pool_activity_motion_v15.json'));
 validatePoolCycleDefinition(prior);validatePoolCycleDefinition(candidate);
 const appearance=validateAppearance({...defaultAppearance('masculine'),body:{height:0,build:100,shoulders:100,hips:100,torso:100}});
 const shape={presentation:appearance.presentation,...appearance.body,face:appearance.face};
 const selection=new PreparedBody(poolBase,appearance).select(poolRig,appearance,{wear:'bare',prop:'none',fixture:'none',
  eyes_closed:false,includeFixture:false,clip:'pool_enter',swimwear:'trunks'});
 if(!selection.extra)throw new Error('Pool crest fit needs the selected swimwear');
 const bundle=poolRig.manifest,geometry=[selection.body,selection.extra],top=anatomicalHeight(poolBase.vertices);
 const before=new PoolCycleSource(bundle,shape,top,geometry,parseOwnedPoolFixture(read('clips/pool/contacts-v3.json')),prior);
 const fixture=parseOwnedPoolFixture(read('clips/pool/contacts-v4.json'));
 const after=new PoolCycleSource(bundle,shape,top,geometry,fixture,candidate);
 return {before,after,fixture};
}

it('constructs the exterior turn key within the swing leg reach',()=>{
 const {before,after}=sources(),phase=.432,old=before.entry(.42),node=after.entry(phase);
 expect(node.controls[3].state.target).toEqual(old.controls[3].state.target);
 expect(node.controls[3].state.orientation).toEqual(old.controls[3].state.orientation);
 expect(node.policy.footR).toMatchObject({required:true,surface:'Pool ladder crest landing'});
 const {upper,lower,end,state}=node.controls[0],thigh=after.body(phase).pose.world[upper].slice(12,15) as unknown as Vec3;
 const reach=configuredPoolChainReach(after.neutral.rest,upper,lower,end),distance=length(sub(thigh,state.target));
 expect(distance).toBeGreaterThan(reach.minimum);
 expect(distance).toBeLessThan(reach.maximum);
});

it('clears the early crest contacts and measures the literal inside handoff',()=>{
 const {before,after,fixture}=sources(),location=(phase:number)=>({action:'pool_enter',phase});
 const keys=poolSourceEvents(fixture,'pool_enter').filter(phase=>phase>=.42&&phase<=.496);
 const programs=new Map<number,PoolPoseProgram>(),failures:unknown[]=[];
 const details=(error:unknown)=>error instanceof Error?{message:error.message,cause:error.cause}:error;
 for(const phase of keys){
  try{programs.set(phase,after.entry(phase));}
  catch(error){failures.push({phase,stage:'source',error:details(error)});}
 }
 const turn=programs.get(.432),crest=programs.get(.48),inside=programs.get(.496);
 const solve=(node:PoolPoseProgram,phase:number)=>evaluatePoolPoseProgram(after.bundle,after.neutral.rest,after.neutral.inverse,node,location(phase));
 if(turn){
  const shoulder=solve(turn,.432).world[after.anatomy.handL.upper];
  const rail=fixture.solids.find(solid=>solid.id===fixture.rails[0].id)!;
  expect(shoulder[13]).toBeGreaterThan(rail.bounds[1][1]);
  const original=before.entry(.42);
  for(let index=2;index<4;index++){
   expect(turn.controls[index].state.target).toEqual(original.controls[index].state.target);
   expect(turn.controls[index].state.orientation).toEqual(original.controls[index].state.orientation);
  }
 }
 if(crest){
  const original=before.entry(.48);
  expect(crest.controls.map(c=>c.state.target)).toEqual(original.controls.map(c=>c.state.target));
  expect(crest.controls.map(c=>c.state.orientation)).toEqual(original.controls.map(c=>c.state.orientation));
 }
 if(inside){
  expect(inside.controls.map(c=>c.state.target)).toEqual([
   [-.6345211829161614,.6013554416214633,1.1728613613888355],
   [-.3654786680722466,.8820596619354697,1.1103613613888355],
   [-.670468763448298,.71415177243889,1.6993999884447157],
   [-.32953120674937963,.9919206661923525,1.8685119121901015],
  ]);
  expect(solve(inside,.496).world[after.anatomy.handR.upper].slice(12,15)).toEqual([-.2838732112556881,1.0328894555427783,1.9337417597198179]);
  const known=measureRawPoolPhysicalObservation(after,inside,inside,0,location(.496));
  expect(known.unresolved).toEqual(expect.arrayContaining([expect.objectContaining({
   part:'Creator upper arm skin R',bodyTriangle:27553,surface:'Pool ladder rail 2',
  })]));
 }
 const inspect=(phase:number,left:PoolPoseProgram,right:PoolPoseProgram,amount:number)=>{
  try{
   const result=measureRawPoolPhysicalObservation(after,left,right,amount,location(phase));
   if(!result.passed)failures.push({phase,stage:'physical',unresolved:result.unresolved,
    supports:result.supports.map(({limb,required,satisfied,surface,minimumGap,reasons})=>({limb,required,satisfied,surface,minimumGap,reasons}))});
  }catch(error){failures.push({phase,stage:'physical',error:details(error)});}
 };
 for(const [phase,node] of programs)if(phase<=.48)inspect(phase,node,node,0);
 for(let index=1;index<keys.length;index++){
  const low=keys[index-1],high=keys[index],left=programs.get(low),right=programs.get(high);
  if(left&&right)for(const amount of [.25,.5,.75])inspect(low+(high-low)*amount,left,right,amount);
 }
 expect(failures).toEqual([]);
},90_000);

it('clears the supported crest transfer and joins the unchanged first descent pose',()=>{
 const {before,after,fixture}=sources();
 const location=(phase:number)=>({action:'pool_enter',phase});
 const reject=(phase:number)=>{
  const program=before.entry(phase),result=measureRawPoolPhysicalObservation(before,program,program,0,location(phase));
  expect(result.passed).toBe(false);return result.unresolved;
 };
 expect(reject(.3625)).toEqual(expect.arrayContaining([expect.objectContaining({part:'Creator bare leg L',bodyTriangle:12262,surface:'Pool ladder crest landing'})]));
 expect(()=>before.entry(.459)).toThrow('Pool authored source exceeds actual footL reach at 0.459');
 expect(reject(.48)).toEqual(expect.arrayContaining([expect.objectContaining({part:'Creator bare torso',bodyVertex:12672,surface:'Pool ladder rail 1'})]));
 expect(reject(.496)).toEqual(expect.arrayContaining([expect.objectContaining({part:'Creator pool trunks L',bodyVertex:248,surface:'Pool ladder rail 1'})]));
 const keys=poolSourceEvents(fixture,'pool_enter').filter(phase=>phase>=.22001&&phase<=.56);
 const programs=new Map<number,PoolPoseProgram>(),failures:unknown[]=[];
 const details=(error:unknown)=>error instanceof Error?{message:error.message,cause:error.cause}:error;
 for(const phase of keys){
  try{programs.set(phase,after.entry(phase));}
  catch(error){failures.push({phase,stage:'source',error:details(error)});}
 }
 for(const phase of [.22001,.56]){
  const actual=programs.get(phase);
  if(!actual)continue;
  const expected=before.entry(phase);
  expect(actual.preferenceBasis).toEqual(expected.preferenceBasis);
  expect(actual.policy).toEqual(expected.policy);
  actual.controls.forEach(({state},index)=>{
   const prior=expected.controls[index].state;
   expect(state.target).toEqual(prior.target);
   expect(state.pole).toEqual(prior.pole);
   expect(state.orientation).toEqual(prior.orientation);
   expect(state.attached?.parameter).toBe(prior.attached?.parameter);
  });
 }
 const crest=programs.get(.48),split=programs.get(.496);
 if(crest&&split){
  expect(split.policy.handR).toMatchObject({required:true,region:{kind:'rail',parameter:[1,5]}});
  expect(split.controls[3].state.target).toEqual(crest.controls[3].state.target);
  expect(split.controls[3].state.attached?.parameter).toBe(crest.controls[3].state.attached?.parameter);
  expect(split.controls[2].state.attached!.parameter).toBeLessThan(split.controls[3].state.attached!.parameter);
 }
 const inspect=(phase:number,left:PoolPoseProgram,right:PoolPoseProgram,amount:number)=>{
  try{
   const result=measureRawPoolPhysicalObservation(after,left,right,amount,location(phase));
   if(!result.passed)failures.push({phase,stage:'physical',unresolved:result.unresolved,
    supports:result.supports.map(({limb,required,satisfied,surface,minimumGap,reasons})=>({limb,required,satisfied,surface,minimumGap,reasons}))});
  }catch(error){failures.push({phase,stage:'physical',error:details(error)});}
 };
 for(const [phase,program] of programs)inspect(phase,program,program,0);
 for(let i=1;i<keys.length;i++){
  const low=keys[i-1],high=keys[i],left=programs.get(low),right=programs.get(high);
  if(left&&right)for(const amount of [.25,.5,.75])inspect(low+(high-low)*amount,left,right,amount);
 }
 expect(failures).toEqual([]);
},120_000);
