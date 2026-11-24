import {boneFrame,scale,solveLimb,sub,transform,type Vec3} from './math.js';
import type {PoolSourceLocation,PoolSupportLocation} from './pool-source-policy.js';
import {interpolateTransform} from './motion.js';
import {resolvePoolRailContactFrame,requirePoolRailGeometryPair,type PoolPreparedRailGeometry} from './pool-rail-contact-frame.js';
import {PoolTrialRefusal} from './pool-trial-work.js';
import {bones as poolBones} from '../../../../assets/models/sims/character-creator/export/manifest.json';

export interface PreparedPoolLimb {
  start:Vec3;target:Vec3;pole:Vec3;lengths:readonly [number,number];
  orientation:readonly number[];anchor:readonly [number,number,number,number];
  upperReference:readonly number[];lowerReference:readonly number[];
}
export interface PoolAttachedRailGoal {source:PoolSupportLocation;geometry:PoolPreparedRailGeometry;parameter:number;rawOrientation:readonly number[];activeVertex:number}
export interface PoolLimbState {target:Vec3;pole:Vec3;orientation:readonly number[];attached?:PoolAttachedRailGoal;kneeOrbit?:number}
/** Tangent of half the signed angle about the ankle-to-hip chord. */
export function validatePoolKneeOrbit(value:unknown,orientedFoot:boolean):asserts value is number|undefined {
  if(value!==undefined&&(!orientedFoot||typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>1))
    throw new Error('Invalid pool knee orbit for this limb.');
}
export interface PoolLimbChain {
  upper:number;lower:number;end:number;anchor:readonly [number,number,number,number];
  legFrame?:'source-entry-0';
}
export interface PoolPoseControl extends PoolLimbChain {state:PoolLimbState}
export interface PoolIntervalLimb extends PoolLimbChain {from:PoolLimbState;to:PoolLimbState}
export function poolKneeOrbitOwner(control:{upper:unknown;lower:unknown;end:unknown;legFrame?:unknown}):boolean {
  if(control.legFrame!=='source-entry-0'||typeof control.end!=='number'||typeof control.lower!=='number'||typeof control.upper!=='number')return false;
  const end=poolBones[control.end],lower=poolBones[control.lower],upper=poolBones[control.upper];
  return !!end&&!!lower&&!!upper&&(end.name==='foot.L'||end.name==='foot.R')&&end.parent===control.lower&&lower.parent===control.upper&&
    lower.name==='shin.'+end.name.slice(-1)&&upper.name==='thigh.'+end.name.slice(-1);
}

const same=(left:readonly number[],right:readonly number[])=>left.length===right.length&&left.every((value,at)=>value===right[at]);
export function requireLiteralPoolRailFrame(goal:PoolAttachedRailGoal,expected:{target?:Vec3;orientation?:readonly number[]},location:PoolSupportLocation=goal.source){
  if(!Number.isSafeInteger(goal.activeVertex)||goal.activeVertex<0||!Number.isFinite(goal.parameter)||
    goal.rawOrientation.length!==16||!Array.from(goal.rawOrientation).every(Number.isFinite))
    throw new Error('Malformed pool attachment data.');
  if((expected.target===undefined)!==(expected.orientation===undefined))throw new Error('Incomplete literal pool endpoint.');
  const resolve=(at:PoolSupportLocation)=>{
    let frame:ReturnType<typeof resolvePoolRailContactFrame>;
    try{frame=resolvePoolRailContactFrame(goal.geometry,goal.rawOrientation,goal.parameter,undefined,at);}
    catch(error){if(error instanceof PoolTrialRefusal)throw new Error('Pool endpoint has no valid literal attachment.',{cause:error});throw error;}
    if(frame.activeVertex!==goal.activeVertex||expected.target&&!same(frame.translation,expected.target)||expected.orientation&&!same(frame.orientation,expected.orientation))
      throw new Error('Pool attached endpoint differs from its literal rail construction.');
    return frame;
  };
  const original=resolve(goal.source);
  return location.action===goal.source.action&&location.phase===goal.source.phase&&location.limb===goal.source.limb?original:resolve(location);
}
/** Exact endpoint ownership and stationary controls precede the unchanged moving interpolation. */
export function interpolatePoolLimbState(control:PoolIntervalLimb,amount:number):PoolLimbState {
  if(control.from.kneeOrbit!==undefined||control.to.kneeOrbit!==undefined){
    const leg=poolKneeOrbitOwner(control);
    validatePoolKneeOrbit(control.from.kneeOrbit,leg&&!control.from.attached);
    validatePoolKneeOrbit(control.to.kneeOrbit,leg&&!control.to.attached);
  }
  if(amount===0)return control.from;if(amount===1)return control.to;
  const {from,to}=control;
  const vector=(a:Vec3,b:Vec3):Vec3=>same(a,b)?a:[a[0]+(b[0]-a[0])*amount,a[1]+(b[1]-a[1])*amount,a[2]+(b[2]-a[2])*amount];
  let attached:PoolAttachedRailGoal|undefined;
  if(from.attached&&to.attached){
    const a=from.attached,b=to.attached;
    requirePoolRailGeometryPair(a.geometry,b.geometry);
    if(a.activeVertex!==b.activeVertex){
      requireLiteralPoolRailFrame(a,from);requireLiteralPoolRailFrame(b,to);
      throw new PoolTrialRefusal('Pool attached interval has an unresolved active-extremum transition.');
    }
    attached={source:a.source.action===b.source.action?{action:a.source.action,limb:a.source.limb,phase:a.source.phase===b.source.phase?a.source.phase:a.source.phase+(b.source.phase-a.source.phase)*amount}:a.source,geometry:a.geometry,activeVertex:a.activeVertex,parameter:a.parameter===b.parameter?a.parameter:a.parameter+(b.parameter-a.parameter)*amount,
      rawOrientation:same(a.rawOrientation,b.rawOrientation)?a.rawOrientation:interpolateTransform(a.rawOrientation,b.rawOrientation,amount)};
  }
  if(attached)return {target:from.target,pole:vector(from.pole,to.pole),orientation:from.orientation,attached};
  const a=from.kneeOrbit??0,b=to.kneeOrbit??0,orbit=a===b?a:a+(b-a)*amount;
  return {target:vector(from.target,to.target),pole:vector(from.pole,to.pole),orientation:same(from.orientation,to.orientation)?from.orientation:interpolateTransform(from.orientation,to.orientation,amount),...(orbit?{kneeOrbit:orbit}:{})};
}

/** Resolve geometry-owned attached goals before the complete anatomical limb evaluator. */
export function resolvePoolLimbState(control:PoolIntervalLimb,amount:number,actualLocation?:PoolSourceLocation){
  const state=interpolatePoolLimbState(control,amount),goal=state.attached;
  if(!goal)return {state};
  if(control.end!==goal.geometry.bone||!same(control.anchor,[0,0,0,1]))throw new Error('Pool attached goal has a different anatomical owner.');
  if(!actualLocation&&control.from.attached&&control.to.attached&&control.from.attached.source.action!==control.to.attached.source.action)throw new Error('Pool shared attached interval needs its actual observation location.');
  const location=actualLocation?{...actualLocation,limb:goal.source.limb}:goal.source;
  if(amount===0||amount===1){
    const railFrame=requireLiteralPoolRailFrame(goal,state,location);
    return {state:{...state,target:railFrame.translation,orientation:railFrame.orientation},railFrame};
  }
  let railFrame:ReturnType<typeof resolvePoolRailContactFrame>;
  try{railFrame=resolvePoolRailContactFrame(goal.geometry,goal.rawOrientation,goal.parameter,goal.activeVertex,location);}
  catch(error){
    if(!(error instanceof PoolTrialRefusal))throw error;
    if(!control.from.attached||!control.to.attached)throw new Error('Pool interior has no pair of owned rail endpoints.',{cause:error});
    requirePoolRailGeometryPair(control.from.attached.geometry,control.to.attached.geometry);
    requireLiteralPoolRailFrame(control.from.attached,control.from);requireLiteralPoolRailFrame(control.to.attached,control.to);
    throw error;
  }
  return {state:{...state,target:railFrame.translation,orientation:railFrame.orientation},railFrame};
}

/** Closed-form contact composition. The prepared surface anchor stays on its target. */
export function evaluatePoolLimb(control:PreparedPoolLimb){
  const {start,target,pole,lengths,anchor}=control;
  if(anchor[3]<=0||!anchor.every(Number.isFinite))throw new Error('Invalid rigid pool contact coefficient.');
  const rotation=[...control.orientation];rotation.splice(12,3,0,0,0);
  const offset=transform(rotation,[anchor[0],anchor[1],anchor[2]]);
  const end=scale(sub(target,offset),1/anchor[3]);
  const joint=solveLimb(start,end,lengths[0],lengths[1],pole);
  const endMatrix=[...rotation];endMatrix.splice(12,3,...end);
  return {joint,end,upperMatrix:boneFrame(start,joint,control.upperReference),
    lowerMatrix:boneFrame(joint,end,control.lowerReference),endMatrix};
}
