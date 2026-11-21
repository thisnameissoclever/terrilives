import * as railFrames from '../src/render/character/pool-rail-contact-frame.js';
import {resolvePoolRailContactFrame} from '../src/render/character/pool-rail-contact-frame.js';
import {expect,it,vi} from 'vitest';
import motion from '../../assets/models/sims/character-creator/pool_activity_motion_v16.json';
import contacts from '../../assets/models/sims/character-creator/clips/pool/contacts-v5.json?raw';
import {defaultAppearance,validateAppearance} from '../src/character/schema.js';
import {PoolCycleSource,validatePoolCycleDefinition} from '../src/render/character/pool-cycle-source.js';
import {verifyOwnedPoolNumericSlice,type PoolNumericTrialEvent} from '../src/render/character/pool-owned-compilation.js';
import {parseOwnedPoolFixture} from '../src/render/character/pool-owned-fixture.js';
import {PreparedBody} from '../src/render/character/prepared-body.js';
import {anatomicalHeight} from '../src/render/character/shape.js';
import {createPoolContactInput} from '../src/render/character/pool-contact-preparation.js';
import {makePoolContactInput,POOL_ACTIONS} from '../src/render/character/pool-contact-protocol.js';
import {sleepContactDigest} from '../src/render/character/sleep-contact-protocol.js';
import {poolReplaySchedule} from '../src/render/character/pool-replay-schedule.js';
import {PoolTrialRefusal,PoolTrialStopped,PoolTrialWork} from '../src/render/character/pool-trial-work.js';
import * as recipes from '../src/render/character/pool-numeric-recipe.js';
import type {NumericBody,NumericStageRequest} from '../src/render/character/pool-numeric-recipe.js';
import {parseNumericStages} from '../src/render/character/pool-numeric-stages.js';
import {requirePoolFootClearanceReference} from '../src/render/character/pool-foot-contact-frame.js';
import {poolSourceRecord} from '../src/render/character/pool-source-policy.js';
import {poolIntervalPreference} from '../src/render/character/pool-contact-sample.js';
import * as meshPlanning from '../src/render/character/pool-mesh-planning.js';
import {poolBase,poolLibrary,poolRig} from './pool-observer-fixture.js';
import type {OpeningFlightRequest,ExteriorChainRequest} from '../src/render/character/pool-opening-flight.js';

const limits={captures:12,expansions:8192,observations:60,reverseComparisons:0,milliseconds:100_000};
const body=(y:number,z:number,trunkPitch=30):NumericBody=>({hips:[-.5,y,z],hipPitch:0,trunkPitch,headPitch:10});
const original=body(1.5,.9414365344809708),first=body(1.6218885433565438,.899030752728482),second=body(1.5483138922844537,.9712456257904025);
const stages=():NumericStageRequest[]=>[
 {unit:5000,role:'acquisition',places:{footL:'ground',footR:'ground'},choices:[{label:'ground'}]},
 {unit:12000,role:'first-rung',places:{footL:'outside1',footR:'ground'},choices:[{label:'nominal',body:original},{label:'clear shin',body:first}]},
 {unit:22000,role:'second-rung',places:{footL:'outside1',footR:'outside2'},choices:[{label:'second rung',body:second,parameters:{handL:4.270833333333333,handR:4.270833333333333}}]},
];
async function setup(presentation:'feminine'|'masculine'='feminine',fixtureText=contacts){
 const base=defaultAppearance(presentation),b=presentation==='feminine'?100:0;
 const appearance=validateAppearance({...base,body:{height:b,build:100,hips:100,shoulders:100,torso:100}});
 const definition:unknown=structuredClone(motion);validatePoolCycleDefinition(definition);
 if(definition.version!==16)throw new Error('Expected v16.');
 const fixture=parseOwnedPoolFixture(fixtureText);
 const selected=new PreparedBody(poolBase,appearance).select(poolRig,appearance,{wear:'bare',fixture:'none',prop:'none',clip:'pool_enter',includeFixture:false,eyes_closed:false,swimwear:presentation==='feminine'?'two_piece':'trunks'});
 const sources={bundle:poolRig.manifest,shape:{presentation,...appearance.body,face:appearance.face},top:anatomicalHeight(poolBase.vertices),geometry:[selected.body,selected.extra!],fixture};
 const initial=await createPoolContactInput(appearance),{key:_,...inputData}=initial;
 const revisions={...inputData.revisions,fixture:await sleepContactDigest(fixture),
  clips:await sleepContactDigest({definition,sources:poolLibrary.sources,clips:POOL_ACTIONS.map(a=>poolLibrary.clips[a as keyof typeof poolLibrary.clips])})};
 const input=await makePoolContactInput({...inputData,revisions});
 const schedule=poolReplaySchedule(fixture,definition);
 const knot=(p:number)=>schedule.jobs.find(j=>j.kind==='node'&&j.action==='pool_enter'&&j.phase===p)!;
 const request={stages:stages(),operationIds:[knot(.12).id]};
 const source=()=>new PoolCycleSource(sources.bundle,sources.shape,sources.top,sources.geometry,fixture,definition);
 return {input,sources,definition,request,schedule,knot,source};
}

const opening:OpeningFlightRequest={kind:'first-exterior-step',limb:'footL',from:'ground',to:'outside1',startUnit:5000,endUnit:12000};
const corrected=()=>stages().map(s=>s.role==='first-rung'?{...s,choices:[s.choices[1]]}:s);
const range=[5000,12000] as const;

it('authenticates the whole opt-in transfer and its phase records before mesh planning',async()=>{
 const x=await setup(),mesh=vi.spyOn(meshPlanning,'prepareOwnedPoolMeshPlan');
 try{
  for(const wrong of [{...opening,limb:'footR'},{...opening,from:'outside1'},{...opening,to:'outside2'},
   {...opening,startUnit:5001},{...opening,endUnit:11999},{...opening,unknown:true},{...opening,additionalUnits:[12000]}]){
   expect(()=>verifyOwnedPoolNumericSlice(x.input,x.sources,x.definition,{stages:stages(),entryRange:range,opening:wrong as OpeningFlightRequest},limits)).toThrow();
  }
  expect(mesh).not.toHaveBeenCalled();
  const fixture=structuredClone(x.sources.fixture),interior=fixture.clips.pool_enter.intervals.find(i=>i.start===.064&&i.end===.0955)!;
  interior.limbs.footL=structuredClone(fixture.clips.pool_enter.samples.find(k=>k.phase===.12)!.limbs.footL);
  expect(()=>parseNumericStages(stages(),x.definition,fixture,new PoolTrialWork(limits),opening)).toThrow('actual opening support');
  expect(()=>verifyOwnedPoolNumericSlice(x.input,x.sources,x.definition,{stages:stages(),entryRange:range},limits)).toThrow('lacks a declared incident knot');
 }finally{mesh.mockRestore();}
});

it('anchors relative choices before adding cuts and samples the foot and selected body at the declared completion time',async()=>{
 const x=await setup(),src=x.source();
 const produce=(selected:NumericStageRequest[],mode:OpeningFlightRequest)=>{
  const work=new PoolTrialWork(limits),input=src.captureNumericExterior(selected,work,mode);
  return [...recipes.numericalPoolRecipes(input,work)].flatMap(p=>p.kind==='recipe'?[p.recipe]:[]);
 };
 const both=produce(stages(),opening);
 expect(both).toHaveLength(2);
 expect(both[1].knots.map(k=>k.unit)).toEqual([5000,6400,9550,10950,12000,22000]);
 const one=both[0].knots.find(k=>k.unit===6400)!,two=both[1].knots.find(k=>k.unit===6400)!;
 expect(two.body.hips).not.toEqual(one.body.hips);
 const t=1400/4550,e=t*t*(3-2*t);
 for(let axis=0;axis<3;axis++)expect(two.body.hips[axis]).toBeCloseTo(original.hips[axis]+(first.hips[axis]-original.hips[axis])*e,12);
 const finished=both[1].knots.find(k=>k.unit===9550)!;
 expect(finished.body).toEqual(first);
 const ground=src.foot('footL','ground'),tread=src.foot('footL','outside1');
 expect(two.feet.footL.target).toEqual([ground.target[0],ground.target[1],ground.target[2]+ground.lift]);
 expect(finished.feet.footL.target[0]).toBe(tread.target[0]);
 expect(finished.feet.footL.target[2]).toBe(tread.target[2]+tread.lift);
 const relative=corrected();
 relative[2]={...relative[2],choices:[{...relative[2].choices[0],relativeToPrevious:true,
  body:{...second,hips:[second.hips[0]-first.hips[0],second.hips[1]-first.hips[1],second.hips[2]-first.hips[2]]}}]};
 const extra=produce(relative,{...opening,additionalUnits:[8000]})[0];
 expect(extra.knots.find(k=>k.unit===22000)!.body).toEqual(second);
 expect(extra.knots.find(k=>k.unit===8000)).toBeDefined();
 expect(extra.secondRung).toEqual(both[1].secondRung);
 const relativeOnly=produce(relative,opening)[0];
 const cutOnly=produce(corrected(),{...opening,additionalUnits:[8000]})[0];
 expect(relativeOnly.secondRung).toEqual(both[1].secondRung);
 expect(cutOnly.secondRung).toEqual(both[1].secondRung);
 for(const k of extra.knots.filter(k=>k.unit<=12000)){
  expect(k.hands).toEqual(extra.acquisition);
  expect(k.feet.footR).toEqual(extra.knots[0].feet.footR);
 }
});

it('physically admits the complete first step and independently matches an actual interior body and both ankles',async()=>{
 const x=await setup(),events:PoolNumericTrialEvent[]=[];
 const result=verifyOwnedPoolNumericSlice(x.input,x.sources,x.definition,{stages:corrected(),entryRange:range,opening},limits,{event:e=>events.push(e)});
 if(result.kind!=='admitted-slice')throw new Error(JSON.stringify(result));
 expect(result.published).toBe(false);expect(result.completed).toHaveLength(25);expect(result.openingSamples).toHaveLength(25);
 const a=result.recipe.knots.find(k=>k.unit===6400)!,b=result.recipe.knots.find(k=>k.unit===9550)!;
 const mid=result.openingSamples!.find(s=>s.phase===.064+(.0955-.064)*.5)!;
 const t=(.064-.05)/(.0955-.05),weight=.5*(1+t*t*(3-2*t));
 for(let i=0;i<3;i++){
  expect(mid.hips[i]).toBeCloseTo(original.hips[i]+(first.hips[i]-original.hips[i])*weight,9);
  expect(mid.leftAnkle[i]).toBeCloseTo((a.feet.footL.target[i]+b.feet.footL.target[i])/2,9);
  expect(mid.rightAnkle[i]).toBeCloseTo(a.feet.footR.target[i],9);
  expect(mid.leftWrist[i]).toBeCloseTo(result.recipe.acquisition.handL.heldTarget![i],9);
  expect(mid.rightWrist[i]).toBeCloseTo(result.recipe.acquisition.handR.heldTarget![i],9);
 }
 const right=result.maintained.filter(h=>h.limb==='footR');expect(right).toHaveLength(25);
 expect(right.every(h=>h.branch===right[0].branch)).toBe(true);
 expect(events.filter(e=>e.kind==='observed')).toHaveLength(25);
},100_000);

it('rejects an actual colliding interval and replays the selected endpoint alternative in a new owner',async()=>{
 const x=await setup(),jobs=x.schedule.jobs.filter(j=>j.action==='pool_enter'&&j.kind==='interval'&&j.left==='entry/10950'&&j.right==='entry/12000'&&j.fraction>0&&j.fraction<1);
 const events:PoolNumericTrialEvent[]=[];
 const result=verifyOwnedPoolNumericSlice(x.input,x.sources,x.definition,{stages:stages(),opening,operationIds:jobs.map(j=>j.id)},limits,{event:e=>events.push(e)});
 if(result.kind!=='admitted-slice')throw new Error(JSON.stringify(result));
 const firstDenial=result.rejected.find(r=>r.attempt===1);
 expect(firstDenial?.reason).toContain('Physical refusal');
 const failure=firstDenial?.cause as {phase:number;witnesses:{part:string;surface:string;signedClearance:number}[]};
 expect(failure.phase).toBeGreaterThan(.1095);expect(failure.phase).toBeLessThan(.12);
 expect(failure.witnesses.some(w=>w.part==='Creator bare leg L'&&w.signedClearance<0)).toBe(true);
 expect(result.completed).toHaveLength(3);
 expect(events.findIndex(e=>e.kind==='disposed'&&e.attempt===1)).toBeLessThan(events.findIndex(e=>e.kind==='captured'&&e.attempt===2));
},100_000);

it.each(['approach','reach'] as const)('keeps a real negative %s trial local and admits the original complete recipe afterward',async(kind)=>{
 const x=await setup(),lower=x.source(),raw=recipes.expandSelectedPoolRecipes;
 const at=kind==='approach'?[10950,12000]:[6400,9550],job=x.schedule.jobs.find(j=>j.action==='pool_enter'&&j.kind==='interval'&&j.left==='entry/'+at[0]&&j.right==='entry/'+at[1]&&j.fraction===.5)!;
 const spy=vi.spyOn(recipes,'expandSelectedPoolRecipes').mockImplementation(function*(...args){
  for(const option of raw(...args)){
   if(option.kind==='recipe'){
    // Fault control changes only the finite proposed ankle goal. Both owners retain the real fixture and arithmetic.
    const negative=structuredClone(option.recipe),a=negative.knots.find(k=>k.unit===at[0])!,b=negative.knots.find(k=>k.unit===at[1])!;
    if(kind==='approach'){
     const target=a.feet.footL.target;
     a.feet.footL={...a.feet.footL,target:[target[0],target[1],b.feet.footL.target[2]-.01]};
    }else{
     const left=lower.materializeNumericKnot(a),right=lower.materializeNumericKnot(b);
     const posed=poolIntervalPreference(lower.bundle,lower.neutral.rest,lower.neutral.inverse,left.preferenceBasis,right.preferenceBasis,.5,true);
     const h=posed.world[lower.anatomy.footL.upper];
     a.feet.footL={...a.feet.footL,target:[h[12]-.2,h[13],h[14]]};
     b.feet.footL={...b.feet.footL,target:[h[12]+.2,h[13],h[14]]};
    }
    yield {kind:'recipe',recipe:negative};
   }
   yield option;
  }
 });
 try{
  const events:PoolNumericTrialEvent[]=[];
  const result=verifyOwnedPoolNumericSlice(x.input,x.sources,x.definition,{stages:corrected(),opening,operationIds:[job.id]},limits,{event:e=>events.push(e)});
  if(result.kind!=='admitted-slice')throw new Error(JSON.stringify(result));
  expect(result.rejected[0].reason).toContain(kind==='approach'?'below its exact nominal reference plane':'outside configured reach: footL');
  expect(result.completed).toEqual([job.id]);
  expect(events.findIndex(e=>e.kind==='disposed'&&e.attempt===1)).toBeLessThan(events.findIndex(e=>e.kind==='captured'&&e.attempt===2));
 }finally{spy.mockRestore();}
},100_000);

it('keeps malformed approach-frame coordinates fatal and cannot waive negative clearance with a returning error factory',async()=>{
 const x=await setup(),src=x.source(),g=src.foot('footL','outside1');
 const support=poolSourceRecord(x.sources.fixture,{action:'pool_enter',phase:.1095}).limbs.footL;
 const frame=src.frame('footL',support,[g.target[0],g.target[1]]),inverse=src.neutral.inverse[src.anatomy.footL.end];
 const below=[g.target[0],g.target[1],g.target[2]-.01],wrong=[g.target[0]+.02,g.target[1],g.target[2]-.01];
 const wrap=vi.fn((e:Error)=>new PoolTrialRefusal(e.message,{cause:e}));
 expect(()=>requirePoolFootClearanceReference(frame,wrong,frame.orientation,inverse,src.bundle,wrap)).toThrow('reference plane coordinates');
 expect(wrap).not.toHaveBeenCalled();
 expect(()=>requirePoolFootClearanceReference(frame,below,frame.orientation,inverse,src.bundle,wrap)).toThrow(PoolTrialRefusal);
 expect(wrap).toHaveBeenCalledTimes(1);
 expect(()=>requirePoolFootClearanceReference(frame,below,frame.orientation,inverse,src.bundle,()=>undefined as unknown as Error)).toThrow('below its exact nominal reference plane');
});

it('propagates an unowned approach frame and does not try another viable candidate',async()=>{
 const x=await setup(),base=corrected(),secondChoice=base[2].choices[0];
 base[2]={...base[2],choices:[secondChoice,{...secondChoice,label:'another valid destination',parameters:{handL:4.28,handR:4.28}}]};
 const job=x.schedule.jobs.find(j=>j.action==='pool_enter'&&j.kind==='interval'&&j.left==='entry/10950'&&j.right==='entry/12000'&&j.fraction===.5)!;
 const real=PoolCycleSource.prototype.frame,events:PoolNumericTrialEvent[]=[];
 const spy=vi.spyOn(PoolCycleSource.prototype,'frame').mockImplementation(function(this:PoolCycleSource,...args){
  const actual=real.call(this,...args);
  return args[0]==='footL'&&args[1].mode==='approach'?{...actual}:actual;
 });
 try{
  let error:unknown;
  try{verifyOwnedPoolNumericSlice(x.input,x.sources,x.definition,{stages:base,opening,operationIds:[job.id]},limits,{event:e=>events.push(e)});}
  catch(e){error=e;}
  expect(error).toBeInstanceOf(Error);expect(error).not.toBeInstanceOf(PoolTrialRefusal);
  expect((error as Error).message).toMatch(/certificate|construction|frame/i);
  expect(events.filter(e=>e.kind==='proposed')).toHaveLength(1);
 }finally{spy.mockRestore();}
},100_000);


it('rejects missing or relabeled declared approach records before planning',async()=>{
 const x=await setup(),mesh=vi.spyOn(meshPlanning,'prepareOwnedPoolMeshPlan');
 try{
  for(const mutation of ['delete','relabel'] as const){
   const fixture=structuredClone(x.sources.fixture),clip=fixture.clips.pool_enter;
   const approach=clip.samples.find(k=>k.phase===.1095)!,right=clip.intervals.find(i=>i.start===.1095)!;
   const free=clip.samples.find(k=>k.phase===.0955)!.limbs.footL;
   if(mutation==='relabel'){
    approach.limbs.footL=structuredClone(free);right.limbs.footL=structuredClone(free);
   }else{
    clip.samples.splice(clip.samples.indexOf(approach),1);
    const left=clip.intervals.find(i=>i.end===.1095)!;
    left.end=right.end;clip.intervals.splice(clip.intervals.indexOf(right),1);
   }
   expect(()=>parseNumericStages(corrected(),x.definition,fixture,new PoolTrialWork(limits),opening)).toThrow(/opening support/i);
   expect(()=>verifyOwnedPoolNumericSlice(x.input,{...x.sources,fixture},x.definition,{stages:corrected(),entryRange:range,opening},limits)).toThrow();
   expect(mesh).not.toHaveBeenCalled();
  }
 }finally{mesh.mockRestore();}
});

it.each(['place','target','orientation','distance'] as const)('keeps a forged detached %s fatal before another recipe starts',async(kind)=>{
 const x=await setup(),raw=recipes.expandSelectedPoolRecipes,events:PoolNumericTrialEvent[]=[];
 const spy=vi.spyOn(recipes,'expandSelectedPoolRecipes').mockImplementation(function*(...args){
  for(const option of raw(...args)){
   if(option.kind==='recipe'){
    const altered=structuredClone(option.recipe);
    const foot=altered.knots.find(k=>k.unit===(kind==='distance'?6400:12000))!.feet.footL;
    if(kind==='place'&&!('flight' in foot))foot.place='outside2';
    if(kind==='target')foot.target=[foot.target[0]+.00001,foot.target[1],foot.target[2]];
    if(kind==='orientation')foot.orientation=foot.orientation.map((v,i)=>i<8?-v:v);
    if(kind==='distance')foot.target=[Number.MAX_VALUE,Number.MAX_VALUE,0];
    yield {kind:'recipe',recipe:altered};
   }
   yield option;
  }
 });
 try{
  let caught:unknown;
  try{verifyOwnedPoolNumericSlice(x.input,x.sources,x.definition,{stages:corrected(),opening,operationIds:[x.knot(.12).id]},limits,{event:e=>events.push(e)});}
  catch(e){caught=e;}
  expect(caught).toBeInstanceOf(Error);expect(caught).not.toBeInstanceOf(PoolTrialRefusal);
  expect((caught as Error).message).toContain(kind==='distance'?'Invalid numeric pool limb distance':'independently selected endpoint');
  expect(events.filter(e=>e.kind==='proposed')).toHaveLength(1);
 }finally{spy.mockRestore();}
});

it.each(['refusal','stopped'] as const)('propagates the original injected clock %s from inside a candidate',async(kind)=>{
 const x=await setup(),events:PoolNumericTrialEvent[]=[];
 const failure=kind==='refusal'?new PoolTrialRefusal('clock producer failed'):new PoolTrialStopped('cancelled','clock producer',{});
 let inside=false,caught:unknown;
 try{
  verifyOwnedPoolNumericSlice(x.input,x.sources,x.definition,{stages:stages(),opening,operationIds:[x.knot(.12).id]},limits,{
   event:e=>{events.push(e);if(e.kind==='captured'&&e.attempt===1)inside=true;},
   now:()=>{if(inside){inside=false;throw failure;}return 0;},
  });
 }catch(e){caught=e;}
 expect(caught).toBe(failure);expect(events.filter(e=>e.kind==='proposed')).toHaveLength(1);
});

it('observes independently predicted hips for two selected stances on the same first-step interior',async()=>{
 const x=await setup(),job=x.schedule.jobs.find(j=>j.action==='pool_enter'&&j.kind==='interval'&&
  j.left==='entry/6400'&&j.right==='entry/9550'&&j.fraction===.5)!;
 const observed:number[]=[];
 const t=(.064-.05)/(.0955-.05),weight=(1+t*t*(3-2*t))/2;
 for(const destination of [first,body(first.hips[1]+.0001,first.hips[2])]){
  const selected=corrected();
  selected[1]={...selected[1],choices:[{...selected[1].choices[0],body:destination}]};
  const result=verifyOwnedPoolNumericSlice(x.input,x.sources,x.definition,{stages:selected,opening,operationIds:[job.id]},limits);
  if(result.kind!=='admitted-slice')throw new Error(JSON.stringify(result));
  expect(result.completed).toEqual([job.id]);expect(result.rejected).toHaveLength(0);
  const sample=result.openingSamples![0];expect(sample.job).toBe(job.id);
  for(let i=0;i<3;i++)expect(sample.hips[i]).toBeCloseTo(original.hips[i]+weight*(destination.hips[i]-original.hips[i]),9);
  observed.push(sample.hips[1]);
 }
 expect(observed[1]-observed[0]).toBeCloseTo(.0001*weight,9);
});

it('rejects a narrowed held wrist interval before planning when only the landing node is requested',async()=>{
 const x=await setup(),fixture=structuredClone(x.sources.fixture);
 const interval=fixture.clips.pool_enter.intervals.find(i=>i.start===.064&&i.end===.0955)!;
 const region=interval.limbs.handL.region;
 expect(region).toEqual({kind:'rail',parameter:[1,5]});
 if(region?.kind!=='rail')throw new Error('Expected the held left rail.');
 region.parameter=[1,4];
 const {key:_,...data}=x.input;
 const input=await makePoolContactInput({...data,revisions:{...data.revisions,fixture:await sleepContactDigest(fixture)}});
 const mesh=vi.spyOn(meshPlanning,'prepareOwnedPoolMeshPlan');
 try{
  const request={stages:corrected(),opening,operationIds:[x.knot(.12).id]};
  expect(()=>verifyOwnedPoolNumericSlice(input,{...x.sources,fixture},x.definition,request,limits))
   .toThrow('Opening flight changed the acquired wrist policy: handL');
  expect(mesh).not.toHaveBeenCalled();
 }finally{mesh.mockRestore();}
});

const secondStep:OpeningFlightRequest={kind:'second-exterior-step',limb:'footR',from:'ground',to:'outside2',startUnit:12000,endUnit:22000};
const nextStance=body(1.648900348385652,.8347598238091347);
const destinationParameters={handL:4.442262498792179,handR:4.44226248293319};
function secondStepStages():NumericStageRequest[]{
 const selected=corrected();
 selected[2]={...selected[2],choices:[{label:'selected second tread',body:nextStance,parameters:destinationParameters}]};
 return selected;
}

it('validates the second step against every source obligation before planning a requested landing',async()=>{
 const x=await setup(),mesh=vi.spyOn(meshPlanning,'prepareOwnedPoolMeshPlan');
 try{
  for(const mutation of ['release','free','approach','planted','hand'] as const){
   const fixture=structuredClone(x.sources.fixture),clip=fixture.clips.pool_enter;
   const key=(p:number)=>clip.samples.find(k=>k.phase===p)!.limbs;
   const interval=(p:number)=>clip.intervals.find(i=>i.start===p)!.limbs;
   if(mutation==='release')interval(.12).footR=structuredClone(key(.14).footR);
   if(mutation==='free')interval(.14).footR=structuredClone(key(.12).footR);
   if(mutation==='approach')interval(.21999).footR=structuredClone(key(.14).footR);
   if(mutation==='planted')interval(.185).footL=structuredClone(key(.14).footR);
   if(mutation==='hand')interval(.205).handR.region={kind:'rail',parameter:[1,4]};
   expect(()=>verifyOwnedPoolNumericSlice(x.input,{...x.sources,fixture},x.definition,
    {stages:secondStepStages(),opening:secondStep,operationIds:[x.knot(.22).id]},limits)).toThrow();
   expect(mesh).not.toHaveBeenCalled();
  }
  for(const wrong of [{...secondStep,limb:'footL'},{...secondStep,to:'outside1'},{...secondStep,endUnit:21999}]){
   expect(()=>verifyOwnedPoolNumericSlice(x.input,x.sources,x.definition,
    {stages:secondStepStages(),opening:wrong as OpeningFlightRequest,operationIds:[x.knot(.22).id]},limits)).toThrow();
   expect(mesh).not.toHaveBeenCalled();
  }
 }finally{mesh.mockRestore();}
});

it('keeps the named shared seam and both chosen slide destinations across an inserted second-step cut',async()=>{
 const x=await setup(),src=x.source(),selected=secondStepStages();
 const produce=(mode:OpeningFlightRequest,rows=selected)=>{
  const work=new PoolTrialWork(limits),capture=src.captureNumericExterior(rows,work,mode);
  const recipesFound=[...recipes.numericalPoolRecipes(capture,work)].flatMap(v=>v.kind==='recipe'?[v.recipe]:[]);
  expect(recipesFound).toHaveLength(1);
  return recipesFound[0];
 };
 const previous=produce(opening,corrected()),plain=produce(secondStep);
 const relative=secondStepStages(),choice=relative[2].choices[0],h=nextStance.hips;
 relative[2]={...relative[2],choices:[{...choice,relativeToPrevious:true,body:{...nextStance,hips:[h[0]-first.hips[0],h[1]-first.hips[1],h[2]-first.hips[2]]}}]};
 const extra=produce({...secondStep,additionalUnits:[17500]},relative);
 const knot=(r:typeof plain,u:number)=>r.knots.find(k=>k.unit===u)!;
 expect(knot(plain,12000)).toEqual(knot(previous,12000));
 for(const u of [12000,14000,18500,20500,21999,22000])expect(knot(extra,u)).toEqual(knot(plain,u));
 expect(knot(extra,17500)).toBeDefined();
 expect(knot(plain,18500).hands).toEqual(plain.secondRung);
 expect(knot(plain,18500).body).toEqual(nextStance);
 for(const hand of ['handL','handR'] as const){
  const mid=knot(plain,14000).hands[hand],from=plain.acquisition[hand].grasp,target=plain.secondRung[hand].grasp;
  if(!('grasp' in mid))throw new Error('Missing attached second-step wrist.');
  const t=2/6.5,w=t*t*(3-2*t);
  expect(mid.grasp.parameter).toBeCloseTo(from.parameter+(target.parameter-from.parameter)*w,12);
  expect(target.parameter).toBe(destinationParameters[hand]);expect(target.parameter).not.toBe(from.parameter);
  expect(mid.grasp.activeVertex).toBe(from.activeVertex);expect(mid.grasp.rawOrientation).toEqual(from.rawOrientation);
 }
});

it('physically observes the complete right-foot step and both sliding wrists on the specified rail',async()=>{
 const x=await setup(),result=verifyOwnedPoolNumericSlice(x.input,x.sources,x.definition,
  {stages:secondStepStages(),opening:secondStep,entryRange:[12000,22000]},limits);
 if(result.kind!=='admitted-slice')throw new Error(JSON.stringify(result));
 expect(result.completed).toHaveLength(31);expect(result.rejected).toHaveLength(0);expect(result.published).toBe(false);
 const maintained=result.maintained.filter(r=>r.limb==='footL');
 expect(maintained).toHaveLength(31);expect(maintained.every(r=>r.branch===maintained[0].branch)).toBe(true);
 const job=x.schedule.jobs.find(j=>j.action==='pool_enter'&&j.kind==='interval'&&j.left==='entry/14000'&&j.right==='entry/18500'&&j.fraction===.5)!;
 const mid=result.openingSamples!.find(sample=>sample.job===job.id)!;
 const source=x.source(),fixed=source.foot('footL','outside1'),ground=source.foot('footR','ground'),tread=source.foot('footR','outside2');
 const t=2/6.5,w=(1+t*t*(3-2*t))/2,phase=job.phase;
 for(let i=0;i<3;i++){
  expect(mid.hips[i]).toBeCloseTo(first.hips[i]+(nextStance.hips[i]-first.hips[i])*w,9);
  expect(mid.leftAnkle[i]).toBeCloseTo(fixed.target[i],9);
 }
 expect(mid.rightAnkle[0]).toBeCloseTo((ground.target[0]+tread.target[0])/2,9);
 expect(mid.rightAnkle[2]).toBeCloseTo((ground.target[2]+ground.lift+tread.target[2]+tread.lift)/2,9);
 const start=source.materializeNumericKnot(result.recipe.knots.find(k=>k.unit===12000)!);
 for(const hand of ['handL','handR'] as const){
  const attached=start.controls.find(c=>c.end===source.anatomy[hand].end)!.state.attached!;
  const parameter=attached.parameter+(destinationParameters[hand]-attached.parameter)*w;
  const reference=resolvePoolRailContactFrame(attached.geometry,attached.rawOrientation,parameter,undefined,{action:'pool_enter',limb:hand,phase});
  expect(reference.activeVertex).toBe(attached.activeVertex);
  const observed=hand==='handL'?mid.leftWrist:mid.rightWrist;
  for(let i=0;i<3;i++)expect(observed[i]).toBeCloseTo(reference.translation[i],9);
 }
},100_000);

it('treats a redirected detached wrist as fatal before retrying a second-step recipe',async()=>{
 const x=await setup(),raw=recipes.expandSelectedPoolRecipes,events:PoolNumericTrialEvent[]=[];
 const spy=vi.spyOn(recipes,'expandSelectedPoolRecipes').mockImplementation(function*(...args){
  for(const p of raw(...args)){
   if(p.kind==='recipe'){
    const altered=structuredClone(p.recipe),k=altered.knots.find(k=>k.unit===14000)!;
    k.hands.handR=structuredClone(altered.secondRung.handR);
    yield {kind:'recipe',recipe:altered};
   }
   yield p;
  }
 });
 try{
  expect(()=>verifyOwnedPoolNumericSlice(x.input,x.sources,x.definition,
   {stages:secondStepStages(),opening:secondStep,operationIds:[x.knot(.22).id]},limits,{event:e=>events.push(e)}))
   .toThrow('Opening wrist slide differs from its selected finite rail trajectory at 14000');
  expect(events.filter(e=>e.kind==='proposed')).toHaveLength(1);
 }finally{spy.mockRestore();}
});

it('refuses a below-plane right-foot approach then admits the same second-step interval under a new owner',async()=>{
 const x=await setup(),raw=recipes.expandSelectedPoolRecipes,events:PoolNumericTrialEvent[]=[];
 const job=x.schedule.jobs.find(j=>j.action==='pool_enter'&&j.kind==='interval'&&j.left==='entry/20500'&&j.right==='entry/21999'&&j.fraction===.5)!;
 const spy=vi.spyOn(recipes,'expandSelectedPoolRecipes').mockImplementation(function*(...args){
  for(const p of raw(...args)){
   if(p.kind==='recipe'){
    const altered=structuredClone(p.recipe),a=altered.knots.find(k=>k.unit===20500)!.feet.footR;
    const touchdown=altered.knots.find(k=>k.unit===22000)!.feet.footR;
    a.target=[a.target[0],a.target[1],touchdown.target[2]-.01];
    yield {kind:'recipe',recipe:altered};
   }
   yield p;
  }
 });
 try{
  const result=verifyOwnedPoolNumericSlice(x.input,x.sources,x.definition,
   {stages:secondStepStages(),opening:secondStep,operationIds:[job.id]},limits,{event:e=>events.push(e)});
  if(result.kind!=='admitted-slice')throw new Error(JSON.stringify(result));
  expect(result.rejected[0].reason).toContain('below its exact nominal reference plane');
  const disposed=events.findIndex(e=>e.kind==='disposed'&&e.attempt===1),accepted=events.findIndex(e=>e.kind==='captured'&&e.attempt===2);
  expect(disposed).toBeGreaterThanOrEqual(0);expect(accepted).toBeGreaterThan(disposed);expect(result.completed).toEqual([job.id]);
 }finally{spy.mockRestore();}
},100_000);

it('certifies the acquired matrix at each real second-rung destination despite the different preferred facet rotation',async()=>{
 const x=await setup(),src=x.source(),selected=secondStepStages(),baseWork=new PoolTrialWork(limits),work=new PoolTrialWork(limits);
 const preference=src.captureNumericExterior(selected,baseWork,opening);
 expect([...recipes.numericalPoolRecipes(preference,baseWork)]).toEqual([{kind:'unavailable',unit:22000,reason:'handL has no compatible finite rail contact'}]);
 const second=selected[2],destination=second.choices[0];
 selected[2]={...second,choices:[{...destination,label:'outside actual left shoulder reach',parameters:{...destination.parameters,handL:4.05}},destination]};
 const input=src.captureNumericExterior(selected,work,secondStep);
 const proposals=[...recipes.numericalPoolRecipes(input,work)];expect(proposals).toHaveLength(2);
 expect(proposals[0]).toEqual({kind:'unavailable',unit:22000,reason:'handL has no compatible finite rail contact'});
 const value=proposals[1];if(value.kind!=='recipe')throw new Error(JSON.stringify(value));
 const knot=value.recipe.knots.find(k=>k.unit===22000)!,program=src.materializeNumericKnot(knot);
 for(const l of ['handL','handR'] as const){
  const start=input.acquisition.hands[l],p=destinationParameters[l],destination=value.recipe.secondRung[l],shape=input.stages[2].choices[0].shape;
  const shoulder=nextStance.hips.map((v,i)=>v+shape.offsets[l][i]);
  const preferred=preference.stages[2].edges[l].find(e=>e.from<p&&p<e.to&&e.side===Math.sign(shoulder[1]-e.frameY))!;
  expect(preferred.rawOrientation).not.toEqual(start.grasp.rawOrientation);
  const attached=program.controls.find(c=>c.end===src.anatomy[l].end)!.state.attached!;
  const reference=resolvePoolRailContactFrame(attached.geometry,start.grasp.rawOrientation,p,undefined,attached.source);
  expect(reference.activeVertex).toBe(start.grasp.activeVertex);expect(reference.edge.fromParameter).toBe(preferred.from);
  expect(reference.edge.toParameter).toBe(preferred.to);expect(p).toBeGreaterThan(reference.edge.fromParameter);expect(p).toBeLessThan(reference.edge.toParameter);
  expect(destination.grasp.rawOrientation).toEqual(start.grasp.rawOrientation);expect(destination.grasp.parameter).toBe(p);
  const observed=program.controls.find(c=>c.end===src.anatomy[l].end)!.state;
  expect(observed.target).toEqual(reference.translation);expect(observed.orientation).toEqual(reference.orientation);
  const distance=Math.hypot(...observed.target.map((v,i)=>v-shoulder[i]));expect(distance).toBeGreaterThan(input.reach[l].minimum);expect(distance).toBeLessThan(input.reach[l].maximum);
 }
});

it('rejects corrupt moving foot approach triangles before planning an endpoint-only request',async()=>{
 const x=await setup(),fixture=structuredClone(x.sources.fixture),mesh=vi.spyOn(meshPlanning,'prepareOwnedPoolMeshPlan');
 const clip=fixture.clips.pool_enter;
 clip.samples.find(r=>r.phase===.205)!.limbs.footR.region={kind:'top-face',triangles:[0,1]};
 clip.intervals.find(r=>r.start===.205)!.limbs.footR.region={kind:'top-face',triangles:[0,1]};
 try{
  expect(()=>verifyOwnedPoolNumericSlice(x.input,{...x.sources,fixture},x.definition,{stages:secondStepStages(),opening:secondStep,operationIds:[x.knot(.22).id]},limits)).toThrow('installed moving sole region');
  expect(mesh).not.toHaveBeenCalled();
 }finally{mesh.mockRestore();}
});

it('refuses coherent selected wrist substitution against the independent chain under a node-only request',async()=>{
 const x=await setup(),raw=recipes.expandSelectedPoolRecipes,events:PoolNumericTrialEvent[]=[];
 const spy=vi.spyOn(recipes,'expandSelectedPoolRecipes').mockImplementation(function*(...args){
  for(const p of raw(...args)){
   const altered=structuredClone(p.recipe),end=altered.knots.find(k=>k.unit===22000)!;
   const dest=altered.secondRung.handL;
   const delta=.001;dest.grasp.parameter+=delta;end.hands.handL=structuredClone(dest);
   for(const k of altered.knots.filter(k=>k.unit>12000&&k.unit<22000)){
    const t=Math.min(1,(k.unit-12000)/6500),w=t*t*(3-2*t),h=k.hands.handL;
    if('grasp' in h)k.hands.handL={...h,grasp:{...h.grasp,parameter:altered.acquisition.handL.grasp.parameter+(dest.grasp.parameter-altered.acquisition.handL.grasp.parameter)*w}};
   }
   yield {kind:'recipe',recipe:altered};yield p;
  }
 });
 try{
  expect(()=>verifyOwnedPoolNumericSlice(x.input,x.sources,x.definition,{stages:secondStepStages(),opening:secondStep,operationIds:[x.knot(.22).id]},limits,{event:e=>events.push(e)})).toThrow('independently selected endpoint');
  expect(events.filter(e=>e.kind==='observed')).toHaveLength(0);
 }finally{spy.mockRestore();}
});

const outsideThird:NumericBody={"hips":[-0.5,1.6489004204938198,1.0847596426425978],"hipPitch":0,"trunkPitch":30,"headPitch":10};
const crestLanding:NumericBody={"hips":[-0.5,1.5476002281871861,0.9153327234504888],"hipPitch":0,"trunkPitch":15,"headPitch":10};
const crestWrists:NonNullable<NumericStageRequest['choices'][number]['literalHands']>={"handL":{"parameter":4.227184891444577,"activeVertex":33408,"rawOrientation":[-1.0200627091137583e-06,0.9049952796262352,0.4254216071771532,0,-0.1370453799379532,-0.4214077830389078,0.8964563816672259,0,0.9905647701370273,-0.05830115134768236,0.12402585180079642,0,0,0,0,1],"surface":"Pool ladder rail 1"},"handR":{"parameter":4.227184871568798,"activeVertex":34023,"rawOrientation":[-1.0200627091144269e-06,-0.9049950932057319,-0.42542200374746486,0,0.13704537993795318,-0.42140817586746143,0.8964561970055877,0,-0.9905647701370273,-0.05830120569599974,0.1240258262531284,0,0,0,0,1],"surface":"Pool ladder rail 2"}};
const exterior:ExteriorChainRequest={kind:'connected-exterior',steps:[
 {kind:'third-exterior-step',limb:'footL',from:'outside1',to:'outside3',startUnit:22000,endUnit:32000},
 {kind:'crest-landing-step',limb:'footR',from:'outside2',to:'crest',startUnit:32000,endUnit:42000},
]};
function exteriorStages(relative=false):NumericStageRequest[]{
 const delta=(a:NumericBody,b:NumericBody):NumericBody=>({...b,hips:[b.hips[0]-a.hips[0],b.hips[1]-a.hips[1],b.hips[2]-a.hips[2]]});
 return [...secondStepStages(),{unit:32000,role:'third-rung',places:{footL:'outside3',footR:'outside2'},choices:[
  {label:'bilateral third rung',body:relative?delta(nextStance,outsideThird):outsideThird,relativeToPrevious:relative,parameters:{handL:4.0625,handR:4.0625}}]},
  {unit:42000,role:'crest-leading',places:{footL:'outside3',footR:'crest'},choices:[
  {label:'crest landing',body:relative?delta(outsideThird,crestLanding):crestLanding,relativeToPrevious:relative,literalHands:crestWrists}]}];
}

it('prepares the two planted paths from the same selected relative third rung and releases its owner before replay',async()=>{
 const x=await setup(),events:PoolNumericTrialEvent[]=[];
 const captures=vi.spyOn(PoolCycleSource.prototype,'preparePlantedStep');
 try{
  const result=verifyOwnedPoolNumericSlice(x.input,x.sources,x.definition,{stages:exteriorStages(true),opening:exterior,operationIds:[x.knot(.32).id]},limits,{event:e=>events.push(e)});
  if(result.kind!=='admitted-slice')throw new Error(JSON.stringify(result));
  expect(captures).toHaveBeenCalledTimes(2);expect(captures.mock.contexts[0]).toBe(captures.mock.contexts[1]);
  const intervals=captures.mock.results.map(r=>{if(r.type!=='return')throw new Error('Missing completed planted endpoint solve.');return r.value;});
  expect(intervals.map(i=>[i.fromUnit,i.toUnit])).toEqual([[22000,32000],[32000,42000]]);
  for(const i of intervals)expect(i.first.branch).toBe(i.last.branch);
  expect(result.recipe.knots.find(k=>k.unit===32000)!.body).toEqual(outsideThird);
  expect(result.recipe.knots.find(k=>k.unit===42000)!.body).toEqual(crestLanding);
  const released=events.findIndex(e=>e.kind==='released-endpoints'),recaptured=events.findIndex(e=>e.kind==='captured'&&e.attempt===1);
  expect(released).toBeGreaterThanOrEqual(0);expect(recaptured).toBeGreaterThan(released);
  for(const unit of [25125,35125]){
   const segment=intervals.find(i=>unit>i.fromUnit&&unit<i.toUnit)!,k=result.recipe.knots.find(k=>k.unit===unit)!;
   const {multiply,transform}=await import('../src/render/character/math.js');
   const {interpolateTransform}=await import('../src/render/character/motion.js');
   const f=(unit-segment.fromUnit)/((segment.toUnit-segment.fromUnit)*.65),w=f*f*(3-2*f);
   const blend=(a:readonly number[],b:readonly number[])=>interpolateTransform([...a],[...b],w);
   const thigh=multiply(segment.hipToUpper,blend(segment.first.upper,segment.last.upper));
   const shin=multiply(multiply(thigh,segment.upperToLower),blend(segment.first.lower,segment.last.lower));
   const ankle=multiply(shin,segment.lowerToEnd),offset=transform(segment.first.hipRotation,[ankle[12],ankle[13],ankle[14]]);
   for(let j=0;j<3;j++)expect(k.body.hips[j]).toBeCloseTo(segment.sole[j]-offset[j],12);
  }
 }finally{captures.mockRestore();}
},100_000);

it('denies the preparation owner before constructing any selected planted endpoints and disposes an interrupted preparation',async()=>{
 const x=await setup(),calls=vi.spyOn(PoolCycleSource.prototype,'preparePlantedStep');
 try{
  const request={stages:exteriorStages(),opening:exterior,operationIds:[x.knot(.32).id]};
  expect(verifyOwnedPoolNumericSlice(x.input,x.sources,x.definition,request,{...limits,captures:1}).kind).toBe('exhausted');
  expect(calls).not.toHaveBeenCalled();
  const ac=new AbortController(),events:PoolNumericTrialEvent[]=[];
  calls.mockRestore();
  const original=PoolCycleSource.prototype.preparePlantedStep;
  const interrupt=vi.spyOn(PoolCycleSource.prototype,'preparePlantedStep');
  try{
   interrupt.mockImplementation(function(this:PoolCycleSource,...args){ac.abort();return original.apply(this,args);});
   const r=verifyOwnedPoolNumericSlice(x.input,x.sources,x.definition,request,limits,{signal:ac.signal,event:e=>events.push(e)});
   expect(r.kind).toBe('cancelled');expect(events.filter(e=>e.kind==='released-endpoints')).toHaveLength(1);
   expect(events.filter(e=>e.kind==='observed')).toHaveLength(0);
  }finally{interrupt.mockRestore();}
 }finally{calls.mockRestore();}
},100_000);

it('preserves both literal exterior joins when an unrelated extra interior cut is inserted',async()=>{
 const x=await setup(),extra:ExteriorChainRequest={...exterior,steps:[{...exterior.steps[0],additionalUnits:[26000]},exterior.steps[1]]};
 const run=(opening:ExteriorChainRequest)=>verifyOwnedPoolNumericSlice(x.input,x.sources,x.definition,
  {stages:exteriorStages(true),opening,operationIds:[x.knot(.32).id]},limits);
 const old=run(exterior),added=run(extra);
 if(old.kind!=='admitted-slice'||added.kind!=='admitted-slice')throw new Error(JSON.stringify([old,added]));
 for(const u of [22000,32000,42000])expect(added.recipe.knots.find(k=>k.unit===u)).toEqual(old.recipe.knots.find(k=>k.unit===u));
 expect(added.recipe.knots.filter(k=>k.unit===32000)).toHaveLength(1);
 expect(added.recipe.knots.find(k=>k.unit===26000)).toBeDefined();
},100_000);

it.each([[22000,32000,43,'footR'],[32000,42000,55,'footL']] as const)('admits the full exterior range from %i to %i',async(lo,hi,count,limb)=>{
 const x=await setup(),r=verifyOwnedPoolNumericSlice(x.input,x.sources,x.definition,
  {stages:exteriorStages(true),opening:exterior,entryRange:[lo,hi]},limits);
 if(r.kind!=='admitted-slice')throw new Error(JSON.stringify(r));
 expect(r.completed).toHaveLength(count);expect(r.openingSamples).toHaveLength(count);expect(r.rejected).toHaveLength(0);
 const sampleUnit=lo===22000?25125:35125,observed=r.openingSamples!.find(k=>k.job===x.knot(sampleUnit/100000).id)!;
 const predicted=r.recipe.knots.find(k=>k.unit===sampleUnit)!.body.hips;
 for(let i=0;i<3;i++)expect(observed.hips[i]).toBeCloseTo(predicted[i],9);
 const hinges=r.maintained.filter(k=>k.limb===limb);expect(hinges).toHaveLength(count);expect(hinges.every(k=>k.branch===hinges[0].branch)).toBe(true);
 expect(r.published).toBe(false);
},100_000);

it('rejects duplicate and missing expanded cuts before constructing a replay-data map',async()=>{
 const x=await setup(),raw=recipes.expandSelectedPoolRecipes;
 for(const duplicate of [true,false]){
  const spy=vi.spyOn(recipes,'expandSelectedPoolRecipes').mockImplementation(function*(...args){
   for(const p of raw(...args)){
    const altered=structuredClone(p.recipe),k=altered.knots.find(k=>k.unit===14000)!;
    altered.knots=duplicate?[...altered.knots,k]:altered.knots.filter(r=>r!==k);
    yield {kind:'recipe',recipe:altered};
   }
  });
  try{
   expect(()=>verifyOwnedPoolNumericSlice(x.input,x.sources,x.definition,{stages:secondStepStages(),opening:secondStep,operationIds:[x.knot(.22).id]},limits))
    .toThrow(duplicate?'Duplicate or unbound exterior knot identity':'mandatory knot');
  }finally{spy.mockRestore();}
 }
},100_000);

it('retains a genuine third-rung approach refusal before admitting the next complete connected trial',async()=>{
 const x=await setup(),raw=recipes.expandSelectedPoolRecipes,events:PoolNumericTrialEvent[]=[];
 const job=x.schedule.jobs.find(j=>j.action==='pool_enter'&&j.kind==='interval'&&j.left==='entry/30500'&&j.right==='entry/31999'&&j.fraction===.5)!;
 const spy=vi.spyOn(recipes,'expandSelectedPoolRecipes').mockImplementation(function*(...args){
  for(const p of raw(...args)){
   const altered=structuredClone(p.recipe),flight=altered.knots.find(k=>k.unit===30500)!.feet.footL;
   const landed=altered.knots.find(k=>k.unit===32000)!.feet.footL;
   flight.target=[flight.target[0],flight.target[1],landed.target[2]-.01];
   yield {kind:'recipe',recipe:altered};yield p;
  }
 });
 try{
  const r=verifyOwnedPoolNumericSlice(x.input,x.sources,x.definition,{stages:exteriorStages(),opening:exterior,operationIds:[job.id]},limits,{event:e=>events.push(e)});
  if(r.kind!=='admitted-slice')throw new Error(JSON.stringify(r));
  expect(r.rejected[0].reason).toContain('below its exact nominal reference plane');
  const disposed=events.findIndex(e=>e.kind==='disposed'&&e.attempt===1),next=events.findIndex(e=>e.kind==='captured'&&e.attempt===2);
  expect(disposed).toBeGreaterThanOrEqual(0);expect(next).toBeGreaterThan(disposed);expect(r.completed).toEqual([job.id]);
 }finally{spy.mockRestore();}
},100_000);

it('never resolves an unused later crest literal orientation while a selected crest frame is certified',async()=>{
 const x=await setup(),stages=exteriorStages(),end=stages[4],original=end.choices[0],hands=original.literalHands!;
 const dormant=hands.handL.rawOrientation.map((v,i)=>i<8?-v:v);
 end.choices=[original,{...original,label:'unused valid rotation',literalHands:{...hands,handL:{...hands.handL,rawOrientation:dormant}}}];
 const cert=vi.spyOn(railFrames,'resolvePoolRailContactFrame');
 const eq=(a:readonly number[],b:readonly number[])=>a.length===b.length&&a.every((v,i)=>v===b[i]);
 try{
  const result=verifyOwnedPoolNumericSlice(x.input,x.sources,x.definition,{stages,opening:exterior,operationIds:[x.knot(.32).id]},limits);
  if(result.kind!=='admitted-slice')throw new Error(JSON.stringify(result));
  expect(result.rejected).toHaveLength(0);
  expect(cert.mock.calls.some(([,orientation])=>eq(orientation,dormant))).toBe(false);
  expect(cert.mock.calls.some(([,rotation,parameter,vertex,location])=>location?.phase===.42&&location.limb==='handL'&&
   parameter===hands.handL.parameter&&vertex===hands.handL.activeVertex&&eq(rotation,hands.handL.rawOrientation))).toBe(true);
 }finally{cert.mockRestore();}
},100_000);

it('rejects substituted planted hips at an unrequested cut before replay mesh planning',async()=>{
 const x=await setup(),raw=recipes.expandSelectedPoolRecipes,mesh=vi.spyOn(meshPlanning,'prepareOwnedPoolMeshPlan');
 let plansBeforeReplay=-1;
 const spy=vi.spyOn(recipes,'expandSelectedPoolRecipes').mockImplementation(function*(...args){
  for(const p of raw(...args)){
   const changed=structuredClone(p.recipe),k=changed.knots.find(k=>k.unit===25125)!;
   k.body.hips=[k.body.hips[0],k.body.hips[1]+.0001,k.body.hips[2]];
   plansBeforeReplay=mesh.mock.calls.length;
   yield {kind:'recipe',recipe:changed};yield p;
  }
 });
 try{
  expect(()=>verifyOwnedPoolNumericSlice(x.input,x.sources,x.definition,{stages:exteriorStages(true),opening:exterior,operationIds:[x.knot(.32).id]},limits)).toThrow('independently prepared planted hips at 25125');
  expect(plansBeforeReplay).toBeGreaterThan(0);expect(mesh.mock.calls.length).toBe(plansBeforeReplay);
 }finally{spy.mockRestore();mesh.mockRestore();}
},100_000);

it('observes two independently predicted planted pelvis positions when only the named predecessor changes',async()=>{
 const x=await setup(),base=exteriorStages(true),offset=base[3].choices[0].body!,lastOffset=base[4].choices[0].body!;
 const {solvePoolOrientedFoot}=await import('../src/render/character/pool-oriented-leg.js');
 const {multiply,sub,transform}=await import('../src/render/character/math.js');
 const {interpolateTransform}=await import('../src/render/character/motion.js');
 const predictions:number[]=[],measurements:number[]=[];
 for(const dy of [0,.0001]){
  const rows=structuredClone(base),start=structuredClone(nextStance);
  start.hips=[start.hips[0],start.hips[1]+dy,start.hips[2]];
  rows[2].choices=[{...rows[2].choices[0],body:start}];
  expect(rows[3].choices[0].body).toEqual(offset);expect(rows[4].choices[0].body).toEqual(lastOffset);
  const end={...offset,hips:[start.hips[0]+offset.hips[0],start.hips[1]+offset.hips[1],start.hips[2]+offset.hips[2]] as [number,number,number]};
  const source=x.source(),leg=source.anatomy.footR,sole=source.foot('footR','outside2');
  const frame=source.frame('footR',sole.support,[sole.target[0],sole.target[1]]),hip=source.bundle.bones.findIndex(b=>b.name==='hips');
  const matrices=(b:NumericBody)=>{
   const pose=source['placeBody'](b);
   solvePoolOrientedFoot(pose,leg.upper,leg.lower,leg.end,frame);
   const rotation=[...pose.world[hip]];rotation.splice(12,3,0,0,0);
   return {upper:pose.basis[leg.upper],lower:pose.basis[leg.lower],rotation};
  };
  const left=matrices(start),right=matrices(end),u=3125/6500,t=u*u*(3-2*u);
  const chain=(a:number,b:number)=>multiply(source.neutral.inverse[a],source.neutral.rest[b]);
  const upper=multiply(chain(hip,leg.upper),interpolateTransform(left.upper,right.upper,t));
  const lower=multiply(multiply(upper,chain(leg.upper,leg.lower)),interpolateTransform(left.lower,right.lower,t));
  const ankle=multiply(lower,chain(leg.lower,leg.end)),expected=sub(sole.target,transform(left.rotation,[ankle[12],ankle[13],ankle[14]]));
  const job=x.knot(.25125),r=verifyOwnedPoolNumericSlice(x.input,x.sources,x.definition,{stages:rows,opening:exterior,operationIds:[job.id]},limits);
  if(r.kind!=='admitted-slice')throw new Error(JSON.stringify(r));
  expect(r.completed).toEqual([job.id]);expect(r.rejected).toHaveLength(0);
  expect(r.recipe.knots.find(k=>k.unit===32000)!.body).toEqual(end);
  const measured=r.openingSamples![0].hips;
  for(let i=0;i<3;i++)expect(measured[i]).toBeCloseTo(expected[i],10);
  predictions.push(expected[1]);measurements.push(measured[1]);
 }
 expect(Math.abs(predictions[1]-predictions[0])).toBeGreaterThan(.00005);
 expect(measurements[1]-measurements[0]).toBeCloseTo(predictions[1]-predictions[0],10);
},100_000);

it('refuses a selected valid-patch crest vertex mismatch locally then admits the original selected chain',async()=>{
 const x=await setup(),stages=exteriorStages(),end=stages[4],good=end.choices[0],hands=good.literalHands!;
 const alternate=x.source().anatomy.handL.patch.vertices.find(v=>v.id!==hands.handL.activeVertex)!.id;
 end.choices=[{...good,label:'another valid patch vertex',literalHands:{...hands,handL:{...hands.handL,activeVertex:alternate}}},good];
 const events:PoolNumericTrialEvent[]=[];
 const result=verifyOwnedPoolNumericSlice(x.input,x.sources,x.definition,{stages,opening:exterior,operationIds:[x.knot(.32).id]},limits,{event:e=>events.push(e)});
 if(result.kind!=='admitted-slice')throw new Error(JSON.stringify(result));
 expect(result.rejected.some(r=>r.reason.includes('active-extremum transition'))).toBe(true);
 expect(events.filter(e=>e.kind==='released-endpoints')).toHaveLength(2);
 expect(result.completed).toEqual([x.knot(.32).id]);
},100_000);

it('retains independent preparation geometry when expansion coherently rewrites planted numbers and downstream hips',async()=>{
 const x=await setup(),raw=recipes.expandSelectedPoolRecipes,events:PoolNumericTrialEvent[]=[];
 const spy=vi.spyOn(recipes,'expandSelectedPoolRecipes').mockImplementation(function*(input,work,selection,plants){
  if(!plants?.length)throw new Error('Missing selected planted geometry in the test.');
  const p=plants[0],v=p.sole;p.sole=[v[0],v[1]+.0001,v[2]];
  yield* raw(input,work,selection,plants);
 });
 try{
  expect(()=>verifyOwnedPoolNumericSlice(x.input,x.sources,x.definition,{stages:exteriorStages(true),opening:exterior,operationIds:[x.knot(.32).id]},limits,{event:e=>events.push(e)}))
   .toThrow('independently prepared planted hips at 22001');
  expect(events.filter(e=>e.kind==='observed')).toHaveLength(0);
 }finally{spy.mockRestore();}
},100_000);

it('validates a malformed later crest literal before any early choice starts geometry',async()=>{
 const x=await setup(),stages=exteriorStages(),end=stages[4],good=end.choices[0],hands=good.literalHands!;
 end.choices=[good,{...good,label:'malformed unused command',literalHands:{...hands,handL:{...hands.handL,activeVertex:NaN}}}];
 const mesh=vi.spyOn(meshPlanning,'prepareOwnedPoolMeshPlan'),resolve=vi.spyOn(railFrames,'resolvePoolRailContactFrame');
 try{
  expect(()=>verifyOwnedPoolNumericSlice(x.input,x.sources,x.definition,{stages,opening:exterior,operationIds:[x.knot(.32).id]},limits)).toThrow('Invalid numeric pool grasp');
  expect(mesh).not.toHaveBeenCalled();expect(resolve).not.toHaveBeenCalled();
 }finally{resolve.mockRestore();mesh.mockRestore();}
},100_000);
