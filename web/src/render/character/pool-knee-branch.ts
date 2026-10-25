import type {Bundle} from './bundle.js';
import {poolExact,poolExactCompare,poolExactSubtract} from './pool-exact-number.js';

export interface PoolKneePolicy {side:'L'|'R';bone:number;sign:1|-1;referenceAction:'pool_enter';referenceFrame:number;sourceOppositeFrames:number[]}

/** The rig's standing entry sample owns flexion direction; later bad source branches do not. */
export function poolKneePolicies(bundle:Bundle):PoolKneePolicy[] {
  const source=bundle.basisActions.pool_enter;if(!source?.length)throw new Error('Pool anatomy has no authored entry reference.');
  return (['L','R'] as const).map(side=>{
    const bone=bundle.bones.findIndex(bone=>bone.name==='shin.'+side);if(bone<0)throw new Error('Pool anatomy has no configured shin.');
    const signs=source.map(sample=>poolExactCompare(poolExact(sample[bone][6]),poolExact(sample[bone][9]))),referenceFrame=signs.findIndex(sign=>sign!==0);
    if(referenceFrame<0)throw new Error('Pool source has no bent reference establishing knee-side ownership.');
    const sign=signs[referenceFrame] as 1|-1;
    return {side,bone,sign,referenceAction:'pool_enter',referenceFrame,sourceOppositeFrames:signs.flatMap((value,frame)=>value!==0&&value!==sign?[frame]:[])};
  });
}

/** A signed branch predicate, not an invented physiological angle envelope. */
export function observePoolKneeBranch(basis:readonly (readonly number[])[],policy:PoolKneePolicy) {
  const matrix=basis[policy.bone];if(!matrix||matrix.length!==16||matrix.some(value=>!Number.isFinite(value)))throw new Error('Pool knee has no finite canonical basis.');
  const sine=poolExactSubtract(poolExact(matrix[6]),poolExact(matrix[9])),sign=Math.sign(Number(sine.numerator));
  return {side:policy.side,bone:policy.bone,referenceAction:policy.referenceAction,referenceFrame:policy.referenceFrame,requiredSign:policy.sign,
    observedSign:sign,signedFlexion:Math.atan2(matrix[6]-matrix[9],matrix[5]+matrix[10]),admissible:sign===0||sign===policy.sign};
}
