import type {PoolHierarchy} from './pool-canonical-pose.js';
import type {PoolFixtureV1,PoolSupport,PoolLimb} from './pool-contact-types.js';
import type {PreparedPoolPatch} from './pool-contact-patch.js';
import type {PoolObservation,PoolSurfaceInput,PoolWitness} from './pool-observer.js';
import {poolPartSurfaceArithmetic} from './pool-skin-arithmetic.js';
import {poolUpper,poolSubtract,poolNumber} from './pool-arithmetic.js';
import {length,vector} from './pool-matrix-arithmetic.js';
import type {Vec3} from './math.js';
import {requirePoolRailContactFrame,type PoolRailContactFrame} from './pool-rail-contact-frame.js';
import {requirePoolRailConstruction} from './pool-rail-construction-arithmetic.js';
import {requirePoolObservationSupport,requirePoolObservedSurface,poolObservationOwnsWitness} from './pool-observer.js';
import {canonicalPoolValue} from './pool-contact-identity.js';
import {poolOwnedObservationIdentity,poolOwnedParts,requirePoolArithmeticReplay} from './pool-owned-compilation.js';

export interface PoolRailSupportArithmetic {
  readonly method:'constructive-rail-edge-v1';readonly part:string;readonly surface:string;readonly geometry:PoolSurfaceInput['geometry'];
  readonly maximumOutputError:number;readonly actualActivePointResidual:number;readonly contactEstablished:true;readonly activeVertex:number;
  readonly constructionMaximumError:number;readonly planeX:number;readonly edge:readonly [number,number];readonly incidentFacets:readonly number[];
}
interface Owner {fixture:PoolFixtureV1;surface:PoolSurfaceInput;points:Float32Array<ArrayBuffer>;observation:PoolObservation;observationKey:string;pose:PoolHierarchy;
  frame:PoolRailContactFrame;cage:Float32Array<ArrayBuffer>;patch:PreparedPoolPatch;support:PoolSupport}
const derived=new WeakSet<PoolRailSupportArithmetic>(),owners=new WeakMap<PoolRailSupportArithmetic,Owner>();
const closedProofs=new WeakMap<PoolRailSupportArithmetic,{fixture:PoolFixtureV1;surface:PoolSurfaceInput;observation:PoolObservation;identity:object}>();

/** The exact whole-palm/finite-edge premise precedes the actual arm and skin output bound. */
export function derivePoolRailArithmetic(fixture:PoolFixtureV1,surface:PoolSurfaceInput,cage:Float32Array<ArrayBuffer>,pose:PoolHierarchy,patch:PreparedPoolPatch,support:PoolSupport,frame:PoolRailContactFrame,observation:PoolObservation):PoolRailSupportArithmetic {
  requirePoolObservedSurface(fixture,observation,surface,patch.part);
  const closed=requirePoolArithmeticReplay(fixture,observation,surface.geometry,cage,pose);
  const limb=('hand'+pose.bundle.bones[patch.bone]?.name.slice(-1)) as PoolLimb;
  requirePoolRailContactFrame(frame,fixture,surface.geometry,cage,patch,pose.inverse[patch.bone],support);requirePoolObservationSupport(fixture,observation,limb,support);
  const construction=requirePoolRailConstruction(frame,pose),geometry=surface.geometry,parts=geometry.description.parts.filter(part=>part.name===patch.part),part=parts[0];
  if(parts.length!==1)throw new Error('Pool rail arithmetic has no unique selected complete palm.');
  const vertices=poolOwnedParts(geometry)?.find(row=>row.name===part.name)?.vertices??[...new Set(geometry.indices.subarray(part.start,part.start+part.count))];
  if(vertices.length!==frame.vertexCount||!vertices.includes(frame.activeVertex))throw new Error('Pool rail arithmetic selection differs from its exact whole-palm premise.');
  const worldErrors=pose.world.map((_,bone)=>bone===patch.bone?[...construction.worldError]:new Array(16).fill(0));
  const arithmetic=poolPartSurfaceArithmetic(geometry,cage,pose.world,pose.inverse,vertices,worldErrors),coordinateBounds=[0,0,0];
  for(const vertex of vertices)for(let axis=0;axis<3;axis++){
    const coordinate=vertex*3+axis;
    if(surface.points[coordinate]!==arithmetic.values[coordinate])throw new Error('Pool rail proof differs from actual observed skin/subdivision output.');
    if(!Number.isFinite(arithmetic.errors[coordinate])||arithmetic.errors[coordinate]<0)throw new Error('Pool rail output error is unresolved.');
    coordinateBounds[axis]=Math.max(coordinateBounds[axis],poolUpper(arithmetic.errors[coordinate]+frame.targetPointError[axis]));
  }
  const residual=[];
  for(let axis=0;axis<3;axis++){
    const coordinate=frame.activeVertex*3+axis,difference=poolSubtract(poolNumber(surface.points[coordinate]),{value:frame.targetPoint[axis],error:frame.targetPointError[axis]});
    const bound=poolUpper(arithmetic.errors[coordinate]+difference.error);
    if(Math.abs(difference.value)>bound)throw new Error('Pool active rail vertex is outside its derived exact-edge reconstruction bound.');residual.push(difference.value);
  }
  const radius=length(vector(coordinateBounds as unknown as Vec3)),maximumOutputError=poolUpper(radius.value+radius.error);
  if(!Number.isFinite(maximumOutputError))throw new Error('Pool rail distance envelope is unresolved.');
  const proof=Object.freeze({method:'constructive-rail-edge-v1' as const,part:patch.part,surface:support.surface!,geometry,maximumOutputError,
    actualActivePointResidual:Math.hypot(...residual),contactEstablished:true as const,activeVertex:frame.activeVertex,constructionMaximumError:Math.max(...construction.worldError),
    planeX:frame.planeX,edge:Object.freeze([frame.edge.from,frame.edge.to]) as readonly [number,number],incidentFacets:frame.incidentFacets});
  if(closed)closedProofs.set(proof,{fixture,surface,observation,identity:closed});
  else {derived.add(proof);owners.set(proof,{fixture,surface:Object.freeze({geometry:surface.geometry,points:surface.points}),points:surface.points.slice(),observation,observationKey:canonicalPoolValue(observation),pose,frame,cage,patch,support});}
  return proof;
}

export function poolRailArithmeticBound(proof:PoolRailSupportArithmetic,part:string,surface:string,geometry?:PoolSurfaceInput['geometry'],observation?:PoolObservation,witness?:PoolWitness,consumedSurface?:PoolSurfaceInput):number {
  const closed=closedProofs.get(proof);
  if(closed){
    if(!observation||closed.observation!==observation||closed.identity!==poolOwnedObservationIdentity(closed.fixture,observation)
      ||proof.part!==part||proof.surface!==surface||geometry&&proof.geometry!==geometry)return 0;
    if(consumedSurface&&(consumedSurface.geometry!==closed.surface.geometry||consumedSurface.points!==closed.surface.points))return 0;
    if(witness&&!poolObservationOwnsWitness(closed.fixture,observation,closed.surface,witness))return 0;
    return proof.maximumOutputError;
  }
  const owner=owners.get(proof);
  if(!derived.has(proof)||!owner||owner.observation!==observation||owner.observationKey!==canonicalPoolValue(observation)||proof.part!==part||proof.surface!==surface||(geometry&&proof.geometry!==geometry))return 0;
  if(consumedSurface&&(consumedSurface.geometry!==owner.surface.geometry||consumedSurface.points!==owner.surface.points))return 0;
  if(owner.surface.points.length!==owner.points.length||owner.points.some((value,at)=>value!==owner.surface.points[at]))return 0;
  if(witness&&!poolObservationOwnsWitness(owner.fixture,owner.observation,owner.surface,witness))return 0;
  try{requirePoolObservedSurface(owner.fixture,owner.observation,owner.surface,owner.patch.part);requirePoolObservationSupport(owner.fixture,owner.observation,('hand'+owner.pose.bundle.bones[owner.patch.bone]?.name.slice(-1)) as PoolLimb,owner.support);requirePoolRailContactFrame(owner.frame,owner.fixture,proof.geometry,owner.cage,owner.patch,owner.pose.inverse[owner.patch.bone],owner.support);requirePoolRailConstruction(owner.frame,owner.pose);}catch{return 0;}
  return proof.maximumOutputError;
}
