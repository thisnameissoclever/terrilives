import {add,sub,scale,dot,length,type Vec3} from './math.js';
import {interpolateTransform} from './motion.js';
import {poolIntervalPreference} from './pool-contact-sample.js';
import {translatePoolRoot} from './pool-canonical-pose.js';
import {makePoolPoseProgram,type PoolPoseProgram} from './pool-pose-program.js';
import {configuredPoolChainReach,projectPoolEntryRoot} from './pool-entry-domain.js';
import {fitClimbHand} from './pool-climb-hand.js';
import {outwardElbow} from './pool-outward-passage.js';
import {aimOutwardKnee} from './pool-outward-calf.js';
import {fitPoolKneeOrbit} from './pool-knee-orbit-fit.js';
import {resolvePoolRailContactFrame} from './pool-rail-contact-frame.js';
import {PoolTrialRefusal} from './pool-trial-work.js';
import type {PoolCycleSource,PoolHand} from './pool-cycle-source.js';
import type {PoolLimbState} from './pool-contact-evaluator.js';

const point=(m:readonly number[]):Vec3=>[m[12],m[13],m[14]];
const ease=(x:number)=>{const t=Math.max(0,Math.min(1,x));return t*t*(3-2*t);};
const blend=(a:Vec3,b:Vec3,t:number)=>add(a,scale(sub(b,a),t));
const sides=['footL','footR','handL','handR'] as const;

export function wristAtHeight(source:PoolCycleSource,limb:PoolHand,u:number,ref:PoolLimbState,desired:Vec3,shoulder?:Vec3){
 const policy=source.heldClimbWrist(limb,'pool_exit_0',u/source.definition.clockUnits,ref),g=policy.attached!,geom=g.geometry;
 const f=resolvePoolRailContactFrame(geom,g.rawOrientation,g.parameter,g.activeVertex,g.source);
 const w=geom.coefficients[geom.vertices.indexOf(f.activeVertex)][3],weight=Number(w.numerator)*2**w.exponent;
 let best=g.parameter,minimum=Infinity;
 const a=source.anatomy[limb],reach=configuredPoolChainReach(source.neutral.rest,a.upper,a.lower,a.end);
 const chest=Math.hypot(reach.minimum,2*Math.sqrt(reach.lengths[0]*reach.lengths[1])*Math.sin(Math.PI/12));
 for(const edge of geom.edges){
  if(edge.edge.toParameter<=(shoulder?4:3))continue;
  const from=add(f.translation,scale(sub(edge.from,f.targetPoint),1/weight)),d=scale(sub(edge.to,edge.from),1/weight);
  let lo=0,hi=1;
  if(shoulder){
   const dz=shoulder[2]-chest-from[2];
   if(d[2]<0)lo=Math.max(lo,dz/d[2]);else if(d[2]>0)hi=Math.min(hi,dz/d[2]);else if(dz<0)continue;
  }
  if(lo>hi)continue;
  const t=Math.max(lo,Math.min(hi,dot(sub(desired,from),d)/dot(d,d))),delta=length(sub(add(from,scale(d,t)),desired));
  if(delta<minimum){minimum=delta;best=edge.edge.fromParameter+t*(edge.edge.toParameter-edge.edge.fromParameter);}
 }
 if(!Number.isFinite(minimum))throw new PoolTrialRefusal('The outer upright has no wrist target below the descending shoulder.',{cause:{limb,u,shoulder,chest}});
 return source.slideClimbWrist(limb,u,ref,best,policy.pole);
}

/** Lower the pelvis onto each successive step while keeping the lower standing leg extended. */
export function uprightPoolDescent(source:PoolCycleSource,poses:Map<number,PoolPoseProgram>,standing:PoolPoseProgram,lastUnit=source.definition.clockUnits){
 const def=source.definition;if(def.version!==16||!def.forwardHop?.platformTurn)throw new Error('Missing inward ladder descent.');
 const hop=def.forwardHop,turn=hop.platformTurn!,start=turn.rightTurnUnit,begin=poses.get(start)!;
 const {bundle,neutral}=source,hip=bundle.bones.findIndex(b=>b.name==='hips');
 const poseOf=(n:PoolPoseProgram)=>poolIntervalPreference(bundle,neutral.rest,neutral.inverse,n.preferenceBasis,n.preferenceBasis,0,true);
 const upright=poseOf(standing),h0=point(poseOf(begin).world[hip]),hn=point(upright.world[hip]),r=source.fixture.rails[0].radius;
 const reach=sides.map(l=>{const a=source.anatomy[l];return configuredPoolChainReach(neutral.rest,a.upper,a.lower,a.end);});
 const rungLandings=hop.climbKeys.filter(k=>k.unit<=lastUnit&&[42000,32000,22000,12000,5000,0].includes(k.entryUnit??-1)).map(k=>k.unit);
 const points=[{u:start,h:h0}];
 for(const u of rungLandings){
  const n=poses.get(u)!;if(!n)throw new Error('Missing outside rung landing '+u);
  const ankles=n.controls.slice(0,2).map(c=>c.state.target),i=ankles[0][2]<ankles[1][2]?0:1;
  if(ankles.every(p=>Math.abs(p[2]-standing.controls[i].state.target[2])<r)){points.push({u,h:hn});continue;}
  const [thigh,shin]=reach[i].lengths,a=ankles[i],socket=sub(point(upright.world[n.controls[i].upper]),hn);
  const lower=10*Math.PI/180,upper=36*Math.PI/180;
  points.push({u,h:[a[0]-socket[0],a[1]+shin*Math.sin(lower)+thigh*Math.sin(upper)-socket[1],
   a[2]+shin*Math.cos(lower)+thigh*Math.cos(upper)-socket[2]]});
 }
 const held=new Map<PoolHand,{state:PoolLimbState;u:number}>();
 const raised=points[1].u;
 for(const u of hop.climbOutUnits.filter(u=>u>start&&u<=lastUnit&&u<def.clockUnits)){
  const old=poses.get(u)!,j=points.findIndex(p=>p.u>=u),a=points[j-1],b=points[j],phase=u/def.clockUnits;
  const t=(u-a.u)/(b.u-a.u),wanted=blend(a.h,b.h,ease(t));
  const body=poolIntervalPreference(bundle,neutral.rest,neutral.inverse,begin.preferenceBasis,standing.preferenceBasis,ease((u-start)/(raised-start)),true);
  const at=point(body.world[hip]),sockets=old.controls.map(c=>sub(point(body.world[c.upper]),at));
  const wrists=(['handL','handR'] as const).map((l,k)=>{
   if(!old.policy[l].required)return undefined;
   const joint=add(wanted,sockets[k+2]),ref=old.controls[k+2].state,ref0=begin.controls[k+2].state;
   const target=blend(ref0.target,[joint[0],joint[1]-reach[k+2].lengths[0],joint[2]-.18*reach[k+2].lengths[0]],ease((u-start)/(raised-start)));
   return wristAtHeight(source,l,u,ref,target);
  });
  const states=[old.controls[0].state,old.controls[1].state,...wrists];
  const constraints=states.flatMap((s,i)=>s?[{limb:sides[i],center:sub(s.target,sockets[i]),reach:{...reach[i],maximum:reach[i].maximum-r/12}}]:[]);
  const centre=projectPoolEntryRoot(wanted,constraints,{minimum:[-1,-1,0],maximum:[1,2,3]}).projected;
  if(!centre)throw new PoolTrialRefusal('The upright climb cannot reach its installed rung and rail contacts.',{cause:{u,wanted}});
  translatePoolRoot(body,sub(centre,at));
  const controls=old.controls.map((c,k)=>{
   const joint=point(body.world[c.upper]),rest=point(upright.world[c.upper]),end=standing.controls[k].state;
   const guide=add(joint,sub(end.pole,rest));
   if(k<2)return {...c,state:{target:c.state.target,orientation:c.state.orientation,pole:guide}};
   const hand=sides[k] as PoolHand,grip=wrists[k-2];
   if(grip){
    const state=fitClimbHand(source,hand,joint,grip,[3,5]);
    const value={...state,pole:outwardElbow(joint,state.target,guide,reach[k].lengths[0],reach[k].lengths[1],hn[0])};
    held.set(hand,{state:value,u});return {...c,state:value};
   }
   const last=held.get(hand),free=add(joint,sub(end.target,rest)),amount=last?ease((u-last.u)/2400):1;
   const target=last?blend(last.state.target,free,amount):free;
   return {...c,state:{target,pole:guide,orientation:last?interpolateTransform(last.state.orientation,end.orientation,amount):end.orientation}};
  });
  let n=makePoolPoseProgram(body.basis,controls,old.policy);
  for(const [i,l] of (['footL','footR'] as const).entries()){
   const q=old.policy[l],ankle=controls[i].state.target;
   if(!q.required&&q.mode!=='free'&&q.mode!=='approach')continue;
   if(ankle[2]<=controls[1-i].state.target[2]&&ankle[2]>standing.controls[i].state.target[2]+r){
    const tilt=10*Math.PI/180,shin=reach[i].lengths[1];
    n=aimOutwardKnee(source,n,{action:'pool_exit_0',phase},l,add(ankle,[0,shin*Math.sin(tilt),shin*Math.cos(tilt)]));
   }
   const obstacles=['crest','outside3','outside2'].map(p=>source.fixture.solids.find(s=>s.id===def.places[p].surface)!)
    .filter(s=>s.bounds[1][2]>ankle[2]&&s.bounds[0][2]<ankle[2]+reach[i].lengths[1])
    .map(solid=>({solid,axis:1 as const,side:-1 as const}));
   const fit=fitPoolKneeOrbit(source,n,{action:'pool_exit_0',phase},l,2*Math.atan(n.controls[i].state.kneeOrbit??0),q.required?'installed':'free-goal',obstacles);
   if(fit.clear)n=fit.program;
  }
  poses.set(u,n);
 }
}
