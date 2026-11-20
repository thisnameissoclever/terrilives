import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {defaultAppearance,validateAppearance} from '../src/character/schema.js';
import {PoolCycleSource,validatePoolCycleDefinition} from '../src/render/character/pool-cycle-source.js';
import {interpolatePoolPoseProgram} from '../src/render/character/pool-contact-sample.js';
import {parseOwnedPoolFixture} from '../src/render/character/pool-owned-fixture.js';
import {measureRawPoolPhysicalObservation} from '../src/render/character/pool-owned-compilation.js';
import type {PoolPoseProgram} from '../src/render/character/pool-pose-program.js';
import {POOL_LIMBS,poolSourceEvents,poolSourcePolicy} from '../src/render/character/pool-source-policy.js';
import {PreparedBody} from '../src/render/character/prepared-body.js';
import {anatomicalHeight} from '../src/render/character/shape.js';
import {poolBase,poolRig} from './pool-observer-fixture.js';

const directory=new URL('../../assets/models/sims/character-creator/',import.meta.url);
const read=(file:string)=>readFileSync(new URL(file,directory),'utf8');

it('crosses the crest with a real left regrip, direct inside plant and supported descent in both directions',()=>{
 const appearance=validateAppearance({...defaultAppearance('masculine'),body:{height:0,build:100,shoulders:100,hips:100,torso:100}});
 const shape={presentation:appearance.presentation,...appearance.body,face:appearance.face};
 const selection=new PreparedBody(poolBase,appearance).select(poolRig,appearance,{wear:'bare',prop:'none',fixture:'none',
  eyes_closed:false,includeFixture:false,clip:'pool_enter',swimwear:'trunks'});
 if(!selection.extra)throw new Error('Pool transfer needs the selected swimwear.');
 const source=(version:number,fixtureRevision:number)=>{
  const definition:unknown=JSON.parse(read('pool_activity_motion_v'+version+'.json'));
  validatePoolCycleDefinition(definition);
  return new PoolCycleSource(poolRig.manifest,shape,anatomicalHeight(poolBase.vertices),[selection.body,selection.extra!],
   parseOwnedPoolFixture(read('clips/pool/contacts-v'+fixtureRevision+'.json')),definition);
 };
 const current=source(16,5),prior=source(15,4);
 const keys=poolSourceEvents(current.fixture,'pool_enter').filter(phase=>phase>=.41999&&phase<=.656);
 const programs=new Map<number,PoolPoseProgram>(),failures:unknown[]=[];
 const errorText=(error:unknown)=>error instanceof Error?error.message:String(error);
 for(const phase of keys){
  try{programs.set(phase,current.entry(phase));}
  catch(error){failures.push({phase,stage:'construction',error:errorText(error)});}
 }
 for(const [phase,oldPhase] of [[.42,.42],[.532,.56]]){
  const currentNode=programs.get(phase);
  if(currentNode){
   const old=prior.entry(oldPhase);
   expect.soft(currentNode.preferenceBasis).toEqual(old.preferenceBasis);
   for(let i=0;i<4;i++){
    const state=currentNode.controls[i].state,other=old.controls[i].state;
    expect.soft(state.target).toEqual(other.target);
    expect.soft(state.orientation).toEqual(other.orientation);
    expect.soft(state.pole).toEqual(other.pole);
   }
  }
 }
 const reverseMode={support:'support',free:'free',approach:'release',release:'approach'} as const;
 let measured=0;
 const observe=(phase:number,left:PoolPoseProgram,right:PoolPoseProgram,amount:number)=>{
  const location={action:'pool_enter',phase},reversePhase=1-.9*phase;
  try{
   const physical=measureRawPoolPhysicalObservation(current,left,right,amount,location);
   measured++;
   if(!physical.passed)failures.push({phase,stage:'physical',witnesses:physical.unresolved.map(w=>({
    part:w.part,solid:w.surface,clearance:w.signedClearance,
   })),supports:physical.supports.filter(s=>!s.satisfied).map(s=>({limb:s.limb,reasons:s.reasons}))});
   const forward=poolSourcePolicy(current.fixture,location.action,phase);
   const solve=(action:string,p:number)=>interpolatePoolPoseProgram(current.bundle,current.neutral.rest,current.neutral.inverse,
    left,right,amount,{action,phase:p}).world;
   const expected=solve(location.action,phase);
   for(let origin=0;origin<12;origin++){
    const action='pool_exit_'+origin,policy=poolSourcePolicy(current.fixture,action,reversePhase);
    for(const limb of POOL_LIMBS)expect(policy[limb]).toEqual({...forward[limb],mode:reverseMode[forward[limb].mode]});
    expect(solve(action,reversePhase)).toEqual(expected);
   }
  }catch(error){failures.push({phase,stage:'observation',error:errorText(error)});}
 };
 for(const [phase,node] of programs)observe(phase,node,node,0);
 for(let i=1;i<keys.length;i++){
  const low=keys[i-1],high=keys[i],left=programs.get(low),right=programs.get(high);
  if(left&&right)for(const amount of [.25,.5,.75])observe(low+(high-low)*amount,left,right,amount);
 }
 console.info(JSON.stringify({keys:keys.length,constructed:programs.size,measured,failures}));
 expect(failures).toEqual([]);
},140_000);
