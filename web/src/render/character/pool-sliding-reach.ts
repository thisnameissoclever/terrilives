import {add,sub,scale,dot,length,unit,type Vec3} from './math.js';
import type {PoolCycleSource} from './pool-cycle-source.js';
import {makePoolPoseProgram,type PoolPoseProgram} from './pool-pose-program.js';
import {poolIntervalPreference} from './pool-contact-sample.js';
import {translatePoolRoot} from './pool-canonical-pose.js';
import {configuredPoolChainReach,poolRootRayIntervals,projectPoolEntryRoot,poolChainReachable} from './pool-entry-domain.js';
import type {PoolAttachedRailGoal} from './pool-contact-evaluator.js';
import {resolvePoolRailContactFrame} from './pool-rail-contact-frame.js';
import {PoolTrialRefusal} from './pool-trial-work.js';

const pos=(m:readonly number[]):Vec3=>[m[12],m[13],m[14]];
const names=['footL','footR','handL','handR'] as const;
const blend=(a:Vec3,b:Vec3,t:number)=>add(a,scale(sub(b,a),t));
const magnitude=(q:{numerator:string;exponent:number})=>Number(q.numerator)*2**q.exponent;

/** Maximum bow from the straight endpoint chord for an attached wrist moving along a piecewise-linear rail. */
export function wristChordDeviation(a:PoolAttachedRailGoal,b:PoolAttachedRailGoal){
 if(a.activeVertex!==b.activeVertex||a.geometry.surface!==b.geometry.surface)throw new Error('A sliding wrist must retain its physical surface and vertex.');
 const coefficient=a.geometry.coefficients[a.geometry.vertices.indexOf(a.activeVertex)],weight=magnitude(coefficient[3]);
 const pointAt=(g:PoolAttachedRailGoal)=>resolvePoolRailContactFrame(g.geometry,g.rawOrientation,g.parameter,g.activeVertex,g.source).targetPoint;
 const from=pointAt(a),to=pointAt(b),travel=b.parameter-a.parameter;
 let rail=0;
 if(travel)for(const e of a.geometry.edges){
  const t=(e.edge.fromParameter-a.parameter)/travel;
  if(t>0&&t<1)rail=Math.max(rail,length(sub(e.from,blend(from,to,t)))/weight);
 }
 let trace=0;for(const i of [0,1,2,4,5,6,8,9,10])trace+=a.rawOrientation[i]*b.rawOrientation[i];
 const angle=Math.acos(Math.max(-1,Math.min(1,(trace-1)/2))),arm=Math.hypot(...coefficient.slice(0,3).map(magnitude))/weight;
 // The interpolation error of a rotating offset is bounded by its second derivative divided by eight.
 return rail+arm*angle*angle/8;
}

/** The lower body uses a fixed facing. Shoulder travel is linear between keys, but the held wrist follows the tube. */
export function fitSlidingReach(source:PoolCycleSource,programs:Map<number,PoolPoseProgram>,fromUnit:number){
 const keys=[...programs.keys()].filter(u=>u>=fromUnit).sort((a,b)=>a-b);
 const {bundle,neutral}=source,hip=bundle.bones.findIndex(b=>b.name==='hips'),guard=source.fixture.rails[0].radius/32;
 const reach=names.map(name=>{const a=source.anatomy[name];return configuredPoolChainReach(neutral.rest,a.upper,a.lower,a.end);});
 const limits=keys.map(()=>reach.map(r=>r.maximum-guard));
 for(let j=1;j<keys.length;j++){
  const left=programs.get(keys[j-1])!,right=programs.get(keys[j])!;
  for(const i of [2,3]){
   const a=left.controls[i].state.attached,b=right.controls[i].state.attached;if(!a||!b)continue;
   const maximum=reach[i].maximum-wristChordDeviation(a,b)-guard;
   limits[j-1][i]=Math.min(limits[j-1][i],maximum);limits[j][i]=Math.min(limits[j][i],maximum);
  }
 }
 for(const [j,u] of keys.entries()){
  const program=programs.get(u)!;
  const p=poolIntervalPreference(bundle,neutral.rest,neutral.inverse,program.preferenceBasis,program.preferenceBasis,0,true),h=pos(p.world[hip]);
  if([2,3].every(i=>!program.controls[i].state.attached||length(sub(program.controls[i].state.target,pos(p.world[program.controls[i].upper])))<=limits[j][i]))continue;
  const fixed=program.controls.map((c,i)=>i<2?program.policy[names[i]].mode!=='free':!!c.state.attached);
  const constraints=program.controls.flatMap((c,i)=>fixed[i]?[{limb:names[i],
   center:sub(c.state.target,sub(pos(p.world[c.upper]),h)),reach:{...reach[i],maximum:limits[j][i]}}]:[]);
  let chosen=projectPoolEntryRoot(h,constraints,{minimum:[-1,-1,0],maximum:[1,2,3]}).projected;
  if(chosen){
   const centre=chosen,inner=constraints.find(c=>length(sub(centre,c.center))<=c.reach.minimum);
   if(inner){
    chosen=null;const d=sub(centre,inner.center),rays:Vec3[]=[length(d)?unit(d):[0,1,0],[0,1,0],[0,0,1]];
    for(const ray of rays){
     for(const r of poolRootRayIntervals(ray,constraints.map(c=>({...c,center:sub(c.center,centre)})))){
      const lo=Math.max(0,r.minimum);if(lo>=r.maximum)continue;
      const next=add(centre,scale(ray,lo+Math.min(guard,(r.maximum-lo)/2)));
      if(constraints.every(c=>poolChainReachable(c.reach,next,c.center))){chosen=next;break;}
     }
     if(chosen)break;
    }
   }
  }
  if(!chosen)throw new PoolTrialRefusal('The outer rail bend has no common reach at the adjacent support.',{cause:{u,limits:limits[j],h}});
  const delta=sub(chosen,h);translatePoolRoot(p,delta);
  programs.set(u,makePoolPoseProgram(p.basis,program.controls.map((c,i)=>({...c,state:{...c.state,
   target:fixed[i]?c.state.target:add(c.state.target,delta),pole:add(c.state.pole,delta)}})),program.policy));
 }
}
