import type {PoolHierarchy} from './pool-canonical-pose.js';
import type {PoolFixtureV1,PoolSupport} from './pool-contact-types.js';
import type {PreparedPoolPatch} from './pool-contact-patch.js';
import type {PoolObservation,PoolSurfaceInput,PoolWitness} from './pool-observer.js';
import {poolRigidSurfaceReference,poolPartSurfaceArithmetic} from './pool-skin-arithmetic.js';
import {poolUpper,poolSubtract,poolNumber} from './pool-arithmetic.js';
import {requirePoolFootContactFrame,requirePoolInterpolatedFootReference,type PoolFootContactFrame,type PoolFreeFootClearanceReference} from './pool-foot-contact-frame.js';
import {requirePoolFootConstruction} from './pool-limb-construction-arithmetic.js';
import {canonicalPoolValue} from './pool-contact-identity.js';
import {poolRailArithmeticBound,type PoolRailSupportArithmetic} from './pool-rail-support-arithmetic.js';
import {requirePoolFreeFootConstruction} from './pool-free-leg.js';
import type {PoolFreeLegPlan} from './pool-matrix-producer.js';
import {requirePoolObservationSupport,requirePoolObservedSurface,poolObservationOwnsWitness,poolGroundSolid} from './pool-observer.js';
import {poolSourceSupport} from './pool-source-policy.js';
import {poolOwnedObservationIdentity,poolOwnedParts,requirePoolArithmeticReplay} from './pool-owned-compilation.js';

export interface PoolSupportArithmetic {
  readonly part:string;readonly surface:string;readonly geometry:PoolSurfaceInput['geometry'];
  readonly maximumOutputError:number;readonly nominalMinimumGap:number;readonly nominalOperationError:number;
  readonly actualMinimumGap:number;readonly contactEstablished:boolean;
  readonly constructionMaximumError:number;readonly activeVertex:number;
}
export interface PoolApproachClearanceArithmetic {
  readonly kind:'free-foot-approach-clearance';readonly part:string;readonly surface:string;readonly geometry:PoolSurfaceInput['geometry'];
  readonly maximumOutputError:number;readonly actualMinimumGap:number;readonly constructionMaximumError:number;
  readonly contactEstablished:false;readonly required:false;readonly activeVertex:number;
  readonly exactTargetMargin:{readonly numerator:string;readonly denominator:string;readonly exponent:number};
}
export type PoolContactArithmetic=PoolSupportArithmetic|PoolRailSupportArithmetic|PoolApproachClearanceArithmetic;
const derived=new WeakSet<PoolSupportArithmetic>();
const ownership=new WeakMap<PoolSupportArithmetic,{fixture:PoolFixtureV1;surface:PoolSurfaceInput;points:Float32Array<ArrayBuffer>;observation:PoolObservation;observationKey:string;pose:PoolHierarchy;frame:PoolFootContactFrame;cage:Float32Array<ArrayBuffer>;patch:PreparedPoolPatch}>();
interface ClosedProof {fixture:PoolFixtureV1;surface:PoolSurfaceInput;observation:PoolObservation;identity:object}
const closedProofs=new WeakMap<PoolSupportArithmetic|PoolApproachClearanceArithmetic,ClosedProof>();

function closedBound(proof:PoolSupportArithmetic|PoolApproachClearanceArithmetic,owner:ClosedProof,part:string,surface:string,geometry?:PoolSurfaceInput['geometry'],
  observation?:PoolObservation,witness?:PoolWitness,consumedSurface?:PoolSurfaceInput):number {
  if(!observation||owner.observation!==observation||owner.identity!==poolOwnedObservationIdentity(owner.fixture,observation)
    ||proof.part!==part||proof.surface!==surface||geometry&&proof.geometry!==geometry)return 0;
  if(consumedSurface&&(consumedSurface.geometry!==owner.surface.geometry||consumedSurface.points!==owner.surface.points))return 0;
  if(witness&&!poolObservationOwnsWitness(owner.fixture,observation,owner.surface,witness))return 0;
  return proof.maximumOutputError;
}

/** Only a mathematically tangent, rigid full foot receives this numerical classification. */
export function derivePoolSupportArithmetic(fixture:PoolFixtureV1,surface:PoolSurfaceInput,cage:Float32Array<ArrayBuffer>,pose:PoolHierarchy,patch:PreparedPoolPatch,support:PoolSupport,frame?:PoolFootContactFrame,observation?:PoolObservation):PoolSupportArithmetic {
  if(!frame||!observation)throw new Error('Pool support arithmetic requires its independent contact frame and exact observation owner.');
  requirePoolObservedSurface(fixture,observation,surface,patch.part);
  const closed=requirePoolArithmeticReplay(fixture,observation,surface.geometry,cage,pose);
  requirePoolFootContactFrame(frame,fixture,surface.geometry,cage,patch,pose.inverse[patch.bone],support,pose.bundle);
  if(closed)requirePoolObservationSupport(fixture,observation,pose.bundle.bones[patch.bone].name==='foot.L'?'footL':'footR',support);
  const construction=requirePoolFootConstruction(frame,pose);
  if(support.region?.kind!=='top-face'||!support.surface)throw new Error('Pool support arithmetic requires a finite horizontal support.');
  const solid=fixture.solids.find(solid=>solid.id===support.surface),ground=fixture.ground.id===support.surface?fixture.ground:null;
  const heights=ground?[ground.bounds[1][2]]:(support.region.triangles??[]).flatMap(index=>solid!.triangles[index].map(id=>solid!.vertices[id][2]));
  if(!heights.length||heights.some(height=>height!==heights[0]))throw new Error('Pool support arithmetic requires one actual horizontal plane.');
  const geometry=surface.geometry,parts=geometry.description.parts.filter(part=>part.name===patch.part),part=parts[0];
  if(parts.length!==1)throw new Error('Pool support arithmetic has no unique selected patch owner.');
  const worldErrors=pose.world.map((_,bone)=>bone===patch.bone?construction.worldError:new Array(16).fill(0));
  const vertices=poolOwnedParts(geometry)?.find(row=>row.name===part.name)?.vertices??new Set(geometry.indices.subarray(part.start,part.start+part.count));
  const arithmetic=poolPartSurfaceArithmetic(geometry,cage,pose.world,pose.inverse,vertices,worldErrors),height=heights[0];
  let maximumOutputError=0,nominalMinimumGap=Infinity,nominalOperationError=0,actualMinimumGap=Infinity;
  for(const vertex of vertices){
    for(let axis=0;axis<3;axis++)if(surface.points[vertex*3+axis]!==arithmetic.values[vertex*3+axis])throw new Error('Pool arithmetic proof does not match the observed skin/subdivision output.');
    const reference=poolRigidSurfaceReference(geometry,cage,pose.world[patch.bone],pose.inverse[patch.bone],patch.bone,vertex)[2];
    const gap=reference.value-height;
    // One subtraction follows the complete coefficient equation.
    const bound=poolUpper(reference.error+Math.abs(gap)*Number.EPSILON/(2-Number.EPSILON)+Number.MIN_VALUE);
    nominalMinimumGap=Math.min(nominalMinimumGap,gap);nominalOperationError=Math.max(nominalOperationError,bound);
    const actualGap=poolSubtract(poolNumber(surface.points[vertex*3+2]),poolNumber(height));
    actualMinimumGap=Math.min(actualMinimumGap,actualGap.value);
    maximumOutputError=Math.max(maximumOutputError,poolUpper(arithmetic.errors[vertex*3+2]+actualGap.error));
    if(!Number.isFinite(bound)||!Number.isFinite(arithmetic.errors[vertex*3+2]))throw new Error('Pool support arithmetic has a nonfinite bound.');
  }
  const proof=Object.freeze({part:patch.part,surface:support.surface,geometry,maximumOutputError,
    nominalMinimumGap,nominalOperationError,actualMinimumGap,contactEstablished:true,constructionMaximumError:Math.max(...construction.worldError),activeVertex:frame.activeVertex});
  if(closed)closedProofs.set(proof,{fixture,surface,observation,identity:closed});
  else {derived.add(proof);ownership.set(proof,{fixture,surface:Object.freeze({geometry:surface.geometry,points:surface.points}),points:surface.points.slice(),observation,observationKey:canonicalPoolValue(observation),pose,frame,cage,patch});}
  return proof;
}

export function poolSupportArithmeticBound(proof:PoolContactArithmetic,part:string,surface:string,geometry?:PoolSurfaceInput['geometry'],observation?:PoolObservation,witness?:PoolWitness,consumedSurface?:PoolSurfaceInput):number {
  if('kind' in proof)return 0;
  if('method' in proof)return poolRailArithmeticBound(proof,part,surface,geometry,observation,witness,consumedSurface);
  const closed=closedProofs.get(proof);
  if(closed)return closedBound(proof,closed,part,surface,geometry,observation,witness,consumedSurface);
  const owner=ownership.get(proof);
  if(!derived.has(proof)||!owner||owner.observation!==observation||owner.observationKey!==canonicalPoolValue(observation)||!proof.contactEstablished||proof.part!==part||proof.surface!==surface||(geometry&&proof.geometry!==geometry))return 0;
  if(consumedSurface&&(consumedSurface.geometry!==owner.surface.geometry||consumedSurface.points!==owner.surface.points))return 0;
  if(owner.surface.points.length!==owner.points.length||owner.points.some((value,at)=>value!==owner.surface.points[at]))return 0;
  if(witness&&!poolObservationOwnsWitness(owner.fixture,owner.observation,owner.surface,witness))return 0;
  try{requirePoolObservedSurface(owner.fixture,owner.observation,owner.surface,owner.patch.part);requirePoolFootContactFrame(owner.frame,owner.fixture,proof.geometry,owner.cage,owner.patch,owner.pose.inverse[owner.patch.bone],undefined,owner.pose.bundle);requirePoolFootConstruction(owner.frame,owner.pose);}catch{return 0;}
  return proof.maximumOutputError;
}

interface ApproachInputs {fixture:PoolFixtureV1;surface:PoolSurfaceInput;observation:PoolObservation;
  pose:PoolHierarchy;frame:PoolFreeFootClearanceReference;plan:PoolFreeLegPlan;cage:Float32Array<ArrayBuffer>;patch:PreparedPoolPatch;support:PoolSupport;limb:'footL'|'footR';solidKey?:string}
interface ApproachOwner extends ApproachInputs {points:Float32Array<ArrayBuffer>;observationKey:string;solidKey:string}
const approachOwners=new WeakMap<PoolApproachClearanceArithmetic,ApproachOwner>();

function requireApproachOwner(owner:ApproachInputs) {
  const {fixture,surface,cage,pose,patch,support,frame,plan,observation,limb}=owner;
  requirePoolObservedSurface(fixture,observation,surface,patch.part);
  const location=requirePoolObservationSupport(fixture,observation,limb,support),actual=poolSourceSupport(fixture,{...location,limb});
  if(actual.required||actual.support.mode!=='approach'||support.region?.kind!=='top-face'||!support.surface)throw new Error('Pool free-foot clearance requires an actual nonrequired horizontal approach.');
  if(pose.bundle.bones[plan.end]?.name!=='foot.'+limb.slice(-1)||patch.bone!==plan.end||patch.part!==frame.part)throw new Error('Pool free-foot clearance names another limb or part.');
  if('kind' in frame)requirePoolInterpolatedFootReference(frame,fixture,surface.geometry,cage,patch,support,{...location,limb},pose.inverse[plan.end],pose.bundle);
  else requirePoolFootContactFrame(frame,fixture,surface.geometry,cage,patch,pose.inverse[plan.end],support,pose.bundle);
  const solid=support.surface===fixture.ground.id?poolGroundSolid(fixture.ground):fixture.solids.find(solid=>solid.id===support.surface);
  if(!solid||solid.vertices.some(vertex=>vertex.some(value=>!Number.isFinite(value))||vertex[2]>frame.planeHeight)||solid.bounds[1][2]>frame.planeHeight
      ||solid.triangles.some(face=>face.some(vertex=>!Number.isInteger(vertex)||vertex<0||vertex>=solid.vertices.length)))throw new Error('Pool approach solid is not wholly at or below its certified plane.');
  const solidKey=canonicalPoolValue({solid,revisions:fixture.revisions});
  if(owner.solidKey&&solidKey!==owner.solidKey)throw new Error('Pool approach solid changed after its clearance construction.');
  return {construction:requirePoolFreeFootConstruction(pose,plan,frame),solidKey};
}

/** Own-plane collision classification grants no contact, support area or other-solid allowance. */
export function derivePoolApproachClearanceArithmetic(fixture:PoolFixtureV1,surface:PoolSurfaceInput,cage:Float32Array<ArrayBuffer>,pose:PoolHierarchy,patch:PreparedPoolPatch,
  support:PoolSupport,limb:'footL'|'footR',frame:PoolFreeFootClearanceReference,plan:PoolFreeLegPlan,observation:PoolObservation):PoolApproachClearanceArithmetic {
  const closed=requirePoolArithmeticReplay(fixture,observation,surface.geometry,cage,pose),owner={fixture,surface,cage,pose,patch,support,limb,frame,plan,observation};
  const raw=closed?undefined:{...owner,surface:Object.freeze({geometry:surface.geometry,points:surface.points}),points:surface.points.slice(),observationKey:canonicalPoolValue(observation),solidKey:''};
  const {construction,solidKey}=requireApproachOwner(raw??owner);
  const geometry=surface.geometry,parts=geometry.description.parts.filter(part=>part.name===patch.part),part=parts[0];
  if(parts.length!==1)throw new Error('Pool approach clearance has no unique selected full-foot owner.');
  const vertices=poolOwnedParts(geometry)?.find(row=>row.name===part.name)?.vertices??new Set(geometry.indices.subarray(part.start,part.start+part.count));
  const worldErrors=pose.world.map((_,bone)=>bone===patch.bone?construction.worldError:new Array(16).fill(0));
  const arithmetic=poolPartSurfaceArithmetic(geometry,cage,pose.world,pose.inverse,vertices,worldErrors);
  let maximumOutputError=0,actualMinimumGap=Infinity;
  for(const vertex of vertices){
    for(let axis=0;axis<3;axis++)if(surface.points[vertex*3+axis]!==arithmetic.values[vertex*3+axis])throw new Error('Pool approach arithmetic does not match the observed skin/subdivision output.');
    const gap=poolSubtract(poolNumber(surface.points[vertex*3+2]),poolNumber(frame.planeHeight));
    actualMinimumGap=Math.min(actualMinimumGap,gap.value);maximumOutputError=Math.max(maximumOutputError,poolUpper(arithmetic.errors[vertex*3+2]+gap.error));
  }
  if(!Number.isFinite(maximumOutputError)||maximumOutputError<0)throw new Error('Pool approach arithmetic has an unresolved forward bound.');
  const proof=Object.freeze({kind:'free-foot-approach-clearance' as const,part:patch.part,surface:support.surface!,geometry,maximumOutputError,actualMinimumGap,
    constructionMaximumError:Math.max(...construction.worldError),contactEstablished:false as const,required:false as const,activeVertex:frame.activeVertex,exactTargetMargin:construction.premise.exactTargetMargin});
  if(closed)closedProofs.set(proof,{fixture,surface,observation,identity:closed});
  else approachOwners.set(proof,{...raw!,solidKey});
  return proof;
}

function approachClearanceBound(proof:PoolApproachClearanceArithmetic,witness:PoolWitness,observation:PoolObservation):number {
  const closed=closedProofs.get(proof);
  if(closed)return closedBound(proof,closed,witness.part??'',witness.surface,undefined,observation,witness);
  const owner=approachOwners.get(proof);
  if(!owner||owner.observation!==observation||owner.observationKey!==canonicalPoolValue(observation)||proof.part!==witness.part||proof.surface!==witness.surface
      ||owner.surface.points.length!==owner.points.length||owner.points.some((value,at)=>value!==owner.surface.points[at]))return 0;
  if(!poolObservationOwnsWitness(owner.fixture,observation,owner.surface,witness))return 0;
  try{requireApproachOwner(owner);}catch{return 0;}
  return proof.maximumOutputError;
}

/** Preserve the raw report. Each independent physical premise owns only its assigned contact. */
export function poolViolationsBeyondArithmetic(observation:PoolObservation,proofs:readonly PoolContactArithmetic[]) {
  return observation.violations.filter(violation=>!proofs.some(proof=>{
    const bound='kind' in proof?approachClearanceBound(proof,violation,observation):poolSupportArithmeticBound(proof,violation.part??'',violation.surface,undefined,observation,violation);
    return bound>0&&violation.signedClearance>=-bound;
  }));
}
