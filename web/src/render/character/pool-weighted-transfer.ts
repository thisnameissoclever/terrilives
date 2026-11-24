import {add,sub,scale,length,unit,multiply,type Vec3} from './math.js';
import {interpolateTransform} from './motion.js';
import {poolIntervalPreference} from './pool-contact-sample.js';
import {translatePoolRoot,setPoolWorldRotation} from './pool-canonical-pose.js';
import {poolSourcePolicy} from './pool-source-policy.js';
import {makePoolPoseProgram,type PoolPoseProgram} from './pool-pose-program.js';
import {configuredPoolChainReach,projectPoolEntryRoot,poolRootRayIntervals,poolChainReachable} from './pool-entry-domain.js';
import {poolSurfacePoint} from './pool-entry-anatomy.js';
import {fitClimbHand} from './pool-climb-hand.js';
import {fitPoolKneeOrbit} from './pool-knee-orbit-fit.js';
import {properPoolRotation} from './pool-canonical-pose.js';
import {aimOutwardKnee} from './pool-outward-calf.js';
import {outwardBodyPassage,outwardElbow} from './pool-outward-passage.js';
import {wristAtHeight} from './pool-upright-descent.js';
import {fitSlidingReach} from './pool-sliding-reach.js';
import {clearDryBaySide} from './pool-bay-side.js';
import {PoolTrialRefusal} from './pool-trial-work.js';
import type {PoolCycleSource,PoolFoot,PoolHand} from './pool-cycle-source.js';
import type {PoolLimbState} from './pool-contact-evaluator.js';

const pos=(m:readonly number[]):Vec3=>[m[12],m[13],m[14]];
const ease=(x:number)=>{const t=Math.max(0,Math.min(1,x));return t*t*(3-2*t);};
const mix=(a:Vec3,b:Vec3,t:number)=>add(a,scale(sub(b,a),t));
const limbs=['footL','footR','handL','handR'] as const;
interface Step {limb:PoolFoot;fromPlace:string;toPlace:string;start:number;lift:number;free:number;approach:number;land:number}

/** Carry the swimmer on the installed foot while the opposite ankle clears the upper tread and reaches down. */
export function weightedLadderTransfers(source:PoolCycleSource,poses:Map<number,PoolPoseProgram>,standing:PoolPoseProgram,steps:Step[]){
 const motion=source.definition;if(motion.version!==16||!motion.forwardHop||!steps.length)throw new Error('Missing lower transfer clock.');
 const {bundle,neutral}=source,hip=bundle.bones.findIndex(b=>b.name==='hips'),action='pool_exit_0',radius=source.fixture.rails[0].radius;
 const pref=(p:PoolPoseProgram)=>poolIntervalPreference(bundle,neutral.rest,neutral.inverse,p.preferenceBasis,p.preferenceBasis,0,true);
 const ground=pref(standing),standingHip=pos(ground.world[hip]),origin=poses.get(steps[0].start);
 if(!origin)throw new Error('The upright transfer has no installed starting stance.');
 const sizes=limbs.map(l=>{const a=source.anatomy[l];return configuredPoolChainReach(neutral.rest,a.upper,a.lower,a.end);});
 const lastHands=origin.controls.slice(2).map(c=>c.state);
 const firstPose=pref(origin),lastShoulders=origin.controls.slice(2).map(c=>pos(firstPose.world[c.upper]));
 const lastGrasp=[steps[0].start,steps[0].start];
 const lastRung=motion.forwardHop.platformTurn?.lastRungHandRelease;
 const torso=lastRung?outwardBodyPassage(source,origin,steps[0].start/motion.clockUnits,true):undefined;
 const spine=bundle.bones.findIndex(b=>b.name==='spine');
 function goal(limb:PoolFoot,place:string,u:number){
  if(place==='crest')return source.turnLandingFoot(limb,u);
  if(place!=='nearGround')return source.foot(limb,place);
  const dry=source.foot(limb,'ground'),i=limb==='footL'?0:1,a=source.anatomy[limb],rung=source.fixture.solids.find(s=>s.id===motion.places.outside1.surface)!;
  const y=Math.max(rung.bounds[1][1]+radius+dry.target[1]-dry.bounds[0][1],dry.target[1]-.55*sizes[i].lengths[1]);
  return source.foot(limb,'ground',undefined,false,{raw:properPoolRotation(neutral.rest[a.end]),patch:a.patch,xy:[dry.target[0],y]});
 }
 const startsOnDeck=steps[0].start===motion.forwardHop.platformTurn?.rightTurnUnit;
 const feet=startsOnDeck?[goal('footL','crest',steps[0].start),goal('footR','crest',steps[0].start)]:[goal('footL','outside3',steps[0].start),goal('footR','outside2',steps[0].start)];
 let previous=origin;
 for(const step of steps){
  const i=step.limb==='footL'?0:1,k=1-i,begin=feet[i],load=feet[k],end=goal(step.limb,step.toPlace,step.land);
  const startHip=pos(pref(previous).world[hip]),reach=sizes[k],swingReach=sizes[i];
  const edge=source.fixture.solids.find(s=>s.id===begin.support.surface)?.bounds[1][1]??-Infinity;
  for(const u of motion.forwardHop.climbOutUnits.filter(u=>u>step.start&&u<=step.land)){
   const phase=u/motion.clockUnits,policy=poolSourcePolicy(source.fixture,action,phase),p=pref(standing),h=pos(p.world[hip]);
   const shift=ease((u-step.start)/(step.free-step.start));
   const off=pos(p.world[standing.controls[k].upper]),os=sub(off,h);
   // The pelvis stays close to the standing foot; the free ankle cannot pull it out over dry ground.
   const supported:Vec3=[load.target[0]-os[0]*.55,load.target[1]+.30*reach.lengths[1],
    load.target[2]+.91*reach.maximum-os[2]];
   let desired=mix(startHip,supported,shift);
   if(torso&&u<steps[1].free){
    const steer=ease((u-steps[0].start)/(steps[0].free-steps[0].start))*(1-ease((u-steps[0].land)/(steps[1].free-steps[0].land)));
    const angle=torso.angle*steer,c=Math.cos(angle),s=Math.sin(angle),span=torso.position(angle);
    setPoolWorldRotation(p,spine,multiply([c,s,0,0,-s,c,0,0,0,0,1,0,0,0,0,1],p.world[spine]));
    const constrained=span.lowX<=span.highX?Math.max(span.lowX,Math.min(span.highX,desired[0])):span.x;
    desired[0]+=(constrained-desired[0])*steer;
   }
   if(step.fromPlace==='nearGround')desired=mix(desired,standingHip,ease((u-step.lift)/(step.land-step.lift)));
   const part=source.anatomy[step.limb],orient=ease((u-step.lift)/(step.approach-step.lift));
   const orientation=interpolateTransform(begin.orientation,end.orientation,orient);
   const outside=Math.max(begin.target[1],end.target[1],...part.surfaceCoefficients.map(c=>(edge+radius/3-poolSurfacePoint(orientation,c)[1])/c[3]));
   const clear:Vec3=[begin.target[0],outside,begin.target[2]+Math.min(begin.lift*.6,radius)];
   const above:Vec3=[end.target[0],outside,end.target[2]+Math.min(end.lift*.6,radius)];
   let freeTarget:Vec3;
   if(step.fromPlace==='nearGround'){
    const travel=ease((u-step.lift)/(step.land-step.lift)),p=mix(begin.target,end.target,travel);
    p[2]+=Math.sin(Math.PI*travel)*swingReach.lengths[1]/7;freeTarget=p;
   }else if(u<=step.lift)freeTarget=begin.target;
   else if(u<=step.free)freeTarget=mix(begin.target,clear,ease((u-step.lift)/(step.free-step.lift)));
   else if(u<=step.approach)freeTarget=mix(clear,above,ease((u-step.free)/(step.approach-step.free)));
   else freeTarget=mix(above,end.target,ease((u-step.approach)/(step.land-step.approach)));
   // Lower through the loaded leg only enough to reach the next step, without moving sideways toward the free foot.
   const swingOffset=sub(pos(p.world[standing.controls[i].upper]),h);
   const shell=swingReach.maximum-radius,dx=desired[0]+swingOffset[0]-freeTarget[0],dy=desired[1]+swingOffset[1]-freeTarget[1];
   const ceiling=freeTarget[2]+Math.sqrt(Math.max(0,shell*shell-dx*dx-dy*dy))-swingOffset[2];
   desired[2]=Math.min(desired[2],ceiling);
   const sockets=standing.controls.map(c=>sub(pos(p.world[c.upper]),h));
   const wrists=(['handL','handR'] as const).map((l,j)=>{
    if(!policy[l].required)return;
    const joint=add(desired,sockets[j+2]),ref=lastHands[j];
    const slid=wristAtHeight(source,l,u,ref,[joint[0],joint[1]-sizes[j+2].lengths[0],joint[2]-.5*sizes[j+2].lengths[0]],joint);
    return source.alignDescendingWrist(l,u,slid,joint);
   });
   const constraints=[{limb:limbs[k],center:sub(load.target,sockets[k]),reach:{...reach,maximum:reach.maximum-radius/12}}];
   if(policy[step.limb].required)constraints.push({limb:step.limb,center:sub(freeTarget,sockets[i]),reach:{...swingReach,maximum:swingReach.maximum-radius/12}});
   wrists.forEach((v,j)=>{if(v)constraints.push({limb:limbs[j+2],center:sub(v.target,sockets[j+2]),reach:{...sizes[j+2],maximum:sizes[j+2].maximum-radius/10}});});
   let chosen=projectPoolEntryRoot(desired,constraints,{minimum:[-1,-1,0],maximum:[1,2,3]}).projected;
   if(chosen){
    const initial=chosen,short=constraints.find(c=>length(sub(initial,c.center))<=c.reach.minimum);
    if(short){
     const radial=sub(initial,short.center),directions:Vec3[]=[length(radial)>0?unit(radial):[0,1,0],[0,1,0],[0,0,1]];
     chosen=null;
     for(const direction of directions){
      const intervals=poolRootRayIntervals(direction,constraints.map(c=>({...c,center:sub(c.center,initial)})));
      for(const interval of intervals){const lo=Math.max(0,interval.minimum);if(lo>=interval.maximum)continue;
       const candidate=add(initial,scale(direction,lo+Math.min(radius/8,(interval.maximum-lo)/2)));
       if(constraints.every(c=>poolChainReachable(c.reach,candidate,c.center))){chosen=candidate;break;}
      }
      if(chosen)break;
     }
    }
   }
   if(!chosen)throw new PoolTrialRefusal('The installed ladder contacts cannot carry this step.',{cause:{u,desired,constraints}});
   translatePoolRoot(p,sub(chosen,h));
   const joint=pos(p.world[standing.controls[i].upper]),v=sub(freeTarget,joint),d=length(v);
   if(!policy[step.limb].required&&d>swingReach.maximum-radius/16)freeTarget=add(joint,scale(unit(v),swingReach.maximum-radius/16));
   const controls=standing.controls.map((c,j)=>{
    const root=pos(p.world[c.upper]),guide=add(c.state.pole,sub(root,pos(ground.world[c.upper])));
    if(j<2)return {...c,state:{target:j===k?load.target:freeTarget,orientation:j===k?load.orientation:orientation,pole:guide}};
    const hand=limbs[j] as PoolHand,state=wrists[j-2];
    if(state){let held:PoolLimbState;try{
      held=fitClimbHand(source,hand,root,state,[3,6]);
     }catch(cause){
      throw new PoolTrialRefusal('The loaded ladder wrist must clear its post.',{cause:{u,hand,shoulder:root,target:state.target,parameter:state.attached?.parameter,reach:sizes[j],reason:String(cause)}});
     }const value={...held,pole:outwardElbow(root,held.target,guide,sizes[j].lengths[0],sizes[j].lengths[1],standingHip[0])};
     lastHands[j-2]=value;lastGrasp[j-2]=u;lastShoulders[j-2]=root;return {...c,state:value};}
    if(lastRung){
     const last=lastHands[j-2],duration=u-lastGrasp[j-2],centre=pos(p.world[hip]);
     const tuck:Vec3=[root[0]+(centre[0]-root[0])*.65,root[1]-.44*sizes[j].lengths[0],root[2]-.55*sizes[j].lengths[0]];
     const dry=ease((u-96000)/(motion.clockUnits-96000)),restTarget=add(root,sub(c.state.target,pos(ground.world[c.upper])));
     const amount=ease(duration/1800),carried=add(last.target,sub(root,lastShoulders[j-2]));
     const wanted=mix(carried,mix(tuck,restTarget,dry),amount),v=sub(wanted,root),d=length(v);
     const target=add(root,scale(d?unit(v):[0,-1,0],Math.max(sizes[j].minimum+radius,Math.min(sizes[j].maximum-radius/8,d))));
     const elbow=outwardElbow(root,target,last.pole,sizes[j].lengths[0],sizes[j].lengths[1],centre[0]);
     return {...c,state:{target,orientation:interpolateTransform(last.orientation,c.state.orientation,amount),pole:mix(elbow,guide,dry)}};
    }
    const target=add(root,sub(c.state.target,pos(ground.world[c.upper])));
    return {...c,state:{target,orientation:c.state.orientation,pole:guide}};
   });
   let node=makePoolPoseProgram(p.basis,controls,policy);
   for(const [j,l] of (['footL','footR'] as const).entries()){
    const q=policy[l];if(!q.required&&!['free','approach'].includes(q.mode))continue;
    const ankle=node.controls[j].state.target,shin=sizes[j].lengths[1];
    if(j===k||q.required){
     const angle=Math.atan2(Math.max(0,edge+radius-ankle[1]),Math.max(radius,.25-(ankle[2]-feet[j].plane)))+.15;
     node=aimOutwardKnee(source,node,{action,phase},l,add(ankle,[0,Math.sin(angle)*shin,Math.cos(angle)*shin]));
    }
    const solids=['crest','outside3','outside2'].map(n=>source.fixture.solids.find(s=>s.id===motion.places[n].surface)!).filter(s=>s.bounds[1][2]>ankle[2]&&s.bounds[0][2]<ankle[2]+shin);
    const fit=fitPoolKneeOrbit(source,node,{action,phase},l,2*Math.atan(node.controls[j].state.kneeOrbit??0),q.required?'installed':'free-goal',solids.map(solid=>({solid,axis:1,side:-1})));
    if(fit.clear)node=fit.program;
   }
   if(lastRung&&u>lastRung[0])node=clearDryBaySide(source,node,u);
   poses.set(u,node);previous=node;
  }
  feet[i]=end;
 }
 const start=steps.at(-1)!.land,sourceNode=previous;
 if(start===motion.clockUnits)poses.set(start,standing);
 for(const u of motion.forwardHop.climbOutUnits.filter(u=>u>start)){
  if(u===motion.clockUnits){poses.set(u,standing);continue;}
  const t=ease((u-start)/(motion.clockUnits-start)),p=poolIntervalPreference(bundle,neutral.rest,neutral.inverse,sourceNode.preferenceBasis,standing.preferenceBasis,t,true);
  const policy=poolSourcePolicy(source.fixture,action,u/motion.clockUnits);
  const controls=standing.controls.map((c,j)=>{
   if(j<2)return c;
   const s=sourceNode.controls[j].state,hand=limbs[j] as PoolHand;
   if(policy[hand].required)return {...c,state:source.heldClimbWrist(hand,action,u/motion.clockUnits,s)};
   return {...c,state:{target:mix(s.target,c.state.target,t),orientation:interpolateTransform(s.orientation,c.state.orientation,t),pole:mix(s.pole,c.state.pole,t)}};
  });
  poses.set(u,makePoolPoseProgram(p.basis,controls,policy));
 }
 fitSlidingReach(source,poses,steps[0].start);
}
