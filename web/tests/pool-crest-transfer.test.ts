import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {expectHistoricalPoolRejection,historicalCrestPair} from './pool-historical-rejection.js';
import {PoolShapeRouteSampler,type SplitPoolRoute} from '../src/render/character/pool-shape-route.js';
import {poolContactRelease} from '../src/render/character/pool-contact-release.js';
import {expect,it} from 'vitest';
import {defaultAppearance,validateAppearance} from '../src/character/schema.js';
import {PoolCycleSource,validatePoolCycleDefinition} from '../src/render/character/pool-cycle-source.js';
import {bindPoolContacts,interpolatePoolPoseProgram,requirePoolPose} from '../src/render/character/pool-contact-sample.js';
import type {PoolPoseLayout} from '../src/render/character/pool-world-layout.js';
import {createPoolContactInput} from '../src/render/character/pool-contact-preparation.js';
import {poolPartKey,poolShapeIdentity} from '../src/render/character/pool-contact-identity.js';
import type {PoolShapePlayback} from '../src/render/character/pool-contact-types.js';
import {parseOwnedPoolFixture} from '../src/render/character/pool-owned-fixture.js';
import {measureRawPoolPhysicalObservation} from '../src/render/character/pool-owned-compilation.js';
import type {PoolPoseProgram} from '../src/render/character/pool-pose-program.js';
import {POOL_LIMBS,poolSourceEvents,poolSourcePolicy} from '../src/render/character/pool-source-policy.js';
import {PreparedBody} from '../src/render/character/prepared-body.js';
import {anatomicalHeight} from '../src/render/character/shape.js';
import {poolBase,poolRig} from './pool-observer-fixture.js';

const directory=new URL('../../assets/models/sims/character-creator/',import.meta.url);
const read=(file:string)=>readFileSync(new URL(file,directory),'utf8');

function shortBroadBody() {
 const appearance=validateAppearance({...defaultAppearance('masculine'),body:{height:0,build:100,shoulders:100,hips:100,torso:100}});
 const shape={presentation:appearance.presentation,...appearance.body,face:appearance.face};
 const selection=new PreparedBody(poolBase,appearance).select(poolRig,appearance,{wear:'bare',prop:'none',fixture:'none',
  eyes_closed:false,includeFixture:false,clip:'pool_enter',swimwear:'trunks'});
 if(!selection.extra)throw new Error('Pool transfer needs the selected swimwear.');
 return {appearance,shape,geometry:[selection.body,selection.extra]};
}

it('reproduces the rejected V16 transfer and preserves its admitted poses in both directions',()=>{
 const {shape,geometry}=shortBroadBody();
 const source=(version:15|16)=>{
  const {definition,fixture}=historicalCrestPair(version);
  return new PoolCycleSource(poolRig.manifest,shape,anatomicalHeight(poolBase.vertices),geometry,fixture,definition);
 };
 const current=source(16),prior=source(15);
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
 // The November 20 run of motion cf92ebaf and contacts 1094e672 rejected
 // nine unreachable poses (starting with the left hand at .436) and thirteen physical samples.
 expect([keys.length,programs.size,measured]).toEqual([19,10,31]);
 expectHistoricalPoolRejection(failures,22,'c320832f9b5f60f83c8ca120237b70905f4bc572f305297092680fe59c45c9a1');
},140_000);


it('clears the installed short, broad swimmer at the crest and renders the fractional exit frames',async()=>{
 const {appearance,shape,geometry}=shortBroadBody(),definition=poolContactRelease.motion;
 validatePoolCycleDefinition(definition);
 const source=new PoolCycleSource(poolRig.manifest,shape,anatomicalHeight(poolBase.vertices),geometry,
  parseOwnedPoolFixture(poolContactRelease.fixtureText),definition);
 const family=poolContactRelease.family!;
 const release=read('clips/pool/'+family.url.split('/').at(-1));
 expect(createHash('sha256').update(release).digest('hex')).toBe(family.sha256);
 const sampler=new PoolShapeRouteSampler(source,JSON.parse(release) as SplitPoolRoute);
 const crest=sampler.samplePrograms({action:'pool_enter',phase:.42}).left;
 expect(crest.policy).toMatchObject({
  footL:{required:true,surface:'Pool outside ladder tread 3'},footR:{required:true,surface:'Pool ladder crest landing'},
  handL:{required:true,surface:'Pool ladder rail 1'},handR:{required:true,surface:'Pool ladder rail 2'},
 });
 for(const phase of [.34,.42,.60]){
  const location={action:'pool_enter',phase},sample=sampler.samplePrograms(location);
  const result=measureRawPoolPhysicalObservation(source,sample.left,sample.right,sample.amount,location);
  const collisions=result.unresolved.map(({part,surface,signedClearance})=>({part,surface,signedClearance}));
  const missing=result.supports.filter(s=>s.required&&!s.satisfied).map(({limb,surface,reasons})=>({limb,surface,reasons}));
  expect.soft({passed:result.passed,collisions,missing},'Physical observation at '+phase)
   .toEqual({passed:true,collisions:[],missing:[]});
 }

 // The browser stopped between authored arm poses at elapsed ticks 28 and 35 of the 40-tick exit.
 const input=await createPoolContactInput(appearance);
 const playback:PoolShapePlayback={
  kind:'configured-shape',version:1,family:family.sha256,solverRevision:input.solverRevision,key:input.key,
  appearanceKey:input.appearanceKey,revisions:input.revisions,source:source.bundle.sourceSha256,
  shapeKey:poolShapeIdentity(shape,source.top),partKeys:geometry.map(poolPartKey),top:source.top,
  waterHeight:source.fixture.waterHeight,graph:sampler.configuredGraph(),
 };
 bindPoolContacts(playback,geometry[0],shape,source.top,geometry.slice(1),source.fixture);
 const action='pool_exit_0',lastFrame=source.bundle.actions[action].length-1;
 for(const tick of [28,28.125,35,35.125]){
  const phase=tick/40;
  const sample=sampler.samplePrograms({action,phase});
  expect(sample.amount).toBeGreaterThan(0);
  expect(sample.amount).toBeLessThan(1);
  const matrices=requirePoolPose(playback,geometry[0],shape,source.top,action,phase*lastFrame);
  expect(matrices).toHaveLength(source.bundle.bones.length*16);
  expect(matrices.every(Number.isFinite),'Exit matrices at elapsed tick '+tick).toBe(true);
 }
 const sample=(clip:string,phase:number,layout?:PoolPoseLayout)=>requirePoolPose(
  playback,geometry[0],shape,source.top,clip,phase*(source.bundle.actions[clip].length-(clip==='pool_paddle'?0:1)),false,layout,
 );
 const arm=source.bundle.bones.findIndex(bone=>bone.name==='hand.L')*16;
 const foot=source.bundle.bones.findIndex(bone=>bone.name==='foot.L')*16;
 for(const [clip,phase] of [['pool_enter',.34],['pool_exit_0',.79]] as const){
  const held=sample(clip,phase),free=sample(clip,phase,'lodge');
  expect(free.slice(arm,arm+16)).not.toEqual(held.slice(arm,arm+16));
  expect(free.slice(foot,foot+16)).toEqual(held.slice(foot,foot+16));
  expect(free.every(Number.isFinite)).toBe(true);
 }
 for(const [clip,phase] of [['pool_enter',0],['pool_enter',1],['pool_paddle',.25],['pool_exit_0',1]] as const){
  expect(sample(clip,phase,'lodge')).toEqual(sample(clip,phase));
 }
 const inGround=(clip:string,phase:number)=>sample(clip,phase,'in-ground');
 expect(inGround('pool_enter',1)).toEqual(inGround('pool_paddle',0));
 expect(inGround('pool_exit_0',1)).toEqual(inGround('pool_enter',0));
 for(const origin of [0,3,8,11]){
  expect(inGround('pool_exit_'+origin,0)).toEqual(inGround('pool_paddle',origin/12));
 }
 for(const [clip,phase] of [['pool_enter',.32],['pool_enter',.6],['pool_exit_0',.4],['pool_exit_0',.5],['pool_exit_0',.76],['pool_exit_0',.89]] as const){
  expect(inGround(clip,phase).every(Number.isFinite)).toBe(true);
 }
},120_000);
