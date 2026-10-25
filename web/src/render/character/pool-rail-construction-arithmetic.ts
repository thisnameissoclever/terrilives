import type {PoolHierarchy} from './pool-canonical-pose.js';
import {solvePoolHierarchyLimb} from './pool-canonical-pose.js';
import {requirePoolRailFrameInstance,requirePoolRailContactFrame,type PoolRailContactFrame} from './pool-rail-contact-frame.js';
import type {Geometry} from './bundle.js';
import type {PreparedPoolPatch} from './pool-contact-patch.js';
import type {PoolFixtureV1,PoolSupport} from './pool-contact-types.js';
import {canonicalPoolValue} from './pool-contact-identity.js';
import {requirePoolMatrixRepresentation} from './pool-matrix-producer.js';
import {poolUpper} from './pool-arithmetic.js';
import type {Vec3} from './math.js';
import {vector,identity,point,multiply,inverse,boneFrame,properRotation,solve,length,type M,type V} from './pool-matrix-arithmetic.js';

interface Bounds {readonly worldError:readonly number[]}
export interface PoolExpectedRailContact {fixture:PoolFixtureV1;geometry:Geometry;cage:Float32Array<ArrayBuffer>;patch:PreparedPoolPatch;support:PoolSupport}
interface Construction {bounds:Bounds;world:number[];inverse:number[];geometry:Geometry;rigKey:string;ancestors:{bone:number;basis:number[];rest:number[];inverse:number[];world:number[]}[]}
const constructions=new WeakMap<PoolRailContactFrame,WeakMap<PoolHierarchy,Construction>>();
const rigKey=(bundle:PoolHierarchy['bundle'])=>canonicalPoolValue({sourceSha256:bundle.sourceSha256,bones:bundle.bones});

/** Bound the actual existing arm IK operations from the independent exact rail frame. */
export function solveCertifiedPoolRail(pose:PoolHierarchy,upper:number,lower:number,end:number,frame:PoolRailContactFrame,pole:Vec3,expected:PoolExpectedRailContact):void {
  requirePoolRailContactFrame(frame,expected.fixture,expected.geometry,expected.cage,expected.patch,pose.inverse[end],expected.support);
  if(pose.bundle.sourceSha256!==expected.geometry.manifest.sourceSha256||canonicalPoolValue(pose.bundle.bones)!==canonicalPoolValue(expected.geometry.manifest.bones))throw new Error('Pool rail pose uses a different actual selected rig.');
  const side=pose.bundle.bones[end]?.name.slice(-1);
  if(frame.bone!==end||pose.bundle.bones[end]?.name!=='hand.'+side||pose.bundle.bones[lower]?.name!=='forearm.'+side||pose.bundle.bones[upper]?.name!=='upper_arm.'+side
      ||pose.bundle.bones[end].parent!==lower||pose.bundle.bones[lower].parent!==upper||pose.bundle.bones[pose.bundle.bones[upper].parent]?.name!=='spine')throw new Error('Pool rail construction requires its actual configured arm chain.');
  const owned=(values:readonly number[]):M=>{const errors=requirePoolMatrixRepresentation(values);return values.map((value,index)=>({value,error:errors[index]}));};
  const rest=pose.rest.map(owned),inverses=rest.map(inverse),basis=pose.basis.map(owned);let world:M[]=[];
  if(inverses.some((matrix,bone)=>matrix.some((value,index)=>value.value!==pose.inverse[bone][index])))throw new Error('Pool rail inverse differs from its actual configured rest producer.');
  const compose=()=>{world=[];for(let bone=0;bone<rest.length;bone++){
    const parent=pose.bundle.bones[bone].parent,local=parent<0?rest[bone]:multiply(inverses[parent],rest[bone]),animated=multiply(local,basis[bone]);world.push(parent<0?animated:multiply(world[parent],animated));
  }};
  compose();
  if(world.some((matrix,bone)=>matrix.some((value,index)=>value.value!==pose.world[bone][index])))throw new Error('Pool rail input hierarchy is stale.');
  const set=(bone:number,rotation:M)=>{const parent=pose.bundle.bones[bone].parent,parentFrame=multiply(world[parent],multiply(inverses[parent],rest[bone]));basis[bone]=properRotation(multiply(inverse(parentFrame),rotation));compose();};
  const upperOffset=point(multiply(inverses[upper],rest[lower])),lowerOffset=point(multiply(inverses[lower],rest[end])),start=point(world[upper]);
  const target=frame.translation.map((value,axis)=>({value,error:frame.translationError[axis]})) as unknown as V;
  const joint=solve(start,target,length(upperOffset),length(lowerOffset),vector(pole));
  const align=(bone:number,offset:V,from:V,to:V)=>{const local=boneFrame(vector([0,0,0]),offset,identity()),preferred=multiply(world[bone],local);set(bone,multiply(boneFrame(from,to,preferred),inverse(local)));};
  align(upper,upperOffset,start,joint);align(lower,lowerOffset,point(world[lower]),target);
  set(end,frame.orientation.map((value,index)=>({value,error:frame.orientationError[index]})));
  solvePoolHierarchyLimb(pose,upper,lower,end,frame.translation,pole,frame.orientation);
  if(world.some((matrix,bone)=>matrix.some((value,index)=>value.value!==pose.world[bone][index])))throw new Error('Pool rail arithmetic differs from the actual fixed-hierarchy arm evaluator.');
  const worldError=world[end].map(value=>value.error),desired=[...frame.orientation];desired.splice(12,3,...frame.translation);
  if(worldError.some(value=>!Number.isFinite(value)||value<0))throw new Error('Pool rail construction has unresolved operation error.');
  for(let at=0;at<16;at++){
    const serialization=at>=12&&at<15?frame.translationError[at-12]:frame.orientationError[at];
    if(Math.abs(pose.world[end][at]-desired[at])>poolUpper(worldError[at]+serialization))throw new Error('Pool reconstructed rail frame exceeds its derived operation bound.');
  }
  const ancestors=[];for(let bone=end;bone>=0;bone=pose.bundle.bones[bone].parent)ancestors.push({bone,basis:[...pose.basis[bone]],rest:[...pose.rest[bone]],inverse:[...pose.inverse[bone]],world:[...pose.world[bone]]});
  let owners=constructions.get(frame);if(!owners){owners=new WeakMap();constructions.set(frame,owners);}
  owners.set(pose,{bounds:Object.freeze({worldError:Object.freeze(worldError)}),world:[...pose.world[end]],inverse:[...pose.inverse[end]],geometry:expected.geometry,rigKey:rigKey(pose.bundle),ancestors});
}

export function requirePoolRailConstruction(frame:PoolRailContactFrame,pose:PoolHierarchy):Bounds {
  requirePoolRailFrameInstance(frame,pose.inverse[frame.bone]);const proof=constructions.get(frame)?.get(pose);
  if(!proof||proof.world.some((value,at)=>value!==pose.world[frame.bone][at])||proof.inverse.some((value,at)=>value!==pose.inverse[frame.bone][at]))throw new Error('Pool rail frame has no unchanged target-to-arm construction.');
  if(proof.rigKey!==rigKey(pose.bundle)||proof.rigKey!==rigKey(proof.geometry.manifest))throw new Error('Pool rail actual selected rig changed after construction.');
  for(const {bone,basis,rest,inverse,world} of proof.ancestors)if(basis.some((value,at)=>value!==pose.basis[bone][at])||rest.some((value,at)=>value!==pose.rest[bone][at])||inverse.some((value,at)=>value!==pose.inverse[bone][at])||world.some((value,at)=>value!==pose.world[bone][at]))throw new Error('Pool rail hierarchy changed after its construction.');
  return proof.bounds;
}
