import type {PoolHierarchy} from './pool-canonical-pose.js';
import {solvePoolHierarchyLimb} from './pool-canonical-pose.js';
import {requirePoolFootContactFrameInstance,type PoolFootContactFrame} from './pool-foot-contact-frame.js';
import {poolUpper} from './pool-arithmetic.js';
import type {Vec3} from './math.js';
import {vector,identity,point,multiply,inverse,boneFrame,properRotation,solve,length,type M,type V} from './pool-matrix-arithmetic.js';
import {requirePoolMatrixRepresentation,requirePoolOrientedLeg,type PoolOrientedLegPlan} from './pool-matrix-producer.js';
import {canonicalPoolValue} from './pool-contact-identity.js';

interface ConstructionBounds {readonly worldError:readonly number[];readonly legPlan?:PoolOrientedLegPlan;readonly basisError:readonly (readonly number[])[]}
interface Construction {pose:PoolHierarchy;world:number[];inverse:number[];rigKey:string;bounds:ConstructionBounds;ancestors:{bone:number;basis:number[];rest:number[];inverse:number[];world:number[]}[]}
const constructions=new WeakMap<PoolFootContactFrame,WeakMap<PoolHierarchy,Construction>>();
const rigKey=(pose:PoolHierarchy)=>canonicalPoolValue({sourceSha256:pose.bundle.sourceSha256,bones:pose.bundle.bones});

/** Mirror and bound the existing configured IK path, then require exact operation parity. */
export function solveCertifiedPoolFoot(pose:PoolHierarchy,upper:number,lower:number,end:number,frame:PoolFootContactFrame,pole:Vec3,legPlan?:PoolOrientedLegPlan):void {
  requirePoolFootContactFrameInstance(frame,pose.inverse[end],pose.bundle);
  const oriented=legPlan?requirePoolOrientedLeg(legPlan,pose,frame,pole):undefined;
  if(frame.bone!==end)throw new Error('Pool foot certificate names the wrong end bone.');
  const rigidMatrix=(values:readonly number[]):M=>{const errors=requirePoolMatrixRepresentation(values);return values.map((value,index)=>({value,error:errors[index]}));};
  const rest=pose.rest.map(rigidMatrix),inverses=rest.map(inverse),basis=pose.basis.map(rigidMatrix);let world:M[]=[];
  if(inverses.some((matrix,bone)=>matrix.some((value,index)=>value.value!==pose.inverse[bone][index])))throw new Error('Pool hierarchy uses a different inverse from its configured rest producer.');
  const compose=()=>{world=[];for(let bone=0;bone<rest.length;bone++){
    const parent=pose.bundle.bones[bone].parent,local=parent<0?rest[bone]:multiply(inverses[parent],rest[bone]),animated=multiply(local,basis[bone]);
    world.push(parent<0?animated:multiply(world[parent],animated));
  }};
  compose();
  const set=(bone:number,rotation:M)=>{
    const parent=pose.bundle.bones[bone].parent,parentFrame=multiply(world[parent],multiply(inverses[parent],rest[bone]));
    basis[bone]=properRotation(multiply(inverse(parentFrame),rotation));compose();
  };
  const upperOffset=point(multiply(inverses[upper],rest[lower])),lowerOffset=point(multiply(inverses[lower],rest[end])),start=point(world[upper]);
  const target=frame.translation.map((value,axis)=>({value,error:frame.translationError[axis]})) as unknown as V;
  const joint=solve(start,target,length(upperOffset),length(lowerOffset),oriented?.pole??vector(pole));
  const align=(bone:number,offset:V,from:V,to:V)=>{const local=boneFrame(vector([0,0,0]),offset,identity()),preferred=multiply(world[bone],local);set(bone,multiply(boneFrame(from,to,preferred),inverse(local)));};
  align(upper,upperOffset,start,joint);align(lower,lowerOffset,point(world[lower]),target);
  set(end,frame.orientation.map((value,index)=>({value,error:frame.orientationError[index]})));
  solvePoolHierarchyLimb(pose,upper,lower,end,frame.translation,pole,frame.orientation);
  for(let bone=0;bone<world.length;bone++)for(let at=0;at<16;at++)if(world[bone][at].value!==pose.world[bone][at])throw new Error('Pool IK arithmetic trace differs from its actual configured evaluator.');
  const errors=world[end].map(value=>value.error);if(errors.some(value=>!Number.isFinite(value)||value<0))throw new Error('Pool IK construction has an unresolved error bound.');
  const desired=[...frame.orientation];desired.splice(12,3,...frame.translation);
  for(let at=0;at<16;at++){
    const serialization=at>=12&&at<15?frame.translationError[at-12]:frame.orientationError[at];
    if(Math.abs(pose.world[end][at]-desired[at])>poolUpper(errors[at]+serialization))throw new Error('Pool reconstructed foot frame is outside its derived construction bound.');
  }
  const ancestors=[];for(let bone=end;bone>=0;bone=pose.bundle.bones[bone].parent)ancestors.push({bone,basis:[...pose.basis[bone]],rest:[...pose.rest[bone]],inverse:[...pose.inverse[bone]],world:[...pose.world[bone]]});
  let owners=constructions.get(frame);if(!owners){owners=new WeakMap();constructions.set(frame,owners);}
  const bounds=Object.freeze({worldError:Object.freeze(errors),legPlan,basisError:Object.freeze(basis.map(matrix=>Object.freeze(matrix.map(value=>value.error))))});
  owners.set(pose,{pose,world:[...pose.world[end]],inverse:[...pose.inverse[end]],rigKey:rigKey(pose),ancestors,bounds});
}

export function requirePoolFootConstruction(frame:PoolFootContactFrame,pose:PoolHierarchy) {
  requirePoolFootContactFrameInstance(frame,pose.inverse[frame.bone],pose.bundle);
  const proof=constructions.get(frame)?.get(pose);
  if(!proof||proof.pose!==pose||proof.world.some((value,at)=>value!==pose.world[frame.bone][at])||proof.inverse.some((value,at)=>value!==pose.inverse[frame.bone][at]))throw new Error('Pool foot frame has no matching target-to-hierarchy construction.');
  if(proof.rigKey!==rigKey(pose))throw new Error('Pool established-foot rig changed after construction.');
  for(const {bone,basis,rest,inverse,world} of proof.ancestors)if(basis.some((value,at)=>value!==pose.basis[bone][at])||rest.some((value,at)=>value!==pose.rest[bone][at])||inverse.some((value,at)=>value!==pose.inverse[bone][at])||world.some((value,at)=>value!==pose.world[bone][at]))throw new Error('Pool foot hierarchy changed after its contact construction.');
  return proof.bounds;
}
