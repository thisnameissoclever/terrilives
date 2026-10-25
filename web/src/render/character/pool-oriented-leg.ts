import type {PoolHierarchy} from './pool-canonical-pose.js';
import type {PoolFootContactFrame} from './pool-foot-contact-frame.js';
import {preparePoolOrientedLeg,requirePoolOrientedLegReference,type PoolOrientedLegPlan} from './pool-matrix-producer.js';
import {solveCertifiedPoolFoot,requirePoolFootConstruction} from './pool-limb-construction-arithmetic.js';
import {length,transform,sub,type Vec3} from './math.js';
import {poolUpper} from './pool-arithmetic.js';
import {orientedPoolLegMath} from './pool-oriented-leg-math.js';
import {matrix,vector} from './pool-matrix-arithmetic.js';
import {composeSkeletonPose} from './pose-joints.js';
import {solvePoolHierarchyLimb} from './pool-canonical-pose.js';

/** Runtime uses the same complete frame program as the traced preparation producer. */
export function evaluatePoolOrientedLeg(pose:PoolHierarchy,upper:number,lower:number,end:number,target:Vec3,orientation:readonly number[]){
  const body=pose.bundle.bones[upper]?.parent,source=pose.bundle.basisActions.pool_enter?.[0],side=pose.bundle.bones[lower]?.name.slice(-1);
  if(body===undefined||pose.bundle.bones[body]?.name!=='hips'||pose.bundle.bones[upper]?.name!=='thigh.'+side||pose.bundle.bones[lower]?.name!=='shin.'+side
      ||pose.bundle.bones[end]?.name!=='foot.'+side||pose.bundle.bones[lower].parent!==upper||pose.bundle.bones[end].parent!==lower||!source)throw new Error('Pool interval has no configured source-oriented leg chain.');
  const result=orientedPoolLegMath({upper,lower,end,body,rest:pose.rest.map(matrix),inverses:pose.inverse.map(matrix),basis:pose.basis.map(matrix),world:pose.world.map(matrix),
    sourceUpper:matrix(source[upper]),sourceLower:matrix(source[lower]),target:vector(target)});
  pose.basis[upper]=result.upperBasis.map(value=>value.value);pose.basis[lower]=result.lowerBasis.map(value=>value.value);
  pose.world=composeSkeletonPose(pose.bundle.bones,pose.rest,pose.basis);
  const pole=pose.world[lower].slice(12,15) as unknown as Vec3;
  solvePoolHierarchyLimb(pose,upper,lower,end,target,pole,orientation);return result;
}

/** Source-derived complete hinge meaning, separate from a scalar signed-X diagnostic. */
export function poolLegFrameDiagnostic(relative:readonly number[],axis:Vec3){
  const rotation=[...relative];rotation.splice(12,3,0,0,0);
  const moved=transform(rotation,axis),cosine=(relative[0]+relative[5]+relative[10]-1)/2;
  const sine=((relative[6]-relative[9])*axis[0]+(relative[8]-relative[2])*axis[1]+(relative[1]-relative[4])*axis[2])/2;
  return {axisMotion:length(sub(moved,axis)),orientedSpin:Math.atan2(sine,cosine),signedX:Math.atan2(relative[6]-relative[9],relative[5]+relative[10])};
}

export function solvePoolOrientedFoot(pose:PoolHierarchy,upper:number,lower:number,end:number,frame:PoolFootContactFrame):PoolOrientedLegPlan {
  const plan=preparePoolOrientedLeg(pose,upper,lower,end,frame);
  solveCertifiedPoolFoot(pose,upper,lower,end,frame,plan.pole,plan);return plan;
}

export function observeConstructedPoolLeg(pose:PoolHierarchy,frame:PoolFootContactFrame,plan:PoolOrientedLegPlan){
  const source=requirePoolOrientedLegReference(plan,pose,frame),construction=requirePoolFootConstruction(frame,pose);
  if(construction.legPlan!==plan)throw new Error('Pool foot reconstruction omitted its oriented leg frame.');
  const actual=pose.basis[plan.lower],residuals=actual.map((value,index)=>Math.abs(value-source.expectedLower[index].value));
  const bounds=residuals.map((_,index)=>poolUpper(source.expectedLower[index].error+construction.basisError[plan.lower][index]));
  if(residuals.some((value,index)=>value>bounds[index]))throw new Error('Pool knee differs from its constructive source hinge beyond the derived reconstruction bound.');
  return {side:pose.bundle.bones[plan.lower].name.slice(-1),bone:plan.lower,admissible:true as const,sourceFrame:plan.referenceFrame,localAxis:plan.localAxis,axisInBody:plan.axisInBody,flexion:plan.flexion,branch:plan.branch,
    diagnostic:poolLegFrameDiagnostic(actual,plan.localAxis),maximumMatrixResidual:Math.max(...residuals),maximumReconstructionBound:Math.max(...bounds),admitted:true as const};
}
