import {parseNumericStages,readParsedStages} from '../src/render/character/pool-numeric-stages.js';
import motion from '../../assets/models/sims/character-creator/pool_activity_motion_v16.json';
import contacts from '../../assets/models/sims/character-creator/clips/pool/contacts-v5.json?raw';
import {expect,it,vi} from 'vitest';
import {defaultAppearance,validateAppearance} from '../src/character/schema.js';
import {PoolCycleSource,validatePoolCycleDefinition} from '../src/render/character/pool-cycle-source.js';
import {verifyOwnedPoolNumericSlice,type PoolNumericTrialEvent} from '../src/render/character/pool-owned-compilation.js';
import {parseOwnedPoolFixture} from '../src/render/character/pool-owned-fixture.js';
import {PreparedBody} from '../src/render/character/prepared-body.js';
import {anatomicalHeight} from '../src/render/character/shape.js';
import {createPoolContactInput} from '../src/render/character/pool-contact-preparation.js';
import {makePoolContactInput,POOL_ACTIONS} from '../src/render/character/pool-contact-protocol.js';
import {sleepContactDigest} from '../src/render/character/sleep-contact-protocol.js';
import {exactPoolEntryUnit,poolReplaySchedule} from '../src/render/character/pool-replay-schedule.js';
import {PoolTrialReceipts,PoolTrialRefusal,PoolTrialWork} from '../src/render/character/pool-trial-work.js';
import {numericalPoolRecipes,type NumericBody,type NumericStageRequest} from '../src/render/character/pool-numeric-recipe.js';
import {poolBase,poolLibrary,poolRig} from './pool-observer-fixture.js';
import {interpolatePoolLimbState,resolvePoolLimbState} from '../src/render/character/pool-contact-evaluator.js';
import * as meshPlanning from '../src/render/character/pool-mesh-planning.js';
import * as footFrames from '../src/render/character/pool-foot-contact-frame.js';
import * as railFrames from '../src/render/character/pool-rail-contact-frame.js';
import * as anatomy from '../src/render/character/pool-entry-anatomy.js';
import * as liveSample from '../src/render/character/pool-contact-sample.js';
import {resolvePoolRailContactFrame} from '../src/render/character/pool-rail-contact-frame.js';
import * as supportProof from '../src/render/character/pool-support-arithmetic.js';
import * as railProof from '../src/render/character/pool-rail-support-arithmetic.js';
import {multiply} from '../src/render/character/math.js';

const limits={captures:12,expansions:8192,observations:10,reverseComparisons:0,milliseconds:100_000};
const body=(y:number,z:number,trunkPitch=30):NumericBody=>({hips:[-.5,y,z],hipPitch:0,trunkPitch,headPitch:10});
const original=body(1.5,.9414365344809708),first=body(1.6218885433565438,.899030752728482),second=body(1.5483138922844537,.9712456257904025);
const stages=():NumericStageRequest[]=>[
 {unit:5000,role:'acquisition',places:{footL:'ground',footR:'ground'},choices:[{label:'ground'}]},
 {unit:12000,role:'first-rung',places:{footL:'outside1',footR:'ground'},choices:[{label:'nominal',body:original},{label:'clear shin',body:first}]},
 {unit:22000,role:'second-rung',places:{footL:'outside1',footR:'outside2'},choices:[{label:'second rung',body:second,parameters:{handL:4.270833333333333,handR:4.270833333333333}}]},
];
async function setup(presentation:'feminine'|'masculine'='feminine'){
 const base=defaultAppearance(presentation),b=presentation==='feminine'?100:0;
 const appearance=validateAppearance({...base,body:{height:b,build:100,hips:100,shoulders:100,torso:100}});
 const definition:unknown=structuredClone(motion);validatePoolCycleDefinition(definition);
 if(definition.version!==16)throw new Error('Expected v16.');
 const fixture=parseOwnedPoolFixture(contacts);
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

it('rejects the complete nominal recipe inside a real v16 owner and admits the next first-rung stance in a fresh owner',async()=>{
 const x=await setup(),events:PoolNumericTrialEvent[]=[];
 const legacy=vi.spyOn(PoolCycleSource.prototype,'entry'),authoring=vi.spyOn(PoolCycleSource.prototype,'bodyPathDiagnostic');
 try{
  const result=verifyOwnedPoolNumericSlice(x.input,x.sources,x.definition,x.request,limits,{event:e=>events.push(e)});
  expect(result.kind).toBe('admitted-slice');
  if(result.kind!=='admitted-slice')throw new Error(JSON.stringify(result));
  expect(result.published).toBe(false);expect(result.completed).toEqual(x.request.operationIds);
  expect(result.rejected.some(r=>r.attempt===1&&r.reason.includes('Physical refusal'))).toBe(true);
  expect(events.map(e=>e.kind+e.attempt)).toEqual(['captured0','disposed0','proposed1','captured1','disposed1','refused1','proposed2','captured2','observed2','disposed2']);
  expect(result.recipe.knots[1].body).toEqual(first);
  expect(result.recipe.knots[1].hands).toEqual(result.recipe.acquisition);
  expect(result.recipe.secondRung.handL.grasp.parameter).toBe(4.270833333333333);
  expect(result.recipe.secondRung.handR.grasp.parameter).toBe(4.270833333333333);
  expect(result.maintained.map(r=>[r.limb,r.branch])).toEqual([['footL',-1],['footR',-1]]);
  expect(legacy).not.toHaveBeenCalled();expect(authoring).not.toHaveBeenCalled();
 }finally{legacy.mockRestore();authoring.mockRestore();}
},100_000);

it('keeps later first-rung and second-grip alternatives after genuine nonconstructing proposals',async()=>{
 const x=await setup(),request=stages();
 request[1]={...request[1],choices:[{label:'unreachable first rung',body:body(4,1)},request[1].choices[1]]};
 request[2]={...request[2],choices:[{...request[2].choices[0],label:'incompatible palm orientation',parameters:{handL:4.4375,handR:4.4375}},...request[2].choices]};
 const work=new PoolTrialWork(limits),configured=x.source().captureNumericExterior(request,work);
 const outcomes=[...numericalPoolRecipes(configured,work)];
 expect(outcomes.some(o=>o.kind==='unavailable'&&o.unit===12000)).toBe(true);
 expect(outcomes.some(o=>o.kind==='unavailable'&&o.unit===22000)).toBe(true);
 expect(outcomes.some(o=>o.kind==='recipe')).toBe(true);
});

it('constructs a later crest from the selected predecessor without evaluating the refused nominal crest',async()=>{
 const x=await setup(),request=stages();
 const from=body(1.5142220775843325,1.499199055229494,15),to=body(1.5476002281871861,.9153327234504888,15);
 request.push({unit:42000,role:'crest',places:{footL:'outside3',footR:'crest'},choices:[
  {label:'unreachable low edge from nominal shoulders',body:from,parameters:{handL:5,handR:5}},
  {label:'fitted from selected second rung',relativeToPrevious:true,body:{...to,hips:[0,to.hips[1]-second.hips[1],to.hips[2]-second.hips[2]]},
   parameters:{handL:4.227184891444577,handR:4.227184871568798}},
 ]});
 const work=new PoolTrialWork(limits),inputs=x.source().captureNumericExterior(request,work);
 const outcomes=[...numericalPoolRecipes(inputs,work)];
 expect(outcomes.some(r=>r.kind==='unavailable'&&r.unit===42000)).toBe(true);
 expect(outcomes.some(r=>r.kind==='recipe'&&Math.abs(r.recipe.knots.at(-1)!.body.hips[1]-to.hips[1])<1e-12)).toBe(true);
});

it('constructs literal acquisitions on the ordinary and ground-fit fallback geometry branches',async()=>{
 for(const [presentation,branch] of [['feminine','ordinary'],['masculine','fallback']] as const){
  const x=await setup(presentation),source=x.source(),input=source.captureNumericExterior(stages(),new PoolTrialWork(limits));
  expect(input.acquisition.branch).toBe(branch);
  const real=source.entry(.05);
  for(const [i,l] of (['handL','handR'] as const).entries()){
   const actual=real.controls[i+2].state,numeric=input.acquisition.hands[l];
   expect(numeric.heldTarget).toEqual(actual.target);
   expect(numeric.heldOrientation).toEqual(actual.orientation);
   expect(numeric.grasp.parameter).toBe(actual.attached!.parameter);
   expect(numeric.grasp.activeVertex).toBe(actual.attached!.activeVertex);
   expect(numeric.grasp.rawOrientation).toEqual(actual.attached!.rawOrientation);
  }
 }
});

it('has separate real incoming/outgoing operations at .424 and refuses an off-grid toe event',async()=>{
 const x=await setup(),at=x.schedule.jobs.filter(j=>j.action==='pool_enter'&&j.phase===.424);
 expect(at.map(j=>j.kind)).toEqual(['node','interval','interval']);
 expect(at.map(j=>j.fraction)).toEqual([0,1,0]);
 expect(new Set(at.map(j=>j.id)).size).toBe(3);
 expect(()=>exactPoolEntryUnit(.42001+Number.EPSILON,100000)).toThrow('off its declared entry clock');
 const request=stages(),crest=body(1.5476002281871861,.9153327234504888,15);
 request[1]={...request[1],choices:[request[1].choices[1]]};
 for(const unit of [42001,42400,42800])request.push({unit,role:'crest',places:{footL:'outside3',footR:'crest'},
  choices:[{label:'held crest',body:crest,parameters:unit===42800?{handR:4.227184871568798}:{handL:4.227184891444577,handR:4.227184871568798},
   ...(unit===42800?{freeHands:{handL:{offset:[-.1,-.25,-.1],orientation:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}}}:{})}]});
 const issued:object[]=[],failures:boolean[]=[];
 const require=PoolTrialReceipts.prototype.require;
 const spy=vi.spyOn(PoolTrialReceipts.prototype,'require').mockImplementation(function(this:PoolTrialReceipts,value,job,left,right){
  if(issued.length){
   try{require.call(this,issued[0],job,left,right);failures.push(false);}catch{failures.push(true);}
   if(issued.length===2){
    try{require.call(this,issued[1],job,left,right);failures.push(false);}catch{failures.push(true);}
   }
  }
  issued.push(value);return require.call(this,value,job,left,right);
 });
 try{
  const result=verifyOwnedPoolNumericSlice(x.input,x.sources,x.definition,{...x.request,stages:request,operationIds:at.map(j=>j.id)},limits);
  expect(result.kind).toBe('admitted-slice');
  expect(issued).toHaveLength(3);expect(failures).toEqual([true,true,true]);
 }finally{spy.mockRestore();}
},100_000);

it('refuses the actual stationary paddle key receipt for its real P/P self-edge on exit origin zero',async()=>{
 const x=await setup(),jobs=x.schedule.jobs.filter(j=>j.action==='pool_exit_0'&&j.phase===0&&j.kind!=='reverse');
 expect(jobs.map(j=>j.kind)).toEqual(['node','interval']);
 expect(jobs[0].left).toBe(jobs[0].right);expect(jobs[1].left).toBe(jobs[0].left);expect(jobs[1].right).toBe(jobs[0].left);
 const original=PoolTrialReceipts.prototype.require;
 let key:Parameters<typeof original>|undefined,refused=false,identicalPrograms=false;
 const spy=vi.spyOn(PoolTrialReceipts.prototype,'require').mockImplementation(function(this:PoolTrialReceipts,...args){
  original.call(this,...args);
  if(!key){key=args;return;}
  const [observation,priorJob,p,q]=key,[,job,left,right]=args;
  identicalPrograms=p===q&&p===left&&p===right&&job.phase===priorJob.phase&&job.fraction===priorJob.fraction;
  try{original.call(this,observation,job,left,right);}catch{refused=true;}
 });
 try{
  const result=verifyOwnedPoolNumericSlice(x.input,x.sources,x.definition,{...x.request,operationIds:jobs.map(j=>j.id)},limits);
  expect(result.kind).toBe('admitted-slice');
  expect(identicalPrograms).toBe(true);expect(refused).toBe(true);
 }finally{spy.mockRestore();}
},100_000);

it('does not start another candidate on invalid fixture, callback failure or a real foreign measurement',async()=>{
 const x=await setup(),positive={...x.request,stages:stages().map(s=>s.role==='first-rung'?{...s,choices:[s.choices[1]]}:s)};
 const second=positive.stages[2].choices[0];
 positive.stages[2]={...positive.stages[2],choices:[second,{...second,label:'also viable',parameters:{handL:4.28,handR:4.28}}]};
 const later={...positive,stages:positive.stages.map(s=>s.role==='second-rung'?{...s,choices:[s.choices[1]]}:s)};
 expect(verifyOwnedPoolNumericSlice(x.input,x.sources,x.definition,later,limits).kind).toBe('admitted-slice');
 const broken=structuredClone(x.sources.fixture);broken.solids[0].triangles[0][0]=Number.MAX_SAFE_INTEGER;
 const bad:PoolNumericTrialEvent[]=[];
 expect(()=>verifyOwnedPoolNumericSlice(x.input,{...x.sources,fixture:broken},x.definition,positive,limits,{event:e=>bad.push(e)})).toThrow();
 expect(bad.filter(e=>e.kind==='proposed')).toEqual([]);
 const failure=new PoolTrialRefusal('callback-owned error'),callbacks:PoolNumericTrialEvent[]=[];
 let thrown;
 try{verifyOwnedPoolNumericSlice(x.input,x.sources,x.definition,positive,limits,{event:e=>{
  callbacks.push(e);if(e.kind==='observed')throw failure;
 }});}catch(error){thrown=error;}
 expect(thrown).toBe(failure);expect(callbacks.filter(e=>e.kind==='proposed')).toHaveLength(1);
 expect(callbacks.filter(e=>e.kind==='captured'&&e.attempt>0)).toHaveLength(1);
 let previous:object|undefined,secondRun=false;
 const require=PoolTrialReceipts.prototype.require,foreignEvents:PoolNumericTrialEvent[]=[];
 const spy=vi.spyOn(PoolTrialReceipts.prototype,'require').mockImplementation(function(this:PoolTrialReceipts,value,job,left,right){
  if(!secondRun)previous=value;
  return require.call(this,secondRun?previous!:value,job,left,right);
 });
 try{
  expect(verifyOwnedPoolNumericSlice(x.input,x.sources,x.definition,positive,limits).kind).toBe('admitted-slice');secondRun=true;
  expect(()=>verifyOwnedPoolNumericSlice(x.input,x.sources,x.definition,positive,limits,{event:e=>foreignEvents.push(e)})).toThrow('different owner');
  expect(foreignEvents.filter(e=>e.kind==='proposed')).toHaveLength(1);
  expect(foreignEvents.filter(e=>e.kind==='captured'&&e.attempt>0)).toHaveLength(1);
 }finally{spy.mockRestore();}
},100_000);

it('reserves atomically before a second capture and rejects cancellation or deadline at diagnostic completion',async()=>{
 const x=await setup(),positive={...x.request,stages:stages().map(s=>s.role==='first-rung'?{...s,choices:[s.choices[1]]}:s)};
 const events:PoolNumericTrialEvent[]=[];
 const denied=verifyOwnedPoolNumericSlice(x.input,x.sources,x.definition,positive,{...limits,captures:1},{event:e=>events.push(e)});
 expect(denied.kind).toBe('exhausted');expect(events.filter(e=>e.kind==='captured')).toHaveLength(1);
 const w=new PoolTrialWork({...limits,captures:1});let expensive=0;
 const capture=()=>{w.reserve('capture',{captures:1,expansions:2});expensive++;};
 capture();expect(capture).toThrow('exhausted');expect(expensive).toBe(1);
 expect(w.snapshot()).toMatchObject({captures:1,expansions:2});
 const signal=new AbortController(),cancelled:PoolNumericTrialEvent[]=[];
 const stopped=verifyOwnedPoolNumericSlice(x.input,x.sources,x.definition,positive,limits,{signal:signal.signal,event:e=>{
  cancelled.push(e);if(e.kind==='observed')signal.abort();
 }});
 expect(stopped.kind).toBe('cancelled');expect(cancelled.at(-1)?.kind).toBe('disposed');
 let now=0;
 const late=verifyOwnedPoolNumericSlice(x.input,x.sources,x.definition,positive,{...limits,milliseconds:10},{now:()=>now,event:e=>{if(e.kind==='observed')now=11;}});
 expect(late.kind).toBe('exhausted');expect(late.published).toBe(false);
},100_000);

it('treats nonfinite rail parameters and free wrist offsets as corrupt input before any candidate trial',async()=>{
 const x=await setup();
 const mesh=vi.spyOn(meshPlanning,'prepareOwnedPoolMeshPlan'),rig=vi.spyOn(anatomy,'preparePoolEntryAnatomy'),
  foot=vi.spyOn(footFrames,'preparePoolFootContactFrame'),rail=vi.spyOn(railFrames,'preparePoolRailGeometry');
 try{
 for(const value of [NaN,Infinity]){
  const choices=stages();choices[2]={...choices[2],choices:[{...choices[2].choices[0],parameters:{handL:value,handR:4.25}},...choices[2].choices]};
  const events:PoolNumericTrialEvent[]=[];
  expect(()=>verifyOwnedPoolNumericSlice(x.input,x.sources,x.definition,{...x.request,stages:choices},limits,{event:e=>events.push(e)})).toThrow('Invalid numeric pool rail parameter');
  expect(events.some(e=>e.kind==='proposed')).toBe(false);
 }
 const choices=stages();choices.push({unit:42800,role:'crest',places:{footL:'outside3',footR:'crest'},
  choices:[{label:'invalid offset',body:first,freeHands:{handL:{offset:[0,Infinity,0],orientation:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}}},
   {label:'later valid',body:first,freeHands:{handL:{offset:[0,-.25,0],orientation:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}}}]});
 const events:PoolNumericTrialEvent[]=[];
 expect(()=>verifyOwnedPoolNumericSlice(x.input,x.sources,x.definition,{...x.request,stages:choices},limits,{event:e=>events.push(e)})).toThrow('Invalid numeric pool free wrist offset');
 expect(events.some(e=>e.kind==='proposed')).toBe(false);
 expect(mesh).not.toHaveBeenCalled();expect(rig).not.toHaveBeenCalled();expect(foot).not.toHaveBeenCalled();expect(rail).not.toHaveBeenCalled();
 }finally{mesh.mockRestore();rig.mockRestore();foot.mockRestore();rail.mockRestore();}
});

it('derives mandatory cuts and rejects an incomplete window or a free-standing added cut',async()=>{
 const x=await setup(),extra=[{unit:42123}];
 const plan=poolReplaySchedule(x.sources.fixture,x.definition,extra);
 expect(plan.entryUnits).toEqual(expect.arrayContaining([42123,...x.definition.crestRoute.sampleUnits,...x.definition.plantedBodyPaths[0].boundaryUnits]));
 expect(plan.entryUnits).toEqual(expect.arrayContaining([42400,48000,49600]));
 expect(()=>verifyOwnedPoolNumericSlice(x.input,x.sources,x.definition,{stages:stages(),entryRange:[5000,12000]},limits)).toThrow('lacks a declared incident knot');
 const forged={...x.request,sourceUnits:[0,5000,12000,100000]};
 expect(()=>verifyOwnedPoolNumericSlice(x.input,x.sources,x.definition,forged,limits)).toThrow('bound to actual numerical recipe');
});

it('keeps semantic job IDs when a different edge is cut and refuses the old ID when its own edge is split',async()=>{
 const x=await setup(),a=x.schedule.jobs.find(j=>j.action==='pool_enter'&&j.kind==='interval'&&j.right==='entry/42400'&&j.fraction===.5)!;
 const early=poolReplaySchedule(x.sources.fixture,x.definition,[{unit:999}]);
 expect(early.jobs.find(j=>j.id===a.id)).toEqual(a);
 for(const key of [.424,1])expect(early.jobs.find(j=>j.id===x.knot(key).id)).toEqual(x.knot(key));
 const more=[...stages(),{unit:42123,role:'crest' as const,places:{footL:'outside3',footR:'crest'},choices:[{label:'bound cut',body:first}]}];
 const split=poolReplaySchedule(x.sources.fixture,x.definition,more);
 expect(split.jobs.some(j=>j.id===a.id)).toBe(false);
 expect(split.jobs.some(j=>j.kind==='interval'&&j.left==='entry/42123'&&j.right==='entry/42400')).toBe(true);
 expect(()=>verifyOwnedPoolNumericSlice(x.input,x.sources,x.definition,{stages:more,operationIds:[a.id]},limits)).toThrow('unknown or duplicate operation');
});

it('reserves before the actual sole-frame and palm-coefficient producers, including direct acquisition capture',async()=>{
 const x=await setup(),source=x.source();
 const foot=vi.spyOn(footFrames,'preparePoolFootContactFrame'),rail=vi.spyOn(railFrames,'preparePoolRailGeometry');
 try{
  const none=new PoolTrialWork({...limits,expansions:0});
  expect(()=>source.foot('footL','outside3',none)).toThrow('exhausted');
  expect(foot).not.toHaveBeenCalled();
  const oneFrame=new PoolTrialWork({...limits,expansions:2});
  expect(()=>source.foot('footL','outside3',oneFrame)).toThrow('exhausted');
  expect(foot).toHaveBeenCalledTimes(1);expect(oneFrame.snapshot().expansions).toBe(2);
  const denied=new PoolTrialWork({...limits,expansions:1});
  expect(()=>source.captureNumericExterior(stages(),denied)).toThrow('exhausted');
  expect(rail).not.toHaveBeenCalled();expect(denied.snapshot().expansions).toBe(1);
  const oneRail=new PoolTrialWork({...limits,expansions:2});
  expect(()=>source.captureNumericExterior(stages(),oneRail)).toThrow('exhausted');
  expect(rail).toHaveBeenCalledTimes(1);expect(oneRail.snapshot().expansions).toBe(2);
 }finally{foot.mockRestore();rail.mockRestore();}
});

it('reserves before composing the endpoint preference and names unfinished operations',async()=>{
 const x=await setup(),positive={...x.request,stages:stages().map(s=>s.role==='first-rung'?{...s,choices:[s.choices[1]]}:s)};
 const original=PoolCycleSource.prototype.materializeNumericKnot,preference=liveSample.poolIntervalPreference;
 let now=0,afterDenial=0;
 const a=vi.spyOn(PoolCycleSource.prototype,'materializeNumericKnot').mockImplementation(function(this:PoolCycleSource,knot){
  const result=original.call(this,knot);
  if(knot.unit===22000)now=11;
  return result;
 });
 const b=vi.spyOn(liveSample,'poolIntervalPreference').mockImplementation((...args)=>{if(now===11)afterDenial++;return preference(...args);});
 try{
  const result=verifyOwnedPoolNumericSlice(x.input,x.sources,x.definition,positive,{...limits,milliseconds:10},{now:()=>now});
  expect(result.kind).toBe('exhausted');expect(afterDenial).toBe(0);
  if(result.kind==='exhausted')expect(result.details).toMatchObject({unfinished:positive.operationIds,requiredForNewOwner:positive.operationIds,completionPublished:false});
 }finally{a.mockRestore();b.mockRestore();}
});

it('rejects real foreign sole, rail, observation and arithmetic evidence and revokes the disposed issuer',async()=>{
 const x=await setup(),foot=supportProof.derivePoolSupportArithmetic,rail=railProof.derivePoolRailArithmetic;
 type FootArgs=Parameters<typeof foot>;type RailArgs=Parameters<typeof rail>;
 const firstFeet=new Map<string,{args:FootArgs;proof:ReturnType<typeof foot>}>(),firstRails=new Map<string,{args:RailArgs;proof:ReturnType<typeof rail>}>();
 const wrong:{kind:string;refused:boolean;candidateLocal?:boolean}[]=[];
 const tryForeign=(kind:string,f:()=>unknown)=>{
  try{f();wrong.push({kind,refused:false});}
  catch(error){wrong.push({kind,refused:true,candidateLocal:error instanceof PoolTrialRefusal});}
 };
 let attempt=0,retained:(()=>void)|undefined;
 const fp=vi.spyOn(supportProof,'derivePoolSupportArithmetic').mockImplementation((...args:FootArgs)=>{
  const actual=foot(...args),[fixture,surface,cage,pose,patch,support,frame,observation]=args;
  if(!frame||!observation)return actual;
  if(attempt===1)firstFeet.set(patch.part,{args,proof:actual});
  else if(attempt===2){
   const old=firstFeet.get(patch.part)!;
   tryForeign('sole frame',()=>foot(fixture,surface,cage,pose,patch,support,old.args[6],observation));
   tryForeign('replay',()=>foot(fixture,surface,cage,old.args[3],patch,support,frame,observation));
   tryForeign('observation',()=>foot(fixture,surface,cage,pose,patch,support,frame,old.args[7]));
   wrong.push({kind:'sole proof bound',refused:supportProof.poolSupportArithmeticBound(old.proof,actual.part,actual.surface,surface.geometry,observation,undefined,surface)===0});
  }
  return actual;
 });
 const rp=vi.spyOn(railProof,'derivePoolRailArithmetic').mockImplementation((...args:RailArgs)=>{
  const actual=rail(...args),[fixture,surface,cage,pose,patch,support,,observation]=args;
  if(attempt===1)firstRails.set(patch.part,{args,proof:actual});
  else if(attempt===2){
   const old=firstRails.get(patch.part)!;
   tryForeign('rail frame',()=>rail(fixture,surface,cage,pose,patch,support,old.args[6],observation));
   wrong.push({kind:'rail proof bound',refused:railProof.poolRailArithmeticBound(old.proof,actual.part,actual.surface,surface.geometry,observation,undefined,surface)===0});
  }
  return actual;
 });
 const verify=PoolTrialReceipts.prototype.require;
 const receipt=vi.spyOn(PoolTrialReceipts.prototype,'require').mockImplementation(function(this:PoolTrialReceipts,...args){
  verify.call(this,...args);retained=()=>verify.call(this,...args);
 });
 try{
  const result=verifyOwnedPoolNumericSlice(x.input,x.sources,x.definition,x.request,limits,{event:e=>{if(e.kind==='captured')attempt=e.attempt;}});
  expect(result.kind).toBe('admitted-slice');expect(firstFeet.size).toBe(2);expect(firstRails.size).toBe(2);
  expect(wrong).toHaveLength(12);expect(wrong.every(r=>r.refused&&!r.candidateLocal)).toBe(true);
  expect(retained).toBeDefined();expect(retained!).toThrow('disposed');
 }finally{fp.mockRestore();rp.mockRestore();receipt.mockRestore();}
},100_000);

it('classifies different honest active palm vertices as a local refusal and forged endpoints as fatal',async()=>{
 const x=await setup(),src=x.source(),w=new PoolTrialWork(limits);
 const p=[...numericalPoolRecipes(src.captureNumericExterior(stages(),w),w)].find(r=>r.kind==='recipe')!;
 if(p.kind!=='recipe')throw new Error('No real test wrist.');
 const node=src.materializeNumericKnot(p.recipe.knots[0]),control=node.controls[2],a=control.state,g=a.attached!;
 let alternative:typeof a|undefined;
 for(const angle of [.03,-.03,.12,-.12,.3,-.3,.6,-.6,1,-1,1.4,-1.4]){
  const c=Math.cos(angle),s=Math.sin(angle);
  for(const rotation of [[c,s,0,0,-s,c,0,0,0,0,1,0,0,0,0,1],[c,0,-s,0,0,1,0,0,s,0,c,0,0,0,0,1]]){
   const raw=multiply(rotation,g.rawOrientation);
   try{
    const f=resolvePoolRailContactFrame(g.geometry,raw,g.parameter,undefined,g.source);
    if(f.activeVertex!==g.activeVertex){alternative={target:f.translation,orientation:f.orientation,pole:a.pole,
     attached:{...g,rawOrientation:raw,activeVertex:f.activeVertex}};break;}
   }catch(error){if(!(error instanceof PoolTrialRefusal))throw error;}
  }
  if(alternative)break;
 }
 expect(alternative).toBeDefined();const to=alternative!;
 const compose=(b:typeof a)=>interpolatePoolLimbState({...control,from:a,to:b},.5);
 expect(()=>compose(to)).toThrow(PoolTrialRefusal);
 // This index is valid for this actual palm but is the wrong extremum for the promised rotation.
 const falseIndex={...a,attached:{...g,activeVertex:to.attached!.activeVertex}};
 const falseTarget={...a,target:[a.target[0]+.01,a.target[1],a.target[2]] as const};
 const falseOrientation={...a,orientation:to.orientation};
 for(const literal of [falseIndex,falseTarget,falseOrientation])for(const t of [0,1]){
  let error:unknown;
  try{resolvePoolLimbState({...control,from:t===0?literal:a,to:t===1?literal:a},t,g.source);}catch(e){error=e;}
  expect(error).toBeInstanceOf(Error);expect(error).not.toBeInstanceOf(PoolTrialRefusal);
 }
 const forged=structuredClone(p.recipe.knots[0]);
 if(!('grasp' in forged.hands.handL))throw new Error('Missing literal test grasp.');
 forged.hands.handL.grasp.activeVertex=to.attached!.activeVertex;
 let materializationError:unknown;
 try{src.materializeNumericKnot(forged);}catch(e){materializationError=e;}
 expect(materializationError).toBeInstanceOf(Error);expect(materializationError).not.toBeInstanceOf(PoolTrialRefusal);
 for(const corrupt of [{...to,attached:{...to.attached!,activeVertex:Number.MAX_SAFE_INTEGER}},
  {...to,target:[to.target[0]+.01,to.target[1],to.target[2]] as const}]){
  let error:unknown;try{compose(corrupt);}catch(e){error=e;}
  expect(error).toBeInstanceOf(Error);expect(error).not.toBeInstanceOf(PoolTrialRefusal);
 }
},100_000);

const rotation=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
function crestStage(unit:number,choice:Partial<NumericStageRequest['choices'][number]>={}):NumericStageRequest {
 return {unit,role:'crest',places:{footL:'outside3',footR:'crest'},choices:[{
  label:'crest choice',body:body(1.5476002281871861,.9153327234504888,15),...choice,
 }]};
}
type ParserCase={label:string;raw:NumericStageRequest[];error:RegExp};
async function rejectBeforeGeometry(x:Awaited<ReturnType<typeof setup>>,cases:ParserCase[]):Promise<void>{
 const source=x.source(),events:PoolNumericTrialEvent[]=[];
 const mesh=vi.spyOn(meshPlanning,'prepareOwnedPoolMeshPlan'),rig=vi.spyOn(anatomy,'preparePoolEntryAnatomy'),
  foot=vi.spyOn(footFrames,'preparePoolFootContactFrame'),rail=vi.spyOn(railFrames,'preparePoolRailGeometry');
 try{
  for(const c of cases){
   expect(()=>source.captureNumericExterior(c.raw,new PoolTrialWork(limits)),c.label+' (direct)').toThrow(c.error);
   expect(()=>verifyOwnedPoolNumericSlice(x.input,x.sources,x.definition,{...x.request,stages:c.raw},limits,{event:e=>events.push(e)}),c.label+' (owned)').toThrow(c.error);
  }
  expect(mesh).not.toHaveBeenCalled();expect(rig).not.toHaveBeenCalled();
  expect(foot).not.toHaveBeenCalled();expect(rail).not.toHaveBeenCalled();expect(events).toEqual([]);
 }finally{mesh.mockRestore();rig.mockRestore();foot.mockRestore();rail.mockRestore();}
}

it('parses roles, predecessor order, and the acquisition marker against the actual exterior clock before geometry',async()=>{
 const x=await setup(),cases:ParserCase[]=[];
 const change=(label:string,i:number,data:Partial<NumericStageRequest>,error:RegExp)=>{
  const raw=stages();raw[i]={...raw[i],...data};cases.push({label,raw,error});
 };
 change('wrong acquisition unit',0,{unit:4999},/role/);
 change('wrong first-rung unit',1,{unit:11999},/role/);
 change('wrong second-rung unit',2,{unit:22001},/role/);
 change('duplicate acquisition',1,{role:'acquisition'},/role/);
 change('first rung marked crest',1,{role:'crest'},/role/);
 cases.push({label:'missing predecessor',raw:[stages()[0],stages()[2],crestStage(42000)],error:/role/});
 change('acquisition ignored body',0,{choices:[{label:'a',body:original}]},/choice field/);
 change('acquisition ignored relative mode',0,{choices:[{label:'a',relativeToPrevious:false}]},/choice field/);
 change('two acquisition markers',0,{choices:[{label:'a'},{label:'b'}]},/acquisition marker/);
 for(const unit of [32000,41999,44800,45000])cases.push({label:'outside crest range '+unit,raw:[...stages(),crestStage(unit)],error:/role/});
 await rejectBeforeGeometry(x,cases);
 const raw=[...stages(),crestStage(42123)],parsed=parseNumericStages(raw,x.definition,x.sources.fixture,new PoolTrialWork(limits));
 expect(readParsedStages(parsed,x.definition,x.sources.fixture).at(-1)?.unit).toBe(42123);
});

it('matches both named held places and their live required top faces, including takeoff and touchdown',async()=>{
 const x=await setup(),cases:ParserCase[]=[];
 for(const name of ['unknown-rung','toString']){
  const raw=stages();raw[1]={...raw[1],places:{...raw[1].places,footL:name}};
  cases.push({label:name,raw,error:/Unknown numeric pool foot place/});
 }
 const wrong=stages();wrong[1]={...wrong[1],places:{footL:'ground',footR:'ground'}};
 cases.push({label:'left foot already landed at .12',raw:wrong,error:/held top-face place/});
 const leaving=stages();leaving[1]={...leaving[1],places:{footL:'outside1',footR:'outside2'}};
 cases.push({label:'right foot still at takeoff at .12',raw:leaving,error:/held top-face place/});
 const later=[...stages(),crestStage(42123)];later[3]={...later[3],places:{footL:'outside2',footR:'crest'}};
 cases.push({label:'wrong known exterior place',raw:later,error:/held top-face place/});
 await rejectBeforeGeometry(x,cases);
 const alias={...x.definition,places:{...x.definition.places,sameSurface:{...x.definition.places.outside3}}};
 const aliased=crestStage(42123);aliased.places={footL:'sameSurface',footR:'crest'};
 expect(()=>parseNumericStages([...stages(),aliased],alias,x.sources.fixture,new PoolTrialWork(limits))).toThrow(/held top-face place/);
 // Exercise a genuine in-flight foot with a definition-relative exterior start for this parser control.
 const earlierStart={...x.definition,crestRoute:{...x.definition.crestRoute,sampleUnits:[32000,...x.definition.crestRoute.sampleUnits]}};
 const airborne=crestStage(34000);airborne.places={footL:'outside3',footR:'outside2'};
 expect(()=>parseNumericStages([...stages(),airborne],earlierStart,x.sources.fixture,new PoolTrialWork(limits))).toThrow(/held top-face place/);
 const fixture=structuredClone(x.sources.fixture);
 const support=fixture.clips.pool_enter.samples.find(row=>row.phase===.42)!.limbs.footL;
 support.surface=fixture.clips.pool_enter.samples.find(row=>row.phase===.42)!.limbs.footR.surface;
 expect(()=>parseNumericStages([...stages(),crestStage(42000)],x.definition,fixture,new PoolTrialWork(limits))).toThrow(/held top-face place/);
 const parsed=readParsedStages(parseNumericStages(stages(),x.definition,x.sources.fixture,new PoolTrialWork(limits)),x.definition,x.sources.fixture);
 expect(parsed.map(s=>s.places)).toEqual([{footL:'ground',footR:'ground'},{footL:'outside1',footR:'ground'},{footL:'outside1',footR:'outside2'}]);
});

it('uses endpoint contact obligations for release-start and approach-start and forbids ignored rail parameters',async()=>{
 const x=await setup(),cases:ParserCase[]=[];
 const free={offset:[-.1,-.25,-.1] as const,orientation:rotation};
 const acquired=stages();acquired[0]={...acquired[0],choices:[{label:'ignored',parameters:{handL:4.3}}]};
 cases.push({label:'acquired parameter',raw:acquired,error:/choice field/});
 const held=stages();held[1]={...held[1],choices:[{label:'ignored',body:first,parameters:{handR:4.3}}]};
 cases.push({label:'held parameter',raw:held,error:/choice field/});
 for(const unit of [42000,42400])cases.push({label:'required '+unit,raw:[...stages(),crestStage(unit,{freeHands:{handL:{...free,offset:[0,-100,0]}}})],error:/Required numeric wrist cannot be free/});
 for(const unit of [42800,43600]){
  cases.push({label:'omitted free wrist '+unit,raw:[...stages(),crestStage(unit)],error:/Missing free numeric wrist/});
  cases.push({label:'free parameter '+unit,raw:[...stages(),crestStage(unit,{freeHands:{handL:free},parameters:{handL:4.2,handR:4.3}})],error:/cannot also specify a rail parameter/});
 }
 const malformed=crestStage(43600,{freeHands:{handL:free}});
 malformed.choices=[...malformed.choices,{label:'malformed later',body:first}];
 cases.push({label:'later invalid alternative',raw:[...stages(),malformed],error:/Missing free numeric wrist/});
 await rejectBeforeGeometry(x,cases);
 const legal=crestStage(43600,{freeHands:{handL:free},parameters:{handR:4.3}});
 const commands=readParsedStages(parseNumericStages([...stages(),legal],x.definition,x.sources.fixture,new PoolTrialWork(limits)),x.definition,x.sources.fixture).at(-1)!.choices[0].hands;
 expect(commands.handL.kind).toBe('free');expect(commands.handR).toMatchObject({kind:'rail',parameter:4.3});
 const narrower=structuredClone(x.sources.fixture);
 narrower.clips.pool_enter.samples.find(s=>s.phase===.436)!.limbs.handR.region={kind:'rail',parameter:[4.375,4.5]};
 expect(()=>parseNumericStages([...stages(),legal],x.definition,narrower,new PoolTrialWork(limits))).toThrow(/rail parameter/);
 const within=crestStage(43600,{freeHands:{handL:free},parameters:{handR:4.4}});
 expect(()=>parseNumericStages([...stages(),within],x.definition,narrower,new PoolTrialWork(limits))).not.toThrow();
});

it('rejects scale and shear as raw commands while a valid but distant free wrist leaves later choices available',async()=>{
 const x=await setup(),cases:ParserCase[]=[];
 const scale=[...rotation],shear=[...rotation];scale[0]=2;scale[5]=.5;shear[4]=.25;
 for(const [label,matrix] of [['scale',scale],['shear',shear]] as const){
  const stage=crestStage(42800,{freeHands:{handL:{offset:[0,-100,0],orientation:matrix}}});
  cases.push({label,raw:[...stages(),stage],error:/rigid segment lengths/});
 }
 await rejectBeforeGeometry(x,cases);
 const stage=crestStage(42800,{freeHands:{handL:{offset:[0,-100,0],orientation:rotation}}});
 const quarterTurn=[0,1,0,0,-1,0,0,0,0,0,1,0,0,0,0,1];
 stage.choices=[...stage.choices,{label:'later attainable',body:body(1.5476002281871861,.9153327234504888,15),
  freeHands:{handL:{offset:[-.1,-.25,-.1],orientation:quarterTurn}},parameters:{handR:4.227184871568798}}];
 const fixed=stages();fixed[1]={...fixed[1],choices:[fixed[1].choices[1]]};
 const result=verifyOwnedPoolNumericSlice(x.input,x.sources,x.definition,{...x.request,stages:[...fixed,stage]},limits);
 expect(result.kind).toBe('admitted-slice');
 if(result.kind==='admitted-slice'){
  expect(result.rejected.some(r=>r.attempt===0&&r.reason.includes('free goal'))).toBe(true);
  const left=result.recipe.knots.at(-1)!.hands.handL;
  expect('freeTarget' in left&&left.orientation).toEqual(quarterTurn);
 }
},100_000);
