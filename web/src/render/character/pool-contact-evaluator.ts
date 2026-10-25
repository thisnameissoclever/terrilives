import {boneFrame,scale,solveLimb,sub,transform,type Vec3} from './math.js';
import type {PoolSourceLocation,PoolSupportLocation} from './pool-source-policy.js';
import {interpolateTransform} from './motion.js';
import {resolvePoolRailContactFrame,requirePoolRailGeometryPair,type PoolPreparedRailGeometry} from './pool-rail-contact-frame.js';

export interface PreparedPoolLimb {
  start:Vec3;target:Vec3;pole:Vec3;lengths:readonly [number,number];
  orientation:readonly number[];anchor:readonly [number,number,number,number];
  upperReference:readonly number[];lowerReference:readonly number[];
}
export interface PoolAttachedRailGoal {source:PoolSupportLocation;geometry:PoolPreparedRailGeometry;parameter:number;rawOrientation:readonly number[];activeVertex:number}
export interface PoolLimbState {target:Vec3;pole:Vec3;orientation:readonly number[];attached?:PoolAttachedRailGoal}
export interface PoolLimbChain {
  upper:number;lower:number;end:number;anchor:readonly [number,number,number,number];
  legFrame?:'source-entry-0';
}
export interface PoolPoseControl extends PoolLimbChain {state:PoolLimbState}
export interface PoolIntervalLimb extends PoolLimbChain {from:PoolLimbState;to:PoolLimbState}

const same=(left:readonly number[],right:readonly number[])=>left.length===right.length&&left.every((value,at)=>value===right[at]);
/** Exact endpoint ownership and stationary controls precede the unchanged moving interpolation. */
export function interpolatePoolLimbState(control:PoolIntervalLimb,amount:number):PoolLimbState {
  if(amount===0)return control.from;if(amount===1)return control.to;
  const {from,to}=control;
  const vector=(a:Vec3,b:Vec3):Vec3=>same(a,b)?a:[a[0]+(b[0]-a[0])*amount,a[1]+(b[1]-a[1])*amount,a[2]+(b[2]-a[2])*amount];
  let attached:PoolAttachedRailGoal|undefined;
  if(from.attached&&to.attached){
    const a=from.attached,b=to.attached;
    requirePoolRailGeometryPair(a.geometry,b.geometry);
    if(a.activeVertex!==b.activeVertex)throw new Error('Pool attached interval has an unresolved active-extremum transition.');
    attached={source:a.source.action===b.source.action?{action:a.source.action,limb:a.source.limb,phase:a.source.phase===b.source.phase?a.source.phase:a.source.phase+(b.source.phase-a.source.phase)*amount}:a.source,geometry:a.geometry,activeVertex:a.activeVertex,parameter:a.parameter===b.parameter?a.parameter:a.parameter+(b.parameter-a.parameter)*amount,
      rawOrientation:same(a.rawOrientation,b.rawOrientation)?a.rawOrientation:interpolateTransform(a.rawOrientation,b.rawOrientation,amount)};
  }
  if(attached)return {target:from.target,pole:vector(from.pole,to.pole),orientation:from.orientation,attached};
  return {target:vector(from.target,to.target),pole:vector(from.pole,to.pole),orientation:same(from.orientation,to.orientation)?from.orientation:interpolateTransform(from.orientation,to.orientation,amount),...(attached?{attached}:{})};
}

/** Resolve geometry-owned attached goals before the complete anatomical limb evaluator. */
export function resolvePoolLimbState(control:PoolIntervalLimb,amount:number,actualLocation?:PoolSourceLocation){
  const state=interpolatePoolLimbState(control,amount),goal=state.attached;
  if(!goal)return {state};
  if(control.end!==goal.geometry.bone||!same(control.anchor,[0,0,0,1]))throw new Error('Pool attached goal has a different anatomical owner.');
  if(!actualLocation&&control.from.attached&&control.to.attached&&control.from.attached.source.action!==control.to.attached.source.action)throw new Error('Pool shared attached interval needs its actual observation location.');
  const location=actualLocation?{...actualLocation,limb:goal.source.limb}:goal.source;
  const railFrame=resolvePoolRailContactFrame(goal.geometry,goal.rawOrientation,goal.parameter,goal.activeVertex,location);
  if((amount===0||amount===1)&&(!same(state.target,railFrame.translation)||!same(state.orientation,railFrame.orientation)))throw new Error('Pool attached endpoint differs from its literal rail construction.');
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
