import type {Bundle,Geometry} from './bundle.js';
import type {ShapeParameters} from './shape.js';
import type {PoolFixtureV1,PoolContactInputV1,PoolContactArtifactV1,PoolPreparedTrack,PoolPreparedInterval,PoolIntervalObservation,PoolArithmeticContactRecord,PoolLimb} from './pool-contact-types.js';
import {POOL_SOLVER_REVISION,POOL_OBSERVER_REVISION,POOL_INTERPOLATION_REVISION} from './pool-contact-types.js';
import {PoolCycleSource,validatePoolCycleDefinition,type PoolCycleDefinition,type PoolFoot} from './pool-cycle-source.js';
import {poolIntervalProgramControls,type PoolPoseProgram} from './pool-pose-program.js';
import {poolIntervalPreference,interpolatePoolPoseProgram,poolSkinMatrices} from './pool-contact-sample.js';
import {resolvePoolLimbState,evaluatePoolLimb} from './pool-contact-evaluator.js';
import {requirePoolFootClearanceReference,type PoolFootContactFrame} from './pool-foot-contact-frame.js';
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
import type {Vec3} from './math.js';

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

function validateMesh(geometry:Geometry,bundle:Bundle):void {
 const {vertexCount,indexCount,cageCount,coefficientCount}=geometry.description;
 if(![vertexCount,indexCount,cageCount,coefficientCount].every(count=>Number.isSafeInteger(count)&&count>0)
   ||!(geometry.vertices instanceof Float32Array)||!(geometry.cage instanceof Float32Array)||!(geometry.stencilWeights instanceof ArrayBuffer)
   ||![geometry.indices,geometry.stencilRanges,geometry.normalRanges,geometry.normalTriangles].every(view=>view instanceof Uint32Array)
   ||geometry.vertices.length!==vertexCount*16||geometry.indices.length!==indexCount||geometry.cage.length!==cageCount*16
   ||geometry.stencilRanges.length!==vertexCount*4||geometry.stencilWeights.byteLength!==coefficientCount*8
   ||geometry.normalRanges.length!==vertexCount*2||geometry.normalTriangles.length!==indexCount
   ||geometry.vertices.some(value=>!Number.isFinite(value))||geometry.cage.some(value=>!Number.isFinite(value))
   ||geometry.indices.some(vertex=>vertex>=vertexCount))throw new Error('Pool capture has invalid selected mesh buffers.');
 for(let at=0;at<geometry.cage.length;at+=16){
  if(geometry.cage[at+15]===10)continue;
  for(let slot=0;slot<4;slot++){
   const bone=geometry.cage[at+6+slot];
   if(!Number.isInteger(bone)||bone<0||bone>=bundle.bones.length)throw new Error('Pool capture cage references a missing skin matrix.');
  }
 }
 const ids=new Uint32Array(geometry.stencilWeights),weights=new Float32Array(geometry.stencilWeights);
 for(let at=0;at<ids.length;at+=2)if(ids[at]>=cageCount||!Number.isFinite(weights[at+1]))throw new Error('Pool capture has invalid stencil coefficients.');
 for(let vertex=0;vertex<vertexCount;vertex++){
  const at=vertex*4,start=geometry.stencilRanges[at],count=geometry.stencilRanges[at+1];
  if(!count||count>256||start+count>coefficientCount||geometry.stencilRanges[at+2]>=cageCount)throw new Error('Pool capture has an invalid stencil row.');
 }
}

export interface PoolOwnedPartPlan {
 readonly name:string;readonly start:number;readonly count:number;
 readonly indices:readonly number[];readonly vertices:readonly number[];
 readonly legacy:Readonly<Record<PoolLimb,readonly number[]>>;
}
interface ObservationOwner {readonly identity:object;readonly rows:readonly PoolSurfaceInput[];readonly replay:PoolHierarchy;observation?:PoolObservation}
const staticOwners=new WeakMap<object,PoolOwnedCompilation>();

class PoolOwnedCompilation {
 readonly identity=Object.freeze({});
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

 constructor(input:PoolContactInputV1,sources:PoolCycleInputs,definition:PoolCycleDefinition){
  this.captured=copyInputs({input,sources,definition},this.counters);
  const captured=this.captured.sources,{bundle,shape,top,geometry,fixture}=captured;
  validatePoolContactInput(this.captured.input);validatePoolCycleDefinition(this.captured.definition);validatePoolFixture(fixture);
  const appearance=this.captured.input.appearance;
  if(!Number.isFinite(top)||top<=0||poolShapeIdentity(shape,top)!==poolShapeIdentity({presentation:appearance.presentation,...appearance.body,face:appearance.face},top))throw new Error('Pool capture shape differs from the requested appearance.');
  if(geometry.length!==2)throw new Error('Pool capture requires the complete selected body and swimwear.');
  for(const mesh of geometry){validateMesh(mesh,bundle);this.parts.set(mesh,this.planParts(mesh));}
  this.physicalKey=canonicalPoolValue({ground:fixture.ground,solids:fixture.solids,revisions:fixture.revisions});
  for(const rig of new Set([bundle,...geometry.map(mesh=>mesh.manifest)]))this.rigKeys.set(rig,canonicalPoolValue({sourceSha256:rig.sourceSha256,bones:rig.bones}));
  for(const value of [bundle,shape,fixture,...geometry,...geometry.map(mesh=>mesh.manifest)])this.own(value);
 }

 private planParts(geometry:Geometry):readonly PoolOwnedPartPlan[] {
  const bones=POOL_LIMBS.map(limb=>geometry.manifest.bones.findIndex(bone=>bone.name===limb.slice(0,-1)+'.'+limb.at(-1)));
  const vertexOwnership=new Uint8Array(geometry.description.vertexCount);
  for(let vertex=0;vertex<vertexOwnership.length;vertex++)bones.forEach((bone,limb)=>{
   let weight=0;
   for(let slot=0;slot<4;slot++)if(geometry.vertices[vertex*16+6+slot]===bone)weight+=geometry.vertices[vertex*16+10+slot];
   if(weight>=.99)vertexOwnership[vertex]|=1<<limb;
  });
  return Object.freeze(geometry.description.parts.map(({name,start,count})=>{
   if(!Number.isInteger(start)||!Number.isInteger(count)||start<0||count<0||count%3||start+count>geometry.indices.length)throw new Error('Pool observation has an invalid selected triangle range.');
   const indices=Object.freeze(Array.from(geometry.indices.subarray(start,start+count))),vertices=Object.freeze([...new Set(indices)]);
   const offsets=POOL_LIMBS.map(()=>[] as number[]);
   for(let at=0;at<count;at+=3){
    const mask=vertexOwnership[indices[at]]&vertexOwnership[indices[at+1]]&vertexOwnership[indices[at+2]];
    offsets.forEach((selected,limb)=>{if(mask&(1<<limb))selected.push(at);});
   }
   this.counters.topologyTriangles+=count/3;
   const legacy=Object.freeze(Object.fromEntries(POOL_LIMBS.map((limb,index)=>[limb,Object.freeze(offsets[index])])) as Record<PoolLimb,readonly number[]>);
   return Object.freeze({name,start,count,indices,vertices,legacy});
  }));
 }

 configure(source:PoolCycleSource):void {
  source.geometry.forEach((geometry,index)=>{const cage=source.cages[index];this.cages.set(geometry,cage);this.own(cage);});
  sealMatrices(source.neutral.rest);sealMatrices(source.neutral.inverse);
  this.rest=source.neutral.rest;this.inverse=source.neutral.inverse;
  for(const anatomy of Object.values(source.anatomy))for(const patch of [anatomy.patch,anatomy.front,anatomy.back]){
   if(patch){this.patches.add(patch);this.own(patch);}
  }
 }

 private own(member:object):void {staticOwners.set(member,this);this.members.add(member);}
 dispose():void {
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
