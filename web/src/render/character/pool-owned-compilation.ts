import type {PlantedStep} from './pool-planted-step.js';
import {openingAt,openingSegments,requireSelectedPoolRecipe,openingPolicy,requireOpeningDefinition,type PoolOpeningRequest,type OpeningFlight,type ExteriorToe,type ParsedOpening} from './pool-opening-flight.js';
import {requirePoolRailContactFrame} from './pool-rail-contact-frame.js';
import {parseNumericStages,type ParsedNumericStages} from './pool-numeric-stages.js';
import {prepareOwnedPoolMeshPlan,type PoolOwnedPartPlan} from './pool-mesh-planning.js';
export type {PoolOwnedPartPlan} from './pool-mesh-planning.js';
import type {Bundle,Geometry} from './bundle.js';
import {selectNumericPoolAnchors,expandSelectedPoolRecipes,validateNumericKnot,type NumericRecipe,type NumericStageRequest} from './pool-numeric-recipe.js';
import {poolReplaySchedule,type PoolReplayJob} from './pool-replay-schedule.js';
import {PoolTrialReceipts,PoolTrialRefusal,PoolTrialStopped,PoolTrialWork,type PoolTrialLimits} from './pool-trial-work.js';
import type {ShapeParameters} from './shape.js';
import type {PoolFixtureV1,PoolContactInputV1,PoolContactArtifactV1,PoolPreparedTrack,PoolPreparedInterval,PoolIntervalObservation,PoolArithmeticContactRecord,PoolLimb} from './pool-contact-types.js';
import {POOL_SOLVER_REVISION,POOL_OBSERVER_REVISION,POOL_INTERPOLATION_REVISION} from './pool-contact-types.js';
import {PoolCycleSource,validatePoolCycleDefinition,type PoolCycleDefinition,type PoolFoot} from './pool-cycle-source.js';
import {poolIntervalProgramControls,type PoolPoseProgram} from './pool-pose-program.js';
import {poolIntervalPreference,interpolatePoolPoseProgram,poolSkinMatrices} from './pool-contact-sample.js';
import {resolvePoolLimbState,evaluatePoolLimb} from './pool-contact-evaluator.js';
import {requirePoolFootClearanceReference,requirePoolFootContactFrame,type PoolFootContactFrame} from './pool-foot-contact-frame.js';
import {solvePoolOrientedFoot,observeConstructedPoolLeg} from './pool-oriented-leg.js';
import {solvePoolFreeLeg,observeConstructedPoolFreeLeg} from './pool-free-leg.js';
import {solveCertifiedPoolRail} from './pool-rail-construction-arithmetic.js';
import {solvePoolHierarchyLimb,type PoolHierarchy} from './pool-canonical-pose.js';
import {configuredPoolChainReach} from './pool-entry-domain.js';
import {posedCageSurface} from './geometry-proof.js';
import {observeOwnedPoolPhysicalSource,observePoolSource,type PoolObservation,type PoolSurfaceInput} from './pool-observer.js';
import {derivePoolSupportArithmetic,derivePoolApproachClearanceArithmetic,type PoolContactArithmetic} from './pool-support-arithmetic.js';
import {derivePoolRailArithmetic} from './pool-rail-support-arithmetic.js';
import {observePoolPatchSupports} from './pool-support-observer.js';
import {poolSourceRecord,poolSourcePolicy,poolSourceEvents,requirePoolPolicyEqual,requirePoolPolicyInterval,POOL_LIMBS,type PoolSourceLocation} from './pool-source-policy.js';
import {canonicalPoolValue,poolPartKey,poolShapeIdentity} from './pool-contact-identity.js';
import {validatePoolContactArtifact,validatePoolContactInput,validatePoolFixture} from './pool-contact-protocol.js';
import type {PoolRailContactFrame} from './pool-rail-contact-frame.js';
import type {PreparedPoolPatch} from './pool-contact-patch.js';
import {sub,length,type Vec3} from './math.js';

import {poolCycleCoverage,type PoolCycleDiagnostic} from './pool-cycle-compiler.js';
import {restoreErrorDetails,serializeErrorDetails} from '../../diagnostics/error-details.js';

interface PoolCycleInputs {
 readonly bundle:Bundle;readonly shape:ShapeParameters;readonly top:number;
 readonly geometry:readonly Geometry[];readonly fixture:PoolFixtureV1;
}
type Diagnostic=(row:PoolCycleDiagnostic)=>void;
export interface PoolOwnedCompilationCounters {
 copiedBytes:number;exactCoefficientBuilds:number;roundedCoefficientBuilds:number;topologyTriangles:number;
 dependencyPlans:number;arithmeticRuns:number;fullBufferChecks:number;
 tailForwardPolicies:number;tailForwardEvaluations:number;tailReversePolicies:number;tailReverseEvaluations:number;tailComparisons:number;
}
type Counter=keyof PoolOwnedCompilationCounters;

const typedArrayPrototype=Object.getPrototypeOf(Float32Array.prototype) as object;
const viewBuffer=Object.getOwnPropertyDescriptor(typedArrayPrototype,'buffer')!.get!;
const viewOffset=Object.getOwnPropertyDescriptor(typedArrayPrototype,'byteOffset')!.get!;
const viewLength=Object.getOwnPropertyDescriptor(typedArrayPrototype,'byteLength')!.get!;
const viewType=Object.getOwnPropertyDescriptor(typedArrayPrototype,Symbol.toStringTag)!.get!;
const bufferLength=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength')!.get!;
const typedViews=[Float32Array.prototype,Uint32Array.prototype];

function copyInputs<T>(root:T,counters:PoolOwnedCompilationCounters):T {
 const copies=new WeakMap<object,object>();
 const bytes=(buffer:ArrayBuffer,offset:number,length:number)=>{
  if(Object.getPrototypeOf(buffer)!==ArrayBuffer.prototype)throw new Error('Pool capture refuses shared or unsupported backing memory.');
  try{Reflect.apply(bufferLength,buffer,[]);}catch{throw new Error('Pool capture refuses shared or unsupported backing memory.');}
  const result=new Uint8Array(length);result.set(new Uint8Array(buffer,offset,length));counters.copiedBytes+=length;
  return result.buffer;
 };
 const copy=(value:unknown):unknown=>{
  if(value===null||value===undefined||typeof value==='string'||typeof value==='boolean'||typeof value==='number')return value;
  if(typeof value!=='object')throw new Error('Pool capture requires plain data.');
  const existing=copies.get(value);if(existing)return existing;
  const prototype=Object.getPrototypeOf(value);
  if(ArrayBuffer.isView(value)){
   const kind=prototype===Float32Array.prototype?'Float32Array':'Uint32Array';
   if(!typedViews.includes(prototype)||Reflect.apply(viewType,value,[])!==kind)throw new Error('Pool capture encountered an unsupported typed view.');
   const length=Reflect.apply(viewLength,value,[]) as number;
   if(Reflect.ownKeys(value).length!==length/4)throw new Error('Pool capture refuses custom typed-view descriptors.');
   const buffer=bytes(Reflect.apply(viewBuffer,value,[]),Reflect.apply(viewOffset,value,[]),length);
   const result=prototype===Float32Array.prototype?new Float32Array(buffer):new Uint32Array(buffer);
   copies.set(value,result);return result;
  }
  if(prototype===ArrayBuffer.prototype){
   let length:number;
   try{length=Reflect.apply(bufferLength,value,[]);}catch{throw new Error('Pool capture encountered an unsupported buffer.');}
   if(Reflect.ownKeys(value).length)throw new Error('Pool capture refuses custom buffer descriptors.');
   const result=bytes(value as ArrayBuffer,0,length);copies.set(value,result);return result;
  }
  if(typeof SharedArrayBuffer!=='undefined'&&prototype===SharedArrayBuffer.prototype)throw new Error('Pool capture refuses shared backing memory.');
  const array=Array.isArray(value);
  if(array?prototype!==Array.prototype:prototype!==Object.prototype&&prototype!==null)throw new Error('Pool capture encountered an unsupported data record or view.');
  const result:object=array?[]:Object.create(null);
  copies.set(value,result);
  for(const key of Reflect.ownKeys(value)){
   const descriptor=Object.getOwnPropertyDescriptor(value,key);
   if(!descriptor||!('value' in descriptor))throw new Error('Pool capture refuses accessor descriptors.');
   if(typeof key!=='string')throw new Error('Pool capture refuses symbol descriptors.');
   if(array&&key==='length')continue;
   Object.defineProperty(result,key,{value:copy(descriptor.value),enumerable:descriptor.enumerable,writable:true,configurable:true});
  }
  if(array)(result as unknown[]).length=Object.getOwnPropertyDescriptor(value,'length')!.value;
  return Object.freeze(result);
 };
 return copy(root) as T;
}

interface ObservationOwner {readonly identity:object;readonly rows:readonly PoolSurfaceInput[];readonly replay:PoolHierarchy;observation?:PoolObservation}
const staticOwners=new WeakMap<object,PoolOwnedCompilation>();

class PoolOwnedCompilation {
 readonly identity=Object.freeze({});
 readonly parsedStages?:ParsedNumericStages;
 readonly numericJobs?:readonly PoolReplayJob[];
 private numericReceipts?:PoolTrialReceipts;
 private disposed=false;
 issueNumericReceipts():PoolTrialReceipts {
  if(this.disposed)throw new Error('Pool receipt owner has been disposed.');
  return this.numericReceipts??=new PoolTrialReceipts(this.identity);
 }
 readonly counters:PoolOwnedCompilationCounters={copiedBytes:0,exactCoefficientBuilds:0,roundedCoefficientBuilds:0,topologyTriangles:0,dependencyPlans:0,arithmeticRuns:0,fullBufferChecks:0,
  tailForwardPolicies:0,tailForwardEvaluations:0,tailReversePolicies:0,tailReverseEvaluations:0,tailComparisons:0};
 readonly captured;
 readonly parts=new WeakMap<Geometry,readonly PoolOwnedPartPlan[]>();
 readonly cages=new WeakMap<Geometry,Float32Array<ArrayBuffer>>();
 readonly rigKeys=new WeakMap<Bundle,string>();
 readonly patches=new WeakSet<PreparedPoolPatch>();
 readonly physicalKey:string;
 private readonly members=new Set<object>();
 rest?:readonly (readonly number[])[];
 inverse?:readonly (readonly number[])[];
 active?:ObservationOwner;

 constructor(input:PoolContactInputV1,sources:PoolCycleInputs,definition:PoolCycleDefinition,extras?:{numericRequest?:PoolNumericSliceRequest;numericRecipe?:NumericRecipe;numericSelection?:NumericRecipe;numericPlants?:readonly PlantedStep[];numericOpening?:ParsedOpening},work?:PoolTrialWork,onScheduled?:(jobs:readonly PoolReplayJob[])=>void){
  this.captured=copyInputs({input,sources,definition,...extras},this.counters);
  const captured=this.captured.sources,{bundle,shape,top,geometry,fixture}=captured;
  validatePoolContactInput(this.captured.input);validatePoolCycleDefinition(this.captured.definition);
  validatePoolContactInput(this.captured.input);validatePoolCycleDefinition(this.captured.definition);
  validatePoolFixture(fixture);
  const def=this.captured.definition;
  if(this.captured.numericRecipe)for(const knot of this.captured.numericRecipe.knots){
   validateNumericKnot(knot,def.clockUnits,def.hand.outsideBranch);
   for(const limb of ['footL','footR'] as const){
    const foot=knot.feet[limb];if(!('flight' in foot))continue;
    const bound=openingAt(this.captured.numericOpening,knot.unit);
    if(!bound||canonicalPoolValue(bound.flight)!==canonicalPoolValue(foot.flight)||!bound.units.includes(knot.unit)||knot.unit<=bound.flight.startUnit||knot.unit>=bound.flight.endUnit||limb!==bound.flight.limb)
     throw new Error('Numerical flight is not bound to the selected source transfer.');
   }
  }
  if(this.captured.numericRecipe){
   if(!this.captured.numericSelection)throw new Error('No independent numeric selection.');
   requireSelectedPoolRecipe(this.captured.numericRecipe,this.captured.numericSelection,this.captured.numericOpening,this.captured.numericPlants,work);
  }
  if(this.captured.numericRequest){
   if(!work)throw new Error('Numeric pool stages require a preparation budget.');
   this.parsedStages=parseNumericStages(this.captured.numericRequest.stages,def,fixture,work,this.captured.numericRequest.opening);
   this.numericJobs=selectNumericJobs(fixture,def,this.captured.numericRequest,this.parsedStages.opening);
   onScheduled?.(this.numericJobs);
  }
  const appearance=this.captured.input.appearance;
  if(!Number.isFinite(top)||top<=0||poolShapeIdentity(shape,top)!==poolShapeIdentity({presentation:appearance.presentation,...appearance.body,face:appearance.face},top))throw new Error('Pool capture shape differs from the requested appearance.');
  if(geometry.length!==2)throw new Error('Pool capture requires the complete selected body and swimwear.');
  for(const mesh of geometry){
   work?.reserve('plan selected pool mesh',{expansions:1});
   this.parts.set(mesh,prepareOwnedPoolMeshPlan(mesh,bundle,this.counters));
  }
  this.physicalKey=canonicalPoolValue({ground:fixture.ground,solids:fixture.solids,revisions:fixture.revisions});
  for(const rig of new Set([bundle,...geometry.map(mesh=>mesh.manifest)]))this.rigKeys.set(rig,canonicalPoolValue({sourceSha256:rig.sourceSha256,bones:rig.bones}));
  for(const value of [bundle,shape,fixture,...geometry,...geometry.map(mesh=>mesh.manifest)])this.own(value);
 }

 configure(source:PoolCycleSource):void {
  if(this.rest||this.inverse)throw new Error('Pool compilation already has an active source.');
  source.geometry.forEach((geometry,index)=>{const cage=source.cages[index];this.cages.set(geometry,cage);this.own(cage);});
  sealMatrices(source.neutral.rest);sealMatrices(source.neutral.inverse);
  this.rest=source.neutral.rest;this.inverse=source.neutral.inverse;
  for(const anatomy of Object.values(source.anatomy))for(const patch of [anatomy.patch,anatomy.front,anatomy.back]){
   if(patch){this.patches.add(patch);this.own(patch);}
  }
 }

 private own(member:object):void {staticOwners.set(member,this);this.members.add(member);}
 dispose():void {
  this.disposed=true;this.numericReceipts?.revoke();
  this.active=undefined;
  for(const member of this.members)staticOwners.delete(member);
  this.members.clear();
 }
}

function sealMatrices(matrices:number[][]):void {matrices.forEach(matrix=>Object.freeze(matrix));Object.freeze(matrices);}

function sameDataset(members:readonly object[]):PoolOwnedCompilation|undefined {
 const owners=members.map(member=>staticOwners.get(member)),owner=owners.find(value=>value!==undefined);
 if(owner&&owners.some(value=>value!==owner))throw new Error('Pool physical inputs belong to different datasets.');
 return owner;
}

export function poolOwnedStaticIdentity(...members:object[]):object|undefined {return sameDataset(members)?.identity;}
export function poolOwnedFixtureKey(fixture:PoolFixtureV1):string|undefined {
 const owner=staticOwners.get(fixture);return owner?.captured.sources.fixture===fixture?owner.physicalKey:undefined;
}
export function poolOwnedRigKey(bundle:Bundle):string|undefined {return staticOwners.get(bundle)?.rigKeys.get(bundle);}
export function poolOwnedParts(geometry:Geometry):readonly PoolOwnedPartPlan[]|undefined {return staticOwners.get(geometry)?.parts.get(geometry);}
export function countPoolOwnedWork(member:object,counter:Counter,amount=1):void {
 const owner=staticOwners.get(member);if(owner)owner.counters[counter]+=amount;
}

export function poolOwnedConfiguredIdentity(geometry:Geometry,cage:Float32Array<ArrayBuffer>,inverse?:readonly number[],bone?:number,patch?:PreparedPoolPatch):object|undefined {
 const owner=staticOwners.get(geometry),cageOwner=staticOwners.get(cage);
 if(cageOwner&&cageOwner!==owner)throw new Error('Pool configured inputs belong to different datasets.');
 if(!owner?.inverse)return undefined;
 if(owner.cages.get(geometry)!==cage||inverse&&owner.inverse[bone!]!==inverse||patch&&!owner.patches.has(patch))throw new Error('Pool configured inputs belong to different datasets.');
 return owner.identity;
}

export function poolOwnedObservationIdentity(fixture:PoolFixtureV1,observation:PoolObservation):object|undefined {
 const active=staticOwners.get(fixture)?.active;
 return active&&active.observation===observation?active.identity:undefined;
}

export function requirePoolArithmeticReplay(fixture:PoolFixtureV1,observation:PoolObservation,geometry:Geometry,cage:Float32Array<ArrayBuffer>,pose:PoolHierarchy):object|undefined {
 const owner=staticOwners.get(fixture),active=owner?.active;
 if(!owner||!active||active.observation!==observation)return undefined;
 if(active.replay!==pose||owner.captured.sources.bundle!==pose.bundle||owner.rest!==pose.rest||owner.inverse!==pose.inverse||owner.cages.get(geometry)!==cage)
  throw new Error('Pool arithmetic requires its actual sealed replay pose and configured inputs.');
 return active.identity;
}

export function poolOwnsArithmeticPose(geometry:Geometry,cage:Float32Array<ArrayBuffer>,world:readonly number[][],inverse:readonly number[][]):boolean {
 const identity=poolOwnedConfiguredIdentity(geometry,cage),owner=staticOwners.get(geometry);
 return Boolean(identity&&owner&&owner.active?.replay.world===world&&owner.inverse===inverse);
}

export function poolOwnsObservationRows(fixture:PoolFixtureV1,rows:readonly PoolSurfaceInput[]):boolean {
 const owner=sameDataset([fixture,...rows.map(row=>row.geometry)]);
 if(!owner)return false;
 if(owner.captured.sources.fixture!==fixture||owner.active?.rows!==rows)throw new Error('Pool observation rows do not belong to this active dataset.');
 return true;
}

function detachedError(value:unknown):unknown {return restoreErrorDetails(serializeErrorDetails(value),'Pool compilation failed.');}

/** Capture the physical inputs before constructing the source or invoking diagnostics. */
export function compileOwnedPoolCycle(input:PoolContactInputV1,sources:PoolCycleInputs,definition:PoolCycleDefinition,diagnostic?:Diagnostic,counters?:(summary:PoolOwnedCompilationCounters)=>void):PoolContactArtifactV1 {
 const owner=new PoolOwnedCompilation(input,sources,definition),captured=owner.captured;
 const {bundle,shape,top,geometry,fixture}=captured.sources;
 const emit=diagnostic?(row:PoolCycleDiagnostic)=>{
  const {error,...values}=row,copy:PoolCycleDiagnostic=structuredClone(values);
  if(error)copy.error=detachedError(error) as Error;
  diagnostic(copy);
 }:undefined;
 try{
  return structuredClone(compileCycle(captured.input,bundle,shape,top,geometry,fixture,captured.definition,emit,owner));
 }catch(error){throw detachedError(error);}
 finally{owner.dispose();counters?.({...owner.counters});}
}

export function compileRawPoolCycle(input:PoolContactInputV1,bundle:Bundle,shape:ShapeParameters,top:number,geometry:readonly Geometry[],fixture:PoolFixtureV1,definition:PoolCycleDefinition,diagnostic?:Diagnostic):PoolContactArtifactV1 {
 return compileCycle(input,bundle,shape,top,geometry,fixture,definition,diagnostic);
}

export interface PoolNumericSliceRequest {
  readonly stages:readonly NumericStageRequest[];readonly opening?:PoolOpeningRequest;readonly operationIds?:readonly string[];readonly entryRange?:readonly [number,number];
}
export interface PoolNumericTrialEvent {kind:'prepared-endpoints'|'released-endpoints'|'captured'|'disposed'|'proposed'|'unavailable'|'observed'|'refused';attempt:number;id?:string}
function selectNumericJobs(fixture:PoolFixtureV1,definition:PoolCycleDefinition,wanted:PoolNumericSliceRequest,opening?:ParsedOpening):readonly PoolReplayJob[] {
 if('sourceUnits' in wanted)throw new Error('Additional pool cuts must be bound to actual numerical recipe knots.');
 const toe=opening?.next?.outgoingToe;
 const cuts=[...(toe?[{unit:toe.firstUnit},{unit:toe.secondUnit}]:[]),...wanted.stages,...openingSegments(opening).flatMap(s=>s.units.map(unit=>({unit})))];
 const schedule=poolReplaySchedule(fixture,definition,cuts);
 if((wanted.entryRange===undefined)===(wanted.operationIds===undefined))throw new Error('Choose a numeric entry range or individual operations.');
 let jobs:readonly PoolReplayJob[];
 if(wanted.entryRange!==undefined){
  const [lo,hi]=wanted.entryRange;
  if(wanted.entryRange.length!==2||!schedule.entryUnits.includes(lo)||!schedule.entryUnits.includes(hi)||lo>hi)throw new Error('Unknown numeric entry window.');
  jobs=schedule.jobs.filter(j=>j.action==='pool_enter'&&Number(j.left.slice(6))>=lo&&Number(j.right.slice(6))<=hi);
 }else{
  const requested=new Set(wanted.operationIds);
  jobs=schedule.jobs.filter(j=>requested.has(j.id));
  if(jobs.length!==requested.size||requested.size!==wanted.operationIds!.length)throw new Error('Numeric slice contains an unknown or duplicate operation.');
 }
 const sharedPaddleRef='entry/'+definition.clockUnits;
 const stationaryBridge=(j:PoolReplayJob)=>j.action==='pool_exit_0'&&j.left===sharedPaddleRef&&j.right===sharedPaddleRef&&j.kind!=='reverse';
 if(!jobs.length||jobs.some(j=>(j.action!=='pool_enter'&&!stationaryBridge(j))||j.kind==='reverse'))throw new Error('Unsupported numeric slice operation.');
 const declared=new Set(cuts.map(s=>'entry/'+s.unit));
 if(jobs.some(j=>!stationaryBridge(j)&&(!declared.has(j.left)||!declared.has(j.right))))throw new Error('Numeric slice lacks a declared incident knot.');
 return jobs;
}

type SliceRejection={attempt:number;reason:string;cause?:unknown};
export type PoolNumericSliceResult=
  |{kind:'admitted-slice';recipe:NumericRecipe;completed:string[];openingSamples?:{job:string;phase:number;hips:Vec3;leftAnkle:Vec3;rightAnkle:Vec3;leftWrist:Vec3;rightWrist:Vec3}[];maintained:{job:string;limb:PoolFoot;branch:number}[];rejected:SliceRejection[];published:false}
  |{kind:'no-candidate';rejected:SliceRejection[];published:false}
  |{kind:'cancelled'|'exhausted';reason:string;details:unknown;published:false};

/** Derive the maintained branch from this owner's actual selected endpoint foot frames, independently of authored path caches. */
function numericEndpointBranches(source:PoolCycleSource,node:PoolPoseProgram,phase:number,work:PoolTrialWork):Map<PoolFoot,number>{
 work.reserve('prepare selected endpoint hierarchy',{expansions:1});
 const record=poolSourceRecord(source.fixture,{action:'pool_enter',phase}),branches=new Map<PoolFoot,number>();
 const posed=poolIntervalPreference(source.bundle,source.neutral.rest,source.neutral.inverse,node.preferenceBasis,node.preferenceBasis,0,true);
 for(const limb of ['footL','footR'] as const)if(node.policy[limb].required){
  work.reserve('derive selected endpoint hinge '+limb,{expansions:1});
  const a=source.anatomy[limb],control=node.controls.find(c=>c.end===a.end);
  if(!control||control.legFrame!=='source-entry-0')throw new Error('Pool numerical endpoint has no maintained leg control.');
  const frame=source.frame(limb,record.limbs[limb],[control.state.target[0],control.state.target[1]]);
  const hinge=solvePoolOrientedFoot(posed,a.upper,a.lower,a.end,frame);
  branches.set(limb,observeConstructedPoolLeg(posed,frame,hinge).branch);
 }
 return branches;
}

function authenticateOpeningSample(source:PoolCycleSource,left:PoolPoseProgram,right:PoolPoseProgram,t:number,location:PoolSourceLocation,
 flight:OpeningFlight,work:PoolTrialWork,toe?:ExteriorToe):void {
 requireOpeningDefinition(flight,source.definition);
 const support=openingPolicy(flight,source.fixture,source.definition,location.phase,toe),policy=poolSourcePolicy(source.fixture,location.action,location.phase);
 work.reserve('authenticate opening control frames',{expansions:1});
 const {bundle,neutral,fixture,geometry,cages}=source;
 const pose=poolIntervalPreference(bundle,neutral.rest,neutral.inverse,left.preferenceBasis,right.preferenceBasis,t,true);
 const reaches:{limb:PoolLimb;distance:number;minimum:number;maximum:number}[]=[];
 let approach:{frame:PoolFootContactFrame;target:Vec3;orientation:readonly number[];end:number}|undefined;
 const controls=poolIntervalProgramControls(left,right),seen=new Set<PoolLimb>();
 if(controls.length!==4)throw new Error('Opening replay requires four distinct limb controls.');
 for(const c of controls){
  const limb=bundle.bones[c.end].name.replace('.','') as PoolLimb,a=source.anatomy[limb],s=support[limb];
  if(!a||seen.has(limb)||a.upper!==c.upper||a.lower!==c.lower||a.end!==c.end||!same(c.anchor,[0,0,0,1]))throw new Error('Opening replay has invalid control ownership.');
  seen.add(limb);
  const patch=source.patch(limb,s),resolved=resolvePoolLimbState(c,t,location),state=resolved.state;
  if(limb==='footL'||limb==='footR'){
   if(c.legFrame!=='source-entry-0')throw new Error('Opening foot lost its configured hinge.');
   if(policy[limb].required||s.mode==='approach'){
    const f=source.frame(limb,s,[state.target[0],state.target[1]]);
    requirePoolFootContactFrame(f,fixture,geometry[0],cages[0],patch,neutral.inverse[a.end],s,bundle);
    if(!same(f.orientation,state.orientation))throw new Error('Opening foot changed its contact rotation.');
    if(policy[limb].required){if(!same(f.translation,state.target))throw new Error('Opening support target differs from its actual frame.');}
    else {
     if(!same(c.from.orientation,c.to.orientation))throw new Error('Opening approach changes its configured reference rotation.');
     approach={frame:f,target:state.target,orientation:state.orientation,end:a.end};
    }
   }
  }else{
   if(!resolved.railFrame)throw new Error('Opening wrist lacks its required actual attachment.');
   requirePoolRailContactFrame(resolved.railFrame,fixture,geometry[0],cages[0],patch,neutral.inverse[a.end],s);
  }
  const reach=configuredPoolChainReach(neutral.rest,a.upper,a.lower,a.end);
  const distance=length(sub(state.target,point(pose.world[a.upper])));
  if(!Number.isFinite(distance))throw new Error('Invalid opening reach calculation.');
  reaches.push({limb,distance,minimum:reach.minimum,maximum:reach.maximum});
 }
 // Only classify geometric refusals after every control has authenticated the current fixture/owner/phase.
 if(approach)requirePoolFootClearanceReference(approach.frame,approach.target,approach.orientation,neutral.inverse[approach.end],bundle,
  reason=>new PoolTrialRefusal(reason.message,{cause:reason}));
 for(const r of reaches)if(r.distance<=r.minimum||r.distance>=r.maximum)
  throw new PoolTrialRefusal('Opening limb is outside configured reach: '+r.limb,{cause:{...r,...location}});
}

/** Exercise the real captured dataset and observer for specified entry schedule operations. This entry point never publishes a graph. */
export function verifyOwnedPoolNumericSlice(input:PoolContactInputV1,sources:PoolCycleInputs,definition:PoolCycleDefinition,request:PoolNumericSliceRequest,
 limits:PoolTrialLimits,options:{signal?:AbortSignal;event?:(event:PoolNumericTrialEvent)=>void;now?:()=>number}={}):PoolNumericSliceResult {
 let inCallback=false;
 const callExternal=<T>(callback:()=>T):T=>{
  try{return callback();}
  catch(error){inCallback=true;throw error;}
 };
 const clock=options.now;
 const work=new PoolTrialWork(limits,options.signal,clock?()=>callExternal(clock):undefined);
 const emit=(event:PoolNumericTrialEvent)=>{
  if(options.event)callExternal(()=>options.event!(event));
 };
 const typed=(error:unknown):error is PoolTrialRefusal=>!inCallback&&error instanceof PoolTrialRefusal;
 const rejected:SliceRejection[]=[];
 let pending:Set<string>|undefined,required:readonly string[]|undefined;
 try{
  work.reserve('capture numeric proposal inputs',{captures:1});
  const factory=new PoolOwnedCompilation(input,sources,definition,{numericRequest:request},work,jobs=>{
   required=jobs.map(j=>j.id);pending=new Set(required);
  }),stable=factory.captured;
  const prepared=(()=>{
   try{
    if(stable.definition.version!==16)throw new Error('The numerical pool slice requires v16.');
    const fixture=stable.sources.fixture,jobs=factory.numericJobs!;
    work.reserve('configure proposal rig',{expansions:1});
    const {bundle,shape,top,geometry}=stable.sources,source=new PoolCycleSource(bundle,shape,top,geometry,fixture,stable.definition,work);
    factory.configure(source);emit({kind:'captured',attempt:0});
    return {jobs,geometry:source.captureParsedNumericExterior(factory.parsedStages!,work),opening:factory.parsedStages!.opening};
   }catch(error){if(!typed(error))throw error;rejected.push({attempt:0,reason:error.message,cause:error.cause});return undefined;}
   finally{factory.dispose();}
  })();
  emit({kind:'disposed',attempt:0});
  if(prepared){
   let attempt=0;
   for(const selected of selectNumericPoolAnchors(prepared.geometry,work)){
    if(selected.kind==='unavailable'){rejected.push({attempt:0,reason:selected.reason,cause:{unit:selected.unit}});emit({kind:'unavailable',attempt:0});continue;}
    const plants:PlantedStep[]=[];
    if(prepared.opening?.next){
     work.reserve('capture selected planted endpoint owner',{captures:1});
     const preparation=new PoolOwnedCompilation(stable.input,stable.sources,stable.definition,undefined,work);
     try{
      const {sources,definition}=preparation.captured,{bundle,shape,top,geometry,fixture}=sources;
      work.reserve('configure selected endpoint source',{expansions:1});
      const src=new PoolCycleSource(bundle,shape,top,geometry,fixture,definition,work);
      preparation.configure(src);
      for(const segment of openingSegments(prepared.opening))plants.push(src.preparePlantedStep(segment,selected.recipe.knots,work));
      emit({kind:'prepared-endpoints',attempt:attempt+1});
     }catch(error){
      if(!typed(error))throw error;
      rejected.push({attempt:0,reason:error.message,cause:error.cause});emit({kind:'unavailable',attempt:0});continue;
     }finally{preparation.dispose();emit({kind:'released-endpoints',attempt:attempt+1});}
    }
    if(plants.length)work.reserve('isolate the planted input to expansion',{expansions:1});
    const expansionPlants=plants.length?structuredClone(plants):plants;
    for(const proposal of expandSelectedPoolRecipes(prepared.geometry,work,selected.recipe,expansionPlants)){
    attempt++;pending=new Set(prepared.jobs.map(j=>j.id));emit({kind:'proposed',attempt});
    work.reserve('capture complete candidate '+attempt,{captures:1});
    const owner=new PoolOwnedCompilation(stable.input,stable.sources,stable.definition,{numericRecipe:proposal.recipe,numericSelection:selected.recipe,numericPlants:plants,...(prepared.opening?{numericOpening:prepared.opening}:{})},work);
    const result=(()=>{
     try{
      const captured=owner.captured,{bundle,shape,top,geometry,fixture}=captured.sources;
      work.reserve('configure trial source',{expansions:1});
      const source=new PoolCycleSource(bundle,shape,top,geometry,fixture,captured.definition,work);
      owner.configure(source);emit({kind:'captured',attempt});
      const receipts=owner.issueNumericReceipts();
      const nodes=new Map<string,{program:PoolPoseProgram;phase:number;branches?:Map<PoolFoot,number>}>();
      for(const knot of captured.numericRecipe!.knots){
       work.reserve('materialize '+knot.ref,{expansions:1});
       nodes.set(knot.ref,{program:source.materializeNumericKnot(knot,knot.unit===prepared.opening?.next?.flight.endUnit),phase:knot.unit/captured.definition.clockUnits});
      }
      const toe=prepared.opening?.next?.outgoingToe;
      if(toe){
       const start=nodes.get('entry/'+toe.startUnit)!.program;
       for(const unit of [toe.firstUnit,toe.secondUnit])nodes.set('entry/'+unit,{program:source.materializeExteriorToe(start,toe,unit,work),phase:unit/captured.definition.clockUnits});
      }
      if(prepared.jobs.some(j=>j.action==='pool_exit_0')){
       work.reserve('materialize existing common paddle/bridge endpoint',{expansions:1});
       const program=source.paddle(0);
       if(program!==source.entry(1)||program!==source.paddle(1))throw new Error('Pool stationary bridge no longer shares its actual paddle join.');
       nodes.set('entry/'+captured.definition.clockUnits,{program,phase:1});
      }
      const maintained:{job:string;limb:PoolFoot;branch:number}[]=[];
      const openingSamples:{job:string;phase:number;hips:Vec3;leftAnkle:Vec3;rightAnkle:Vec3;leftWrist:Vec3;rightWrist:Vec3}[]=[];
      const observed:{job:PoolReplayJob;left:PoolPoseProgram;right:PoolPoseProgram;measurement:CompactObservation}[]=[];
      for(const job of prepared.jobs){
       const a=nodes.get(job.left)!,b=nodes.get(job.right)!;
       a.branches??=numericEndpointBranches(source,a.program,a.phase,work);
       b.branches??=numericEndpointBranches(source,b.program,b.phase,work);
       work.reserve('physical operation '+job.id,{observations:1});
       try{
        const location={action:job.action,phase:job.phase},opening=openingSegments(prepared.opening).find(s=>job.phase>=s.flight.startUnit/source.definition.clockUnits&&job.phase<=s.flight.endUnit/source.definition.clockUnits)?.flight;
        const flight=opening&&location.action==='pool_enter'&&job.phase>=opening.startUnit/source.definition.clockUnits&&job.phase<=opening.endUnit/source.definition.clockUnits?opening:undefined;
        if(flight)authenticateOpeningSample(source,a.program,b.program,job.fraction,location,flight,work,toe);
        const value=observe(source,a.program,b.program,job.fraction,location,owner);
        if(!value.passed)throw new PoolTrialRefusal('Physical refusal at '+job.id,{cause:structuredClone({
         witnesses:value.unresolved,supports:value.supports,knees:value.knees,phase:job.phase,
        })});
        for(const [limb,branch] of a.branches){
         const end=b.branches.get(limb);
         if(end===undefined||a.program.policy[limb].surface!==b.program.policy[limb].surface)continue;
         const actual=value.knees.find(k=>k.side===limb.at(-1));
         if(end!==branch||!actual?.admitted||actual.branch!==branch)throw new PoolTrialRefusal('Maintained '+limb+' hinge changed at '+job.id);
         maintained.push({job:job.id,limb,branch});
        }
        if(flight){
         const at=(i:number)=>point(value.pose.world[i]),anatomy=source.anatomy;
         openingSamples.push({job:job.id,phase:job.phase,hips:at(bundle.bones.findIndex(b=>b.name==='hips')),leftAnkle:at(anatomy.footL.end),
          rightAnkle:at(anatomy.footR.end),leftWrist:at(anatomy.handL.end),rightWrist:at(anatomy.handR.end)});
        }
        const measurement=compactObservation(value);
        receipt(measurement,job.fraction);
        observed.push({job,left:a.program,right:b.program,measurement:receipts.issue(measurement,job,a.program,b.program)});
       }finally{owner.active=undefined;}
       pending!.delete(job.id);emit({kind:'observed',attempt,id:job.id});
      }
      for(const o of observed)receipts.require(o.measurement,o.job,o.left,o.right);
      return {completed:observed.map(o=>o.job.id),maintained,...(prepared.opening?{openingSamples}:{})};
     }catch(error){if(!typed(error))throw error;rejected.push({attempt,reason:error.message,cause:error.cause});return undefined;}
     finally{owner.dispose();}
    })();
    emit({kind:'disposed',attempt});
    if(result){
     work.reserve('prepare completed diagnostic');
     const report:PoolNumericSliceResult={kind:'admitted-slice',recipe:structuredClone(proposal.recipe),...result,rejected,published:false};
     work.reserve('return completed diagnostic');return report;
    }
    pending=new Set(required);emit({kind:'refused',attempt});
    }
   }
  }
  work.reserve('return exhausted candidate set');
  return {kind:'no-candidate',rejected,published:false};
 }catch(error){
  if(inCallback||!(error instanceof PoolTrialStopped))throw error;
  return {kind:error.outcome,reason:error.message,details:{reservation:error.cause,unfinished:pending?[...pending]:null,
   scheduleCaptured:pending!==undefined,requiredForNewOwner:required??null,completionPublished:false},published:false};
 }
}

const point=(m:readonly number[]):Vec3=>[m[12],m[13],m[14]];
const same=(a:readonly number[],b:readonly number[])=>a.length===b.length&&a.every((v,i)=>v===b[i]);
interface Constructed {limb:PoolLimb;patch:PreparedPoolPatch;frame?:PoolFootContactFrame;rail?:PoolRailContactFrame;free?:ReturnType<typeof solvePoolFreeLeg>;approach?:{frame:PoolFootContactFrame;plan:ReturnType<typeof solvePoolFreeLeg>}}

/** One evaluation feeds both physical observation and the returned immutable trajectory. */
function observe(source:PoolCycleSource,left:PoolPoseProgram,right:PoolPoseProgram,amount:number,location:PoolSourceLocation,owner?:PoolOwnedCompilation){
 const {bundle,fixture,geometry,cages,neutral}=source,{rest,inverse}=neutral,controls=poolIntervalProgramControls(left,right),actual=interpolatePoolPoseProgram(bundle,rest,inverse,left,right,amount,location);
 const replay=poolIntervalPreference(bundle,rest,inverse,left.preferenceBasis,right.preferenceBasis,amount,true),record=poolSourceRecord(fixture,location),policy=poolSourcePolicy(fixture,location.action,location.phase),constructed:Constructed[]=[],knees=[];
 for(const control of controls){
  const limb=bundle.bones[control.end].name.replace('.','') as PoolLimb,a=source.anatomy[limb];if(!a||control.upper!==a.upper||control.lower!==a.lower||control.end!==a.end)throw new Error('Pool program changed its configured limb owner');
  const support=record.limbs[limb],patch=source.patch(limb,support),resolved=resolvePoolLimbState(control,amount,location),state=resolved.state;
  if(limb==='footL'||limb==='footR'){
   if(policy[limb].required){
    const frame=source.frame(limb,support,state.target.slice(0,2) as [number,number]);
    if(!same(frame.translation,state.target)||!same(frame.orientation,state.orientation))throw new Error('Required authored foot differs from its actual physical frame');
    const plan=solvePoolOrientedFoot(replay,a.upper,a.lower,a.end,frame);knees.push(observeConstructedPoolLeg(replay,frame,plan));constructed.push({limb,patch,frame});
   }else {
    let frame:PoolFootContactFrame|undefined;
    if(support.mode==='approach'){
     if(!same(control.from.orientation,control.to.orientation))throw new Error('Compact source does not authorize a changing free-foot orientation');
     frame=source.frame(limb,support,state.target.slice(0,2) as [number,number]);
     requirePoolFootClearanceReference(frame,state.target,state.orientation,inverse[a.end],bundle);
    }
    const plan=solvePoolFreeLeg(replay,a.upper,a.lower,a.end,state.target,state.orientation,frame);knees.push(observeConstructedPoolFreeLeg(replay,plan));constructed.push({limb,patch,...(frame?{approach:{frame,plan}}:{free:plan})});
   }
  }else if(policy[limb].required){
   if(!resolved.railFrame)throw new Error('Required authored hand has no actual rail frame');
   solveCertifiedPoolRail(replay,a.upper,a.lower,a.end,resolved.railFrame,state.pole,{fixture,geometry:geometry[0],cage:cages[0],patch,support});constructed.push({limb,patch,rail:resolved.railFrame});
  }else {
   const lengths=configuredPoolChainReach(rest,a.upper,a.lower,a.end).lengths,prepared=evaluatePoolLimb({start:point(replay.world[a.upper]),target:state.target,pole:state.pole,lengths,orientation:state.orientation,anchor:control.anchor,upperReference:replay.world[a.upper],lowerReference:replay.world[a.lower]});
   solvePoolHierarchyLimb(replay,a.upper,a.lower,a.end,prepared.end,state.pole,state.orientation);constructed.push({limb,patch});
  }
 }
 if(actual.world.some((m,i)=>!same(m,replay.world[i])))throw new Error('Pool complete producer differs from its runtime replay');
 if(owner){
  sealMatrices(replay.basis);sealMatrices(replay.world);Object.freeze(replay);
  for(const construction of constructed)if(construction.free)observeConstructedPoolFreeLeg(replay,construction.free);
 }
 const skin=poolSkinMatrices(actual.world,inverse),surfaces:PoolSurfaceInput[]=geometry.map((g,i)=>({geometry:g,points:posedCageSurface(g,cages[i],skin)}));
 if(owner)owner.active={identity:Object.freeze({}),rows:surfaces,replay};
 const observation=owner?observeOwnedPoolPhysicalSource(fixture,surfaces,location):observePoolSource(fixture,surfaces,location);
 if(owner)owner.active!.observation=observation;
 const arithmetic:PoolContactArithmetic[]=constructed.flatMap<PoolContactArithmetic>(c=>c.frame?[derivePoolSupportArithmetic(fixture,surfaces[0],cages[0],replay,c.patch,record.limbs[c.limb],c.frame,observation)]:c.rail?[derivePoolRailArithmetic(fixture,surfaces[0],cages[0],replay,c.patch,record.limbs[c.limb],c.rail,observation)]:c.approach?[derivePoolApproachClearanceArithmetic(fixture,surfaces[0],cages[0],replay,c.patch,record.limbs[c.limb],c.limb as PoolFoot,c.approach.frame,c.approach.plan,observation)]:[]);
 const admission=observePoolPatchSupports(fixture,surfaces,constructed.map(c=>({patch:c.patch,support:record.limbs[c.limb],phase:location.phase})),observation,arithmetic);
 const supports=admission.supports.map((support,index)=>({limb:constructed[index].limb,...support})),unresolved=admission.unresolved;
 const minimum=Math.min(...observation.parts.map(p=>p.worstObserved?.signedClearance??Infinity)),airway=observation.parts.filter(p=>/nose|smile/i.test(p.name)),airwayMinimum=airway.length?Math.min(...airway.map(p=>p.minimum[2])):null;
 const passed=knees.length===2&&knees.every(k=>k.admitted)&&supports.every(s=>s.satisfied)&&!unresolved.length&&Number.isFinite(minimum)&&(location.action==='pool_enter'||airwayMinimum!==null&&airwayMinimum>=fixture.waterHeight);
 return {pose:replay,skin,surfaces,observation,arithmetic,supports,unresolved,knees,constructed,minimum,airwayMinimum,passed};
}

/** Measure one raw program location through the complete physical admission path. */
export function measureRawPoolPhysicalObservation(source:PoolCycleSource,left:PoolPoseProgram,right:PoolPoseProgram,amount:number,location:PoolSourceLocation){
 if(poolOwnedStaticIdentity(source.fixture,...source.geometry))throw new Error('Raw pool measurement requires caller-owned source inputs.');
 const {passed,unresolved,supports}=observe(source,left,right,amount,location);
 return structuredClone({passed,unresolved,supports});
}

type Observation=ReturnType<typeof observe>;
type CompactObservation={readonly passed:boolean;readonly publication:PoolIntervalObservation|Error|undefined};
type Measurement=Observation|CompactObservation;
function receipt(result:Measurement,fraction:number):PoolIntervalObservation {
 if(!result.passed)throw new Error('Unadmitted pool observation cannot become coverage');
 if('publication' in result){
  if(result.publication instanceof Error)throw result.publication;
  return {...result.publication!,fraction};
 }
 const arithmeticContacts:PoolArithmeticContactRecord[]=[];
 for(const proof of result.arithmetic){
  const raw=result.observation.violations.find(w=>w.part===proof.part&&w.surface===proof.surface)?.signedClearance??0;
  if('kind' in proof){if(raw<0)throw new Error('A free-foot classification requires an explicit artifact method before publication');continue;}
  if('method' in proof)arithmeticContacts.push({method:'constructive-rail-edge-v1',part:proof.part,surface:proof.surface,rawClearance:raw,bound:proof.maximumOutputError,activeVertex:proof.activeVertex,planeX:proof.planeX,edge:proof.edge,incidentFacets:proof.incidentFacets,activePointResidual:proof.actualActivePointResidual});
  else {const frame=result.constructed.find(c=>c.frame?.part===proof.part)?.frame;if(!frame)throw new Error('Foot coverage lost its physical frame');arithmeticContacts.push({method:'constructive-horizontal-foot-v1',part:proof.part,surface:proof.surface,rawClearance:raw,bound:proof.maximumOutputError,activeVertex:proof.activeVertex,planeHeight:frame.planeHeight});}
 }
 return {fraction,minimumObservedClearance:result.minimum,minimumClassifiedClearance:Math.max(0,result.minimum),airwayMinimum:result.airwayMinimum,arithmeticContacts,rootReachSatisfied:true,supports:result.supports.filter(s=>s.required).map(s=>({limb:s.limb,satisfied:true}))};
}

function compactObservation(result:Observation):CompactObservation {
 if(!result.passed)return Object.freeze({passed:false,publication:undefined});
 try{
  const published=receipt(result,0);
  published.arithmeticContacts.forEach(contact=>Object.freeze(contact));
  published.supports.forEach(support=>Object.freeze(support));
  Object.freeze(published.arithmeticContacts);Object.freeze(published.supports);
  return Object.freeze({passed:true,publication:Object.freeze(published)});
 }catch(error){
  if(!(error instanceof Error))throw error;
  return Object.freeze({passed:true,publication:error});
 }
}

/** Compile all entry, paddle and exit-bridge events before publishing any pool artifact. */
function compileCycle(input:PoolContactInputV1,bundle:Bundle,shape:ShapeParameters,top:number,geometry:readonly Geometry[],fixture:PoolFixtureV1,definition:PoolCycleDefinition,diagnostic?:Diagnostic,owner?:PoolOwnedCompilation):PoolContactArtifactV1 {
 const constructorStart=performance.now();
 const source=new PoolCycleSource(bundle,shape,top,geometry,fixture,definition),poses:PoolPoseProgram[]=[],entry:PoolPreparedTrack={keys:[],intervals:[]},paddle:PoolPreparedTrack={keys:[],intervals:[]},bridges:PoolPreparedTrack[]=[],failures:Error[]=[];
 owner?.configure(source);
 const constructorMs=performance.now()-constructorStart;
 const measured=new Map<string,Measurement>();
 const failed=(location:PoolSourceLocation,stage:string,cause:unknown)=>{
  const failure=new Error(`Pool ${location.action} at ${location.phase} failed during ${stage}.`,{cause:{...location,stage,cause}});
  failures.push(failure);return failure;
 };
 const refuse=(message:string)=>new Error(message+(failures.length?' ('+failures.length+' failed observations).':'.'),failures.length?{cause:failures[0]}:undefined);
 const assess=(left:PoolPoseProgram,right:PoolPoseProgram,amount:number,location:PoolSourceLocation,stage:string,sourceMs=0)=>{
  const observationStart=performance.now();
  try{
   let result:Observation,authoring:ReturnType<PoolCycleSource['bodyPathDiagnostic']>,measurement:Measurement;
   try{
    result=observe(source,left,right,amount,location,owner);
    authoring=location.action==='pool_enter'?source.bodyPathDiagnostic(location.phase,result.pose.world):undefined;
    if(authoring?.paths.some(path=>result.knees.find(k=>k.side===path.segment.limb.at(-1))?.branch!==path.endpoints[0].branch))throw new Error('Pool planted body path changed its maintained hinge branch');
    measurement=owner?compactObservation(result):result;
   }finally{if(owner)owner.active=undefined;}
   diagnostic?.({...location,stage,passed:result.passed,sourceMs,constructorMs,observationMs:performance.now()-observationStart,authoring,...(amount===0||amount===1?{program:amount===0?left:right}:{interval:{left,right,amount}}),world:result.pose.world,basis:result.pose.basis,skin:result.skin,raw:result.observation.violations,unresolved:result.unresolved,supports:result.supports,knees:result.knees});
   if(!result.passed)failed(location,stage,{unresolved:result.unresolved,supports:result.supports,knees:result.knees,minimumObservedClearance:result.minimum,airwayMinimum:result.airwayMinimum});
   return measurement;
  }catch(error){const failure=failed(location,stage,error);diagnostic?.({...location,stage,passed:false,sourceMs,constructorMs,observationMs:performance.now()-observationStart,interval:{left,right,amount},program:amount===1?right:left,error:failure});return undefined;}
 };
 for(const phase of poolSourceEvents(fixture,'pool_enter')){
  const sourceStart=performance.now();
  try{const program=source.entry(phase),pose=poses.length,sourceMs=performance.now()-sourceStart;poses.push(program);entry.keys.push({phase,pose});const result=assess(program,program,0,{action:'pool_enter',phase},'entry-key',sourceMs);if(result)measured.set('pool_enter:'+phase,result);}
  catch(error){const failure=failed({action:'pool_enter',phase},'entry-source',error);diagnostic?.({action:'pool_enter',phase,stage:'entry-source',passed:false,sourceMs:performance.now()-sourceStart,constructorMs,error:failure});}
 }
 const common=entry.keys.at(-1)?.pose;if(common===undefined||entry.keys.at(-1)!.phase!==1)throw refuse('Pool complete source has no paddle join');
 for(let i=0;i<12;i++){
  const phase=i/12;
  const sourceStart=performance.now();
  try{const program=i===0?poses[common]:source.paddle(phase),pose=i===0?common:poses.length,sourceMs=performance.now()-sourceStart;if(i)poses.push(program);paddle.keys.push({phase,pose});const result=assess(program,program,0,{action:'pool_paddle',phase},'paddle-key',sourceMs);if(result)measured.set('pool_paddle:'+phase,result);}
  catch(error){const failure=failed({action:'pool_paddle',phase},'paddle-source',error);diagnostic?.({action:'pool_paddle',phase,stage:'paddle-source',passed:false,sourceMs:performance.now()-sourceStart,constructorMs,error:failure});}
 }
 paddle.keys.push({phase:1,pose:common});if(measured.has('pool_paddle:0'))measured.set('pool_paddle:1',measured.get('pool_paddle:0')!);
 if(failures.length)throw refuse('Pool complete source key admission failed');
 const complete=(track:PoolPreparedTrack,action:string,timeScale=1)=>{
  for(let i=0;i<track.keys.length-1;i++){
   const a=track.keys[i],b=track.keys[i+1],left=poses[a.pose],right=poses[b.pose],start=a.phase*timeScale,end=b.phase*timeScale,phase=start+(end-start)/2;
   try{const policy=poolSourcePolicy(fixture,action,phase);
   const supportLimbs=POOL_LIMBS.filter(limb=>left.policy[limb].required||right.policy[limb].required||policy[limb].required);requirePoolPolicyInterval(left.policy,right.policy,policy,supportLimbs);
   const observations=[];
   for(const fraction of [0,.25,.5,.75,1]){const at=fraction===0?start:fraction===1?end:start+(end-start)*fraction,key=action+':'+at;let result=(fraction===0||fraction===1)?measured.get(key):undefined;
    result??=assess(left,right,fraction,{action,phase:at},'interval');if(result?.passed){
     try{observations.push(receipt(result,fraction));}catch(error){const failure=failed({action,phase:at},'interval-publication',error);diagnostic?.({action,phase:at,stage:'interval-publication',passed:false,error:failure});}
    }
   }
   if(observations.length!==5)continue;
   const interval:PoolPreparedInterval={policy,controls:poolIntervalProgramControls(left,right),supportLimbs,observations,observerRevision:POOL_OBSERVER_REVISION,interpolationRevision:POOL_INTERPOLATION_REVISION,status:'measured'};track.intervals.push(interval);
   }catch(error){const failure=failed({action,phase},'interval-contract',error);diagnostic?.({action,phase,stage:'interval-contract',passed:false,error:failure});}
  }
 };
 complete(entry,'pool_enter');complete(paddle,'pool_paddle');
 for(let origin=0;origin<12;origin++){
  const first=paddle.keys.find(k=>k.phase===origin/12);if(!first)throw new Error('Pool bridge lost its actual paddle origin');
  const track:PoolPreparedTrack={keys:[{phase:0,pose:first.pose},{phase:1,pose:common}],intervals:[]};bridges.push(track);complete(track,'pool_exit_'+origin,.1);
 }
 if(failures.length||entry.intervals.length!==entry.keys.length-1||paddle.intervals.length!==paddle.keys.length-1||bridges.some(t=>t.intervals.length!==1))throw refuse('Pool complete source interval admission failed');
 // Exit tails share exactly the measured entry path; each action must retain those physical obligations and outputs.
 const tailAmounts=[0,.5,1] as const,tailCounters=owner?.counters;
 const forwardReferences:({policy?:ReturnType<typeof poolSourcePolicy>;world?:number[][]}|undefined)[]|undefined=owner?[]:undefined;
 for(let origin=0;origin<12;origin++)for(let i=0;i<entry.keys.length-1;i++){
  const a=entry.keys[i],b=entry.keys[i+1],left=poses[a.pose],right=poses[b.pose];
  for(const [fraction,amount] of tailAmounts.entries()){
   const travel=amount===0?a.phase:amount===1?b.phase:a.phase+(b.phase-a.phase)*amount,phase=travel===1?.1:travel===0?1:1-.9*travel,action='pool_exit_'+origin;
   try{
   const reference=forwardReferences?(forwardReferences[i*tailAmounts.length+fraction]??={}):undefined;
   const forward=reference?.policy??poolSourcePolicy(fixture,'pool_enter',travel);
   if(reference&&!reference.policy){reference.policy=forward;tailCounters!.tailForwardPolicies++;}
   const reverse=poolSourcePolicy(fixture,action,phase);
   if(tailCounters)tailCounters.tailReversePolicies++;
   for(const limb of POOL_LIMBS){const expected=forward[limb],actual=reverse[limb];if(actual.required!==expected.required||actual.surface!==expected.surface||JSON.stringify(actual.region)!==JSON.stringify(expected.region))throw new Error('Pool exit tail changes its shared physical obligation: '+action+' '+phase);}
   const expected=reference?.world??interpolatePoolPoseProgram(bundle,source.neutral.rest,source.neutral.inverse,left,right,amount,{action:'pool_enter',phase:travel}).world;
   if(reference&&!reference.world){sealMatrices(expected);reference.world=expected;tailCounters!.tailForwardEvaluations++;}
   const actual=interpolatePoolPoseProgram(bundle,source.neutral.rest,source.neutral.inverse,left,right,amount,{action,phase});
   if(tailCounters){tailCounters.tailReverseEvaluations++;tailCounters.tailComparisons++;}
   if(actual.world.some((m,bone)=>!same(m,expected[bone])))throw new Error('Pool exit source context changes its shared actual pose');
   diagnostic?.({action,phase,stage:'exit-tail-replay',passed:true});
   }catch(error){const failure=failed({action,phase},'exit-tail-replay',error);diagnostic?.({action,phase,stage:'exit-tail-replay',passed:false,error:failure});throw refuse('Pool complete source exit tail admission failed');}
  }
 }
 const artifact:PoolContactArtifactV1={version:1,solverRevision:POOL_SOLVER_REVISION,key:input.key,appearanceKey:input.appearanceKey,revisions:input.revisions,source:bundle.sourceSha256,partKeys:geometry.map(poolPartKey),shapeKey:poolShapeIdentity(shape,top),top,waterHeight:fixture.waterHeight,graph:{poses,entry,paddle,bridges},coverage:poolCycleCoverage([entry,paddle,...bridges])};
 validatePoolContactArtifact(artifact);return artifact;
}
