import type {PoolPoseControl,PoolIntervalLimb,PoolLimbState} from './pool-contact-evaluator.js';
import {canonicalPoolValue} from './pool-contact-identity.js';
import type {Vec3} from './math.js';
import {ownPoolSourcePolicy,type PoolSourcePolicy} from './pool-source-policy.js';
import {requirePoolPreparedRailGeometry} from './pool-rail-contact-frame.js';
import {clonePoolMatrix} from './pool-matrix-producer.js';

export interface PoolPoseProgram {preferenceBasis:number[][];controls:PoolPoseControl[];policy:PoolSourcePolicy}
const state=(value:PoolLimbState):PoolLimbState=>{if(value.attached)requirePoolPreparedRailGeometry(value.attached.geometry);return Object.freeze({target:Object.freeze([...value.target]) as unknown as Vec3,pole:Object.freeze([...value.pole]) as unknown as Vec3,orientation:Object.freeze([...value.orientation]),
  ...(value.attached?{attached:Object.freeze({...value.attached,source:Object.freeze({...value.attached.source}),rawOrientation:Object.freeze([...value.attached.rawOrientation])})}:{})});};

/** A node stores the input to its final program, never the already evaluated output. */
export function makePoolPoseProgram(preferenceBasis:readonly number[][],controls:readonly PoolPoseControl[],policy:PoolSourcePolicy):PoolPoseProgram {
  const basis=Object.freeze(preferenceBasis.map(matrix=>Object.freeze(clonePoolMatrix(matrix)))),owned=Object.freeze(controls.map(control=>Object.freeze({upper:control.upper,lower:control.lower,end:control.end,
    anchor:Object.freeze([...control.anchor]) as typeof control.anchor,...(control.legFrame?{legFrame:control.legFrame}:{}),state:state(control.state)})));
  return Object.freeze({preferenceBasis:basis,controls:owned,policy:ownPoolSourcePolicy(policy)}) as unknown as PoolPoseProgram;
}

export function poolNodeProgramControls(node:PoolPoseProgram):PoolIntervalLimb[] {
  return node.controls.map(({state,...chain})=>({...chain,from:state,to:state}));
}

export function poolIntervalProgramControls(left:PoolPoseProgram,right:PoolPoseProgram):PoolIntervalLimb[] {
  if(left.controls.length!==right.controls.length)throw new Error('Pool node programs have incompatible limb ownership.');
  return left.controls.map(({state:from,...chain},at)=>{
    const {state:to,...next}=right.controls[at];
    if(canonicalPoolValue(chain)!==canonicalPoolValue(next))throw new Error('Pool node programs have incompatible limb ownership.');
    return {...chain,from,to};
  });
}

export function requirePoolIntervalProgram(left:PoolPoseProgram,right:PoolPoseProgram,controls:readonly PoolIntervalLimb[]):void {
  if(canonicalPoolValue(poolIntervalProgramControls(left,right))!==canonicalPoolValue(controls))throw new Error('Pool interval controls differ from their authoritative node programs.');
}
