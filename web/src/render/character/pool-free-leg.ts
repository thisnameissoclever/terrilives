import type {PoolHierarchy} from './pool-canonical-pose.js';
import {solvePoolHierarchyLimb} from './pool-canonical-pose.js';
import {preparePoolFreeLeg,requirePoolFreeLegPlan,requirePoolMatrixRepresentation,type PoolFreeLegPlan} from './pool-matrix-producer.js';
import {vector,matrix,identity,point,multiply,inverse,boneFrame,properRotation,solve,length,type M,type V} from './pool-matrix-arithmetic.js';
import {poolUpper} from './pool-arithmetic.js';
import {poolLegFrameDiagnostic} from './pool-oriented-leg.js';
import type {Vec3} from './math.js';
import {requirePoolFreeFootClearanceReference,type PoolFreeFootClearanceReference} from './pool-foot-contact-frame.js';

const sourceKey=(pose:PoolHierarchy)=>JSON.stringify({source:pose.bundle.sourceSha256,bones:pose.bundle.bones,standing:pose.bundle.basisActions.pool_enter?.[0]});
interface FreeConstruction {source:string;plan:PoolFreeLegPlan;expectedLower:readonly {value:number;error:number}[];lowerError:number[];ancestors:{bone:number;basis:number[];rest:number[];inverse:number[];world:number[]}[];
  reference?:PoolFreeFootClearanceReference;target:readonly number[];orientation:readonly number[];worldError:readonly number[]}
const constructions=new WeakMap<PoolHierarchy,Map<number,FreeConstruction>>();

/** Trace the existing free goal reconstruction; this creates no contact certificate. */
export function solvePoolFreeLeg(pose:PoolHierarchy,upper:number,lower:number,end:number,target:Vec3,orientation:readonly number[],clearanceReference?:PoolFreeFootClearanceReference,kneeOrbit?:number):PoolFreeLegPlan {
  const clearance=clearanceReference?requirePoolFreeFootClearanceReference(clearanceReference,target,orientation,pose.inverse[end],pose.bundle):undefined;
  if(clearanceReference&&clearanceReference.bone!==end)throw new Error('Pool free foot reference names another limb.');
  const plan=preparePoolFreeLeg(pose,upper,lower,end,target,kneeOrbit),reference=requirePoolFreeLegPlan(plan,pose,target);
  const owned=(values:readonly number[]):M=>{const errors=requirePoolMatrixRepresentation(values);return values.map((value,index)=>({value,error:errors[index]}));};
  const rest=pose.rest.map(owned),inverses=rest.map(inverse),basis=pose.basis.map(owned);let world:M[]=[];
  const compose=()=>{world=[];for(let bone=0;bone<rest.length;bone++){const parent=pose.bundle.bones[bone].parent,local=parent<0?rest[bone]:multiply(inverses[parent],rest[bone]),animated=multiply(local,basis[bone]);world.push(parent<0?animated:multiply(world[parent],animated));}};
  compose();
  const set=(bone:number,rotation:M)=>{const parent=pose.bundle.bones[bone].parent,parentFrame=multiply(world[parent],multiply(inverses[parent],rest[bone]));basis[bone]=properRotation(multiply(inverse(parentFrame),rotation));compose();};
  const upperOffset=point(multiply(inverses[upper],rest[lower])),lowerOffset=point(multiply(inverses[lower],rest[end])),start=point(world[upper]),goal=vector(target);
  const joint=solve(start,goal,length(upperOffset),length(lowerOffset),reference.pole as unknown as V);
  const align=(bone:number,offset:V,from:V,to:V)=>{const local=boneFrame(vector([0,0,0]),offset,identity()),preferred=multiply(world[bone],local);set(bone,multiply(boneFrame(from,to,preferred),inverse(local)));};
  align(upper,upperOffset,start,joint);align(lower,lowerOffset,point(world[lower]),goal);
  set(end,clearance?orientation.map((value,at)=>({value,error:clearance.orientationError[at]})):matrix(orientation));
  solvePoolHierarchyLimb(pose,upper,lower,end,target,plan.pole,orientation);
  if(world.some((value,bone)=>value.some((entry,at)=>entry.value!==pose.world[bone][at])))throw new Error('Pool free-leg arithmetic differs from the actual configured evaluator.');
  const desired=[...orientation];desired.splice(12,3,...target);
  if(world[end].some((entry,at)=>!Number.isFinite(entry.error)||entry.error<0||Math.abs(entry.value-desired[at])>poolUpper(entry.error)))throw new Error('Pool free-leg reconstruction exceeds its derived operation bound.');
  const ancestors=[];for(let bone=end;bone>=0;bone=pose.bundle.bones[bone].parent)ancestors.push({bone,basis:[...pose.basis[bone]],rest:[...pose.rest[bone]],inverse:[...pose.inverse[bone]],world:[...pose.world[bone]]});
  const owners=constructions.get(pose)??new Map<number,FreeConstruction>();owners.set(end,{source:sourceKey(pose),plan,expectedLower:reference.expectedLower,lowerError:basis[lower].map(entry=>entry.error),ancestors,
    reference:clearanceReference,target:Object.freeze([...target]),orientation:Object.freeze([...orientation]),worldError:Object.freeze(world[end].map(entry=>entry.error))});constructions.set(pose,owners);
  observeConstructedPoolFreeLeg(pose,plan);return plan;
}

/** Detached postsolve bounds retain the exact reference and the literal free-goal producer. */
export function requirePoolFreeFootConstruction(pose:PoolHierarchy,plan:PoolFreeLegPlan,reference:PoolFreeFootClearanceReference) {
  observeConstructedPoolFreeLeg(pose,plan);
  const owner=constructions.get(pose)!.get(plan.end)!;
  if(owner.reference!==reference||reference.bone!==plan.end||owner.target.some((value,axis)=>value!==plan.target[axis]))throw new Error('Pool free foot has no matching clearance reference producer.');
  const premise=requirePoolFreeFootClearanceReference(reference,owner.target,owner.orientation,pose.inverse[plan.end],pose.bundle);
  return Object.freeze({target:Object.freeze([...owner.target]),orientation:Object.freeze([...owner.orientation]),worldError:Object.freeze([...owner.worldError]),premise});
}

export function observeConstructedPoolFreeLeg(pose:PoolHierarchy,plan:PoolFreeLegPlan){
  const owner=constructions.get(pose)?.get(plan.end);
  if(!owner||owner.plan!==plan||owner.source!==sourceKey(pose)||owner.ancestors.some(input=>input.basis.some((value,at)=>value!==pose.basis[input.bone][at])||input.rest.some((value,at)=>value!==pose.rest[input.bone][at])||input.inverse.some((value,at)=>value!==pose.inverse[input.bone][at])||input.world.some((value,at)=>value!==pose.world[input.bone][at])))throw new Error('Pool free leg has no unchanged constructed source hinge.');
  const actual=pose.basis[plan.lower],residuals=actual.map((value,at)=>Math.abs(value-owner.expectedLower[at].value)),bounds=owner.lowerError.map((value,at)=>poolUpper(value+owner.expectedLower[at].error));
  if(residuals.some((value,at)=>value>bounds[at]))throw new Error('Pool free knee differs from its source hinge beyond the derived reconstruction bound.');
  return {side:pose.bundle.bones[plan.lower].name.slice(-1),bone:plan.lower,mode:'free' as const,admissible:true as const,admitted:true as const,sourceFrame:plan.referenceFrame,localAxis:plan.localAxis,axisInBody:plan.axisInBody,flexion:plan.flexion,branch:plan.branch,diagnostic:poolLegFrameDiagnostic(actual,plan.localAxis),maximumMatrixResidual:Math.max(...residuals),maximumReconstructionBound:Math.max(...bounds)};
}
