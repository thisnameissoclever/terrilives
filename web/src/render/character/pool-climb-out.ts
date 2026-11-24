import {add,sub,scale,multiply,transform,length,type Vec3} from './math.js';
import {interpolateTransform} from './motion.js';
import type {PoolCycleSource,PoolFoot,PoolHand} from './pool-cycle-source.js';
import {makePoolPoseProgram,type PoolPoseProgram} from './pool-pose-program.js';
import type {PoolLimbState,PoolPoseControl} from './pool-contact-evaluator.js';
import {configuredPoolChainReach} from './pool-entry-domain.js';
import {poolSourcePolicy,poolSourceRecord} from './pool-source-policy.js';
import {captureSelectedPoolKnot} from './pool-selected-cycle.js';
import {poolIntervalPreference} from './pool-contact-sample.js';
import {setPoolWorldRotation,translatePoolRoot} from './pool-canonical-pose.js';
import {preparePoolSurfacePosition,supportedClimbBody} from './pool-climb-out-fit.js';
import {fitSupportedPoolLean} from './pool-pivot-lean.js';
import {poolSurfacePoint} from './pool-entry-anatomy.js';
import {poolWaterBounds} from './pool-water-retarget.js';
import {resolvePoolRailContactFrame} from './pool-rail-contact-frame.js';
import {fitClimbHand} from './pool-climb-hand.js';
import {fitClimbLeg} from './pool-climb-leg.js';
import {outwardLowerExit} from './pool-outward-lower-exit.js';
import {platformDescentStance,platformInsideArrival,poolPlatformTurn} from './pool-platform-turn.js';
import {uprightPoolDescent} from './pool-upright-descent.js';
import {weightedLadderTransfers} from './pool-weighted-transfer.js';
import {insetSwimApproach} from './pool-inset-swim.js';
import {outwardArrival} from './pool-outward-passage.js';

const clamp=(u:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,u));
const mix=(a:number,b:number,t:number)=>a+(b-a)*t;
const lerp=(a:Vec3,b:Vec3,t:number)=>add(a,scale(sub(b,a),t));
const ease=(t:number)=>{const f=clamp(t,0,1);return f*f*(3-2*f);};
const point=(m:readonly number[]):Vec3=>[m[12],m[13],m[14]];
type Step={at:number;until:number;place:string};
const steps:Record<PoolFoot,Step[]>={
 footR:[{at:38000,until:50000,place:'inside3'},{at:58000,until:64000,place:'crest'}],
 footL:[{at:28500,until:38000,place:'inside2'},{at:46000,until:58000,place:'crest'},{at:64000,until:64000,place:'outside3'}],
};

/** The swimmer faces the inside flight until both feet can transfer weight across the landing. */
function* authoredClimbSteps(source:PoolCycleSource,exterior:(entryUnit:number)=>PoolPoseProgram,independentExit?:(exitUnit:number)=>PoolPoseProgram):Generator<readonly [number,()=>PoolPoseProgram]>{
 const spec=source.definition;
 if(spec.version!==16||!spec.forwardHop)throw new Error('An independent climb-out needs its authored exit clock.');
 const clock=spec.clockUnits,water=source.paddle(0),action='pool_exit_0';
 const start=10000,feet=['footL','footR'] as const;
 const turningPlatform=spec.forwardHop.platformTurn;
 const keys=spec.forwardHop.climbKeys;
 const exteriorJoin=spec.forwardHop.launchFromUnit?keys.find(k=>k.entryUnit===spec.forwardHop!.launchFromUnit):undefined;
 const landing=exteriorJoin?poolSourceRecord(source.fixture,{action,phase:exteriorJoin.unit/clock}).limbs.footL:undefined;
 if(exteriorJoin&&(!landing||landing.mode!=='approach'||landing.intervalSpace!=='clip-phase'||!landing.interval||
    landing.interval[1]!==exteriorJoin.unit/clock||landing.surface!==spec.places.outside3.surface))
   throw new Error('The independent exit lacks its final approach to the selected exterior stance.');
 const landingStart=landing?.interval?Math.round(landing.interval[0]*clock):undefined;
 let landingEndpoints:{from:PoolPoseProgram;to:PoolPoseProgram}|undefined;
 const play=(authored:number)=>{
  const key=keys.find(k=>k.authoredUnit===authored);
  if(!key)throw new Error('Missing authored climb event '+authored);
  return key.unit;
 };
 yield [start,()=>water];
 const maintained:Partial<Record<PoolHand,PoolLimbState['attached']>>={};
 let crestReturnAngle=0;
 const waterPose=poolIntervalPreference(source.bundle,source.neutral.rest,source.neutral.inverse,water.preferenceBasis,water.preferenceBasis,0,true);
 const hip=source.bundle.bones.findIndex(b=>b.name==='hips'),origin=point(waterPose.world[hip]);
 const tucked=makePoolPoseProgram(water.preferenceBasis,water.controls.map((c,i)=>{
  if(i<2){
   if(!turningPlatform)return c;
   const limb=i===0?'footL':'footR',a=source.anatomy[limb],socket=point(waterPose.world[c.upper]);
   const sizes=configuredPoolChainReach(source.neutral.rest,a.upper,a.lower,a.end);
   const floor=source.fixture.solids.find(s=>s.kind==='floor')!,margin=source.fixture.rails[0].radius;
   const above=Math.max(...a.surfaceCoefficients.map(k=>(floor.bounds[1][2]+3*margin-poolSurfacePoint(c.state.orientation,k)[2])/k[3]));
   const target:Vec3=[socket[0],socket[1]+sizes.lengths[1]*.25,Math.max(above,socket[2]-sizes.maximum*.62)];
   return {...c,state:{...c.state,target}};
  }
  const shoulder=point(waterPose.world[c.upper]),limb=i===2?'handL':'handR';
  const a=source.anatomy[limb],reach=configuredPoolChainReach(source.neutral.rest,a.upper,a.lower,a.end);
  const toward=Math.sign(origin[0]-shoulder[0]),forearm=reach.lengths[1];
  return {...c,state:{...c.state,target:add(shoulder,[toward*forearm*.20,-forearm*.55,-forearm*.84]),
   pole:add(shoulder,[-toward*.06,forearm*.50,-forearm*.60])}};
 }),water.policy);
 const fitSwim=preparePoolSurfacePosition(source,tucked,origin);
 const inset=turningPlatform&&turningPlatform.loadedSteps?.[0].start===turningPlatform.rightTurnUnit?insetSwimApproach(source,water,play):undefined;
 function swim(u:number){
  if(inset)return inset(u);
  const progress=clamp((u-11500)/7500,0,1),turn=-Math.PI*progress,c=Math.cos(turn),s=Math.sin(turn);
  const rot=[c,s,0,0,-s,c,0,0,0,0,1,0,0,0,0,1],pose=poolIntervalPreference(source.bundle,source.neutral.rest,
   source.neutral.inverse,water.preferenceBasis,water.preferenceBasis,0,true);
  const centre=fitSwim([mix(origin[0],spec.ground.pelvisXY[0],ease(progress)),mix(origin[1],-.07,ease(progress)),origin[2]],turn);
  const carry=(p:Vec3)=>add(centre,transform(rot,sub(p,origin)));
  setPoolWorldRotation(pose,hip,multiply(rot,pose.world[hip]));translatePoolRoot(pose,sub(centre,origin));
  return makePoolPoseProgram(pose.basis,tucked.controls.map((c,i)=>({...c,state:{...c.state,target:carry(i<2&&turningPlatform?
   lerp(water.controls[i].state.target,c.state.target,ease((u-start)/3000)):c.state.target),
   orientation:multiply(rot,c.state.orientation),pole:carry(c.state.pole)}})),poolSourcePolicy(source.fixture,action,play(u)/clock));
 }
 const turned=swim(19000);
 const turnedWorld=poolIntervalPreference(source.bundle,source.neutral.rest,source.neutral.inverse,turned.preferenceBasis,turned.preferenceBasis,0,true).world;
 const swimEnd=point(turnedWorld[hip]);
 if(spec.forwardHop.launchFromUnit&&!independentExit)throw new Error('The split-level hop needs the independently authored inside exit.');
 let destinationPose:PoolPoseProgram|undefined;
 const destination=()=>destinationPose??=(independentExit?independentExit(65000):exterior(46656));
 const outer=poolWaterBounds(source.fixture),radius=source.fixture.rails[0].radius;
 function guide(unit:number,playUnit:number,entryUnit:number){
  const input=captureSelectedPoolKnot(source,entryUnit,exterior(entryUnit)),limbs={...input.limbs};
  const from=source.primaryExitFoot('footL','crest',play(58000)),to=destination().controls[0].state;
  const t=ease((unit-58000)/6000),target=lerp(from.target,to.target,t);
  target[2]+=.025*Math.sin(Math.PI*t);
  limbs.footL={...limbs.footL,target,orientation:interpolateTransform([...from.orientation],[...to.orientation],t)};
  for(const [i,limb] of (['handL','handR'] as const).entries()){
   const {grasp,...state}=limbs[limb];if(!grasp)throw new Error('The chosen exit reference has no rail grasp.');
   const side=i===0?1:-1;
   limbs[limb]={...state,target:add(state.target,[side*radius*(1-t),0,0])};
  }
  return source.materializeSelectedKnot({...input,unit:playUnit,limbs},action);
 }
 function sole(limb:PoolFoot,unit:number,location:number){
  const initial=turned.controls[limb==='footL'?0:1].state;
  let last={target:initial.target,orientation:initial.orientation},depart=19000;
  for(const s of steps[limb]){
   const next=source.primaryExitFoot(limb,s.place,play(s.at));
   if(unit<s.at){
    const u=clamp((unit-depart)/(s.at-depart),0,1),height=Math.max(last.target[2],next.target[2])+.055;
    const raised=lerp(last.target,next.target,ease((u-.2)/.6));
    raised[2]=u<.45?mix(last.target[2],height,ease(u/.45)):mix(height,next.target[2],ease((u-.60)/.40));
    const support=poolSourcePolicy(source.fixture,action,location/clock)[limb];
    const held=support.surface?Object.entries(spec.places).find(([,p])=>p.surface===support.surface)?.[0]:undefined;
    const orientation=held?source.primaryExitFoot(limb,held,location).orientation:
     last.orientation.every((v,i)=>v===next.orientation[i])?last.orientation:interpolateTransform([...last.orientation],[...next.orientation],ease(u));
    if(limb==='footL'&&depart===38000&&unit>depart){
     const f=source.primaryExitFoot(limb,'inside2',play(38000));
     const tread=source.fixture.solids.find(v=>v.id===spec.places.inside3.surface)!;
     const landing=source.fixture.solids.find(v=>v.id===spec.places.crest.surface)!;
     const rows=source.anatomy[limb].surfaceCoefficients.map(c=>({p:poolSurfacePoint(orientation,c),w:c[3]}));
     const behind=(y:number)=>Math.min(...rows.map(r=>(y-radius/8-r.p[1])/r.w));
     const clear=Math.min(last.target[1],behind(tread.bounds[0][1]));
     const lip=Math.max(clear,behind(landing.bounds[0][1]));
     const soleOffset=last.target[2]-f.plane,lift=last.target[2]+Math.min(f.lift/2,.025);
     if(unit<=39000){raised[1]=mix(last.target[1],clear,ease((unit-38000)/1000));raised[2]=mix(last.target[2],lift,ease((unit-38000)/1000));}
     else if(unit<=40000){raised[1]=clear;raised[2]=mix(lift,tread.bounds[1][2]+soleOffset+radius,ease((unit-39000)/1000));}
     else if(unit<=42000){raised[1]=mix(clear,lip,ease((unit-40000)/2000));raised[2]=mix(tread.bounds[1][2]+soleOffset+radius,height,ease((unit-40000)/2000));}
     else {raised[1]=mix(lip,next.target[1],ease((unit-42000)/3000));raised[2]=mix(height,next.target[2],ease((unit-44500)/1500));}
    }
    if(support.mode==='approach')raised[2]=Math.max(raised[2],next.target[2]);
    return {target:raised,orientation};
   }
   if(unit<=s.until)return next;
   last=next;depart=s.until;
  }
  return last;
 }
 const approachY=(u:number)=>{
  const centre=source.definition.ground.pelvisXY[0];
  const flight=source.fixture.rails[1].points[1].point[1];
  const original=u<=50000?flight-.36+.13*ease((u-30000)/20000):
    u<=55000?mix(flight-.23,flight-.165,ease((u-53500)/1500)):
    u<58000?mix(flight-.165,flight+.022,ease((u-56000)/2000)):flight-.36+.13+.34*ease((u-50000)/12000);
  const basinward=.16*(1-ease((u-38000)/7000));
  const t=ease((u-19000)/6000);
  return {x:mix(swimEnd[0],centre,t),y:mix(swimEnd[1],original-basinward,t)};
 };
 for(const key of keys){
  const {unit:location,authoredUnit:u}=key;
  if(u<=start)continue;
  yield [location,()=>{
  if(exteriorJoin&&landingStart!==undefined&&location>=landingStart&&location<exteriorJoin.unit){
   if(!landingEndpoints){
    if(!independentExit)throw new Error('The exterior landing has no independent departure stance.');
    const u=exteriorJoin.entryUnit!;
    const end=captureSelectedPoolKnot(source,u,exterior(u));
    const arrived=source.materializeSelectedKnot({...end,unit:exteriorJoin.unit},action),last=arrived.controls[0].state;
    const initial=independentExit(landingStart),clear=source.foot('footL','outside3').lift;
    const controls=initial.controls.map((c,i)=>{
      if(i!==0)return c;
      const [x,y,z]=c.state.target;
      return {...c,state:{...c.state,orientation:last.orientation,target:[x,y,Math.max(z,last.target[2]+clear)] as Vec3}};
    });
    landingEndpoints={from:makePoolPoseProgram(initial.preferenceBasis,controls,initial.policy),to:arrived};
   }
   const pose=source.splitSelectedEntry(landingEndpoints.from,landingEndpoints.to,landingStart,exteriorJoin.unit,location,action);
   const controls=pose.controls.map((c,i)=>{
    if(i<2||!c.state.attached)return c;
    return {...c,state:source.heldClimbWrist(i===2?'handL':'handR',action,location/clock,c.state)};
   });
   return makePoolPoseProgram(pose.preferenceBasis,controls,pose.policy);
  }
  if(key.exitReferenceUnit!==undefined){
   if(!independentExit)throw new Error('Missing configured exit reference at '+location);
   const program=independentExit(key.exitReferenceUnit),policy=program.policy;
   if(!policy.handL.required&&!policy.handR.required&&policy.footL.required!==policy.footR.required)
    return fitSupportedPoolLean(source,program,location,0).program;
   return program;
  }
  if(key.entryUnit!==undefined){
   const old=key.entryUnit;
   const captured=captureSelectedPoolKnot(source,old,exterior(old));
   return source.materializeSelectedKnot({...captured,unit:location},action);
  }
  if(key.poseEntryUnit!==undefined)return guide(u,location,key.poseEntryUnit);
  if(u<=19000)return u===19000?turned:swim(u);
  const phase=location/clock,policy=poolSourcePolicy(source.fixture,action,phase),centre=approachY(u);
  const yaw=u<=54000?Math.PI:u<56000?mix(Math.PI,Math.PI*.75,ease((u-54000)/2000)):
   u<58000?mix(Math.PI*.75,Math.PI*(1-ease(.4)),ease((u-56000)/2000)):Math.PI*(1-ease((u-54000)/10000));
  const pitch=38*(1-ease((u-20000)/30000))+12;
  const upright=1-ease((u-54000)/4000);
  const intent={hips:[centre.x,centre.y,0] as Vec3,hipPitch:0,trunkPitch:pitch*upright,headPitch:10*upright};
  const legacyHeight=source.fixture.waterHeight+.015+1.05*ease((u-20000)/38000);
  const desired=inset?swimEnd[2]+(legacyHeight-swimEnd[2])*ease((u-19000)/6000):legacyHeight;
  const flat=source.climbBody(intent,yaw),goals=feet.map(l=>{
   const goal=sole(l,u,location),a=source.anatomy[l];
   if(inset&&!policy[l].required&&u<(l==='footL'?28500:38000)){
    const j=l==='footL'?0:1,resume=l==='footL'?28500:38000,begin=l==='footL'?23000:28000;
    const socket=add(point(flat.world[a.upper]),[0,0,desired]);
    const carried=add(socket,sub(turned.controls[j].state.target,point(turnedWorld[a.upper])));
    const t=ease((u-begin)/(resume-begin)),target=lerp(carried,goal.target,t);
    if(policy[l].mode==='approach')target[2]=Math.max(target[2],source.primaryExitFoot(l,l==='footL'?'inside2':'inside3',location).target[2]);
    return {...goal,target};
   }
   if(l!=='footR'||u>=28500||policy[l].mode!=='free')return goal;
   const socket=add(point(flat.world[a.upper]),[0,0,desired]),line=sub(goal.target,socket),d=length(line);
   const maximum=configuredPoolChainReach(source.neutral.rest,a.upper,a.lower,a.end).maximum*.94;
   return d>maximum?{...goal,target:add(socket,scale(line,maximum/d))}:goal;
  });
  const limit=(limb:PoolFoot,i:number)=>{
   const a=source.anatomy[limb],at=point(flat.world[a.upper]),d=sub(goals[i].target,at);
   const reach=configuredPoolChainReach(source.neutral.rest,a.upper,a.lower,a.end);
   const radius=reach.maximum*.94,horizontal=d[0]*d[0]+d[1]*d[1];
   if(horizontal>=reach.maximum*reach.maximum)throw new Error('Climb-out foot misses its horizontal reach at '+u+' '+limb);
   return d[2]+Math.sqrt(Math.max(0,radius*radius-horizontal));
  };
  const ceiling=Math.min(...feet.map(limit));
  intent.hips=[centre.x,centre.y,Math.min(ceiling,desired)];
  const held=(['handL','handR'] as const).filter(limb=>policy[limb].required);
  const {pose,grips}=supportedClimbBody(source,intent,yaw,phase,held,maintained);
  const controls:PoolPoseControl[]=feet.map((limb,i)=>{
   const a=source.anatomy[limb];return {upper:a.upper,lower:a.lower,end:a.end,anchor:[0,0,0,1],legFrame:'source-entry-0',
    state:{target:goals[i].target,orientation:goals[i].orientation,pole:point(pose.world[a.lower])}};
  });
  for(const limb of ['handL','handR'] as const){
   const a=source.anatomy[limb],shoulder=point(pose.world[a.upper]);let state:PoolLimbState;
   if(policy[limb].required){
    state=grips[limb]!;maintained[limb]=state.attached;
   }else {
    const i=limb==='handL'?2:3,inward=Math.sign(centre.x-shoulder[0]),a=source.anatomy[limb];
    const tucked=add(shoulder,[inward*Math.min(.15,.75*Math.abs(centre.x-shoulder[0])),.065,-.15]);
    let target=tucked,orientation=turned.controls[i].state.orientation;
    if(u>54000&&maintained[limb]){
     const g=maintained[limb]!,old=resolvePoolRailContactFrame(g.geometry,g.rawOrientation,g.parameter,g.activeVertex,g.source);
     const next=destination().controls[i].state,release=ease((u-54000)/2000),reach=ease((u-55500)/6500);
     target=lerp(old.translation,lerp(tucked,next.target,reach),release);
     orientation=interpolateTransform([...old.orientation],[...next.orientation],reach);
    }else if(u<25000){
     const prior=turned.controls[i].state,arrive=ease((u-19000)/6000);
     target=lerp(prior.target,tucked,arrive);
    }
    const coeffs=a.completeHandCoefficients!,rest=coeffs.map(c=>({p:poolSurfacePoint(orientation,c),w:c[3]}));
    const low=Math.max(...rest.map(r=>(outer.low[0]+radius-r.p[0])/r.w)),high=Math.min(...rest.map(r=>(outer.high[0]-radius-r.p[0])/r.w));
    target=[clamp(target[0],low,high),target[1],target[2]];
    const line=sub(target,shoulder),dist=length(line),reach=configuredPoolChainReach(source.neutral.rest,a.upper,a.lower,a.end);
    if(dist<1e-9)target=add(shoulder,[inward*(reach.minimum+radius),0,0]);
    else if(dist<reach.minimum+radius||dist>reach.maximum-radius)
     target=add(shoulder,scale(line,clamp(dist,reach.minimum+radius,reach.maximum-radius)/dist));
    state={target,orientation,pole:add(shoulder,[inward*.15,0,-.11])};
    if(spec.forwardHop!.launchFromUnit)state=fitClimbHand(source,limb,shoulder,state);
   }
   controls.push({upper:a.upper,lower:a.lower,end:a.end,anchor:[0,0,0,1],state});
  }
  const program=makePoolPoseProgram(pose.basis,controls,policy);
  if(inset&&
     u>19000&&u<=24000&&Object.values(policy).every(s=>!s.required)){
   const current=point(pose.world[hip]),fit=preparePoolSurfacePosition(source,program,current,{action,phase});
   const delta=sub(fit(current,0),current);
   if(delta.some(v=>v!==0)){
    translatePoolRoot(pose,delta);
    return makePoolPoseProgram(pose.basis,controls.map(c=>({...c,state:{...c.state,target:add(c.state.target,delta),pole:add(c.state.pole,delta)}})),policy);
   }
  }
  const nearPost=u>54000&&u<58000||u===59250;
  if(!nearPost||policy.handL.required||policy.handR.required)return program;
  const preferred=u>55500&&u<58000?crestReturnAngle*(1-ease((u-55500)/2500)):0;
  const fit=fitSupportedPoolLean(source,program,location,preferred);
  if(u===55500)crestReturnAngle=fit.angle;
  return fit.program;
  }];
 }
}

export function* poolClimbOutSteps(source:PoolCycleSource,exterior:(entryUnit:number)=>PoolPoseProgram,independentExit?:(exitUnit:number)=>PoolPoseProgram):Generator<readonly [number,()=>PoolPoseProgram]>{
 const motion=source.definition;
 const walk=motion.version===16?motion.forwardHop?.outwardDescent:undefined;
 const turn=motion.version===16?motion.forwardHop?.platformTurn:undefined;
 const seam=motion.version===16&&motion.forwardHop?.launchFromUnit?motion.forwardHop.climbKeys.find(k=>k.entryUnit===motion.forwardHop!.launchFromUnit)?.unit:undefined;
 for(const [unit,build] of authoredClimbSteps(source,exterior,independentExit)){
  if(turn&&unit===turn.startUnit&&motion.version===16&&motion.forwardHop){
   const exitExterior=(at:number,entry:number)=>source.materializeSelectedKnot({...captureSelectedPoolKnot(source,entry,exterior(entry)),unit:at},'pool_exit_0');
   const authoredLower=turn.loadedSteps?.[0].start===turn.rightTurnUnit;
   const outside=authoredLower?platformDescentStance(source,exterior(0),turn.rightTurnUnit):exitExterior(turn.exteriorUnit,42000);
   const path=poolPlatformTurn(source,platformInsideArrival(source,build(),unit),outside,exterior(0));
   const through=turn.loadedSteps?.[0].start??motion.clockUnits;
   for(const k of motion.forwardHop.climbKeys.filter(k=>k.unit>turn.exteriorUnit&&k.unit<=through)){
    if(k.entryUnit===undefined)throw new Error('Missing installed exterior descent reference.');
    const entry=k.entryUnit;path.set(k.unit,exitExterior(k.unit,entry));
   }
   if(!authoredLower)uprightPoolDescent(source,path,exterior(0),through);
   if(turn.loadedSteps)weightedLadderTransfers(source,path,exterior(0),turn.loadedSteps);
   for(const [time,pose] of path)yield [time,()=>pose];
   return;
  }
  if(turn){yield [unit,()=>platformInsideArrival(source,fitClimbLeg(source,build(),unit),unit)];continue;}
  if(walk&&unit===walk.startUnit){
   const stance=outwardArrival(source,fitClimbLeg(source,build(),unit),unit);
   const path=outwardLowerExit(source,stance,exterior(0),(limb,place,at)=>source.outwardExitFoot(limb,place,at),45000);
   for(const [time,pose] of path)yield [time,()=>pose];
   return;
  }
  if(walk){yield [unit,()=>outwardArrival(source,fitClimbLeg(source,build(),unit),unit)];continue;}
  yield [unit,seam!==undefined&&unit<seam?()=>fitClimbLeg(source,build(),unit):build];
 }
}

export function* poolClimbOutPrograms(source:PoolCycleSource,exterior:(entryUnit:number)=>PoolPoseProgram):Generator<readonly [number,PoolPoseProgram]>{
 for(const [unit,build] of poolClimbOutSteps(source,exterior))yield [unit,build()];
}
