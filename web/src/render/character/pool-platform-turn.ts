import {add,sub,scale,dot,length,multiply,transform,type Vec3} from './math.js';
import {interpolateTransform} from './motion.js';
import {poolIntervalPreference} from './pool-contact-sample.js';
import {setPoolWorldRotation,translatePoolRoot} from './pool-canonical-pose.js';
import {makePoolPoseProgram,type PoolPoseProgram} from './pool-pose-program.js';
import {configuredPoolChainReach,projectPoolEntryRoot} from './pool-entry-domain.js';
import {poolSourcePolicy} from './pool-source-policy.js';
import {poolSurfacePoint} from './pool-entry-anatomy.js';
import {outwardElbow} from './pool-outward-passage.js';
import {fitClimbHand} from './pool-climb-hand.js';
import {fitPoolKneeOrbit} from './pool-knee-orbit-fit.js';
import {resolvePoolRailContactFrame} from './pool-rail-contact-frame.js';
import {PoolTrialRefusal} from './pool-trial-work.js';
import type {PoolCycleSource,PoolFoot,PoolHand} from './pool-cycle-source.js';

const pos=(m:readonly number[]):Vec3=>[m[12],m[13],m[14]];
const ease=(t:number)=>{const u=Math.max(0,Math.min(1,t));return u*u*(3-2*u);};
const blend=(a:Vec3,b:Vec3,t:number)=>add(a,scale(sub(b,a),t));
const yaw=(a:number)=>[Math.cos(a),Math.sin(a),0,0,-Math.sin(a),Math.cos(a),0,0,0,0,1,0,0,0,0,1];
const limbs=['footL','footR','handL','handR'] as const;
type Goal=ReturnType<PoolCycleSource['foot']>;
const moves=[
 {limb:'footR',from:45000,to:51000,place:'crest'},
 {limb:'footL',from:51000,to:57000,place:'crest'},
 {limb:'footR',from:57000,to:64000,place:'crest'},
 {limb:'footL',from:64000,to:77000,place:'outside3'},
] as const;
export function platformInsideArrival(source:PoolCycleSource,node:PoolPoseProgram,unit:number){
 if(unit<40143||unit>45000||!node.policy.footR.required)return node;
 const ledge=source.fixture.solids.find(s=>s.id===source.definition.places.crest.surface)!;
 const fit=fitPoolKneeOrbit(source,node,{action:'pool_exit_0',phase:unit/source.definition.clockUnits},'footR',0,'installed',
  [{solid:ledge,axis:1,side:1}]);
 return fit.clear?fit.program:node;
}
function footSwing(source:PoolCycleSource,limb:PoolFoot,a:Goal,b:Goal,t:number,lower:boolean){
 if(t===0)return a;if(t===1)return b;
 const orient=ease((t-.16)/.54),orientation=interpolateTransform(a.orientation,b.orientation,orient);
 const r=source.fixture.rails[0].radius,deck=source.fixture.solids.find(s=>s.id===source.definition.places.crest.surface)!;
 const coefficients=source.anatomy[limb].surfaceCoefficients;
 const wholeAbove=Math.max(...coefficients.map(c=>(deck.bounds[1][2]+r-poolSurfacePoint(orientation,c)[2])/c[3]));
 const travel=ease((t-.17)/.57),target=blend(a.target,b.target,travel);
 if(lower){
  const out=Math.max(...coefficients.map(c=>(deck.bounds[1][1]+r/4-poolSurfacePoint(orientation,c)[1])/c[3]));
  const high=Math.max(a.target[2],wholeAbove),low=b.target[2]+Math.min(r,b.lift*.6);
  target[1]=a.target[1]+(out-a.target[1])*ease(t/.38)+(b.target[1]-out)*ease((t-.72)/.28);
  target[2]=a.target[2]+(high-a.target[2])*ease(t/.17)+(low-high)*ease((t-.38)/.34)+(b.target[2]-low)*ease((t-.72)/.28);
 }else{
  const high=Math.max(a.target[2],b.target[2],wholeAbove)+r*2;
  target[2]=a.target[2]+(high-a.target[2])*ease(t/.23)+(b.target[2]-high)*ease((t-.72)/.28);
 }
 return {target,orientation};
}

/** Turn by planting the right foot sideways, stepping the left around it, then bringing the right foot parallel. */
export function poolPlatformTurn(source:PoolCycleSource,start:PoolPoseProgram,outside:PoolPoseProgram,standing:PoolPoseProgram){
 const def=source.definition;if(def.version!==16||!def.forwardHop?.platformTurn)throw new Error('Missing pool turning-platform path.');
 const plan=def.forwardHop.platformTurn,clock=def.clockUnits,action='pool_exit_0',g=source.neutral,b=source.bundle;
 const preference=(p:PoolPoseProgram)=>poolIntervalPreference(b,g.rest,g.inverse,p.preferenceBasis,p.preferenceBasis,0,true);
 const hip=b.bones.findIndex(b=>b.name==='hips'),first=preference(start),last=preference(outside),upright=preference(standing);
 const h0=pos(first.world[hip]),h1=pos(last.world[hip]),hs=pos(upright.world[hip]);
 const ref=preference(start);setPoolWorldRotation(ref,hip,multiply(yaw(-Math.PI),ref.world[hip]));
 const reach=limbs.map(l=>{const a=source.anatomy[l];return configuredPoolChainReach(g.rest,a.upper,a.lower,a.end);});
 const corners=[source.primaryExitFoot('footL','crest',plan.startUnit),source.primaryExitFoot('footR','inside3',plan.startUnit)];
 const height=hs[2]-(standing.controls[0].state.target[2]+standing.controls[1].state.target[2])/2;
 const programs=new Map<number,PoolPoseProgram>([[plan.startUnit,start]]);
 const lastUnit=plan.loadedSteps?.[0].start===plan.rightTurnUnit?plan.rightTurnUnit:plan.exteriorUnit;
 const h=(l:PoolHand)=>l==='handL'?2:3,margin=source.fixture.rails[0].radius;
 for(const move of moves){
  if(move.from>=lastUnit)break;
  const i=move.limb==='footL'?0:1,other=1-i,old=corners[i],next=source.primaryExitFoot(move.limb,move.place,move.to);
  for(const u of def.forwardHop.climbOutUnits.filter(v=>v>move.from&&v<=move.to)){
   if(u===lastUnit){programs.set(u,outside);continue;}
   const phase=u/clock,policy=poolSourcePolicy(source.fixture,action,phase),t=(u-move.from)/(move.to-move.from);
   const feet=corners.map((f,j)=>i===j?footSwing(source,move.limb,old,next,t,move.place==='outside3'):f);
   const settle=lastUnit===plan.rightTurnUnit?plan.leftTurnUnit:plan.rightTurnUnit;
   const exit=ease((u-settle)/(lastUnit-settle));
   const rise=ease((u-plan.startUnit)/(plan.quarterUnit-plan.startUnit));
   const basis=exit?poolIntervalPreference(b,g.rest,g.inverse,upright.basis,last.basis,exit,true):
    poolIntervalPreference(b,g.rest,g.inverse,ref.basis,upright.basis,rise,true);
   const angle=u<=51000?Math.PI*(1-ease((u-45000)/6000)/2):Math.PI*.5*(1-ease((u-51000)/13000));
   if(angle)setPoolWorldRotation(basis,hip,multiply(yaw(angle),basis.world[hip]));
   const mean=scale(add(feet[0].target,feet[1].target),.5),base=pos(basis.world[hip]);
   const centre:[number,number,number]=[mean[0],mean[1],
    (corners[other].target[2]+old.target[2]+(next.target[2]-old.target[2])*ease(t))/2+.84*height];
   centre[0]+=(corners[other].target[0]-centre[0])*.45*Math.sin(Math.PI*t)**2;
   const wanted=blend(blend(h0,centre,rise),h1,exit);
   const hands=(['handL','handR'] as const).map(l=>{
    if(!policy[l].required)return undefined;
    const se=start.controls[h(l)].state,outer=outside.controls[h(l)].state;
    const template=policy[l].surface===se.attached?.geometry.surface?se:outer;
    const fixed=source.heldClimbWrist(l,action,phase,template);
    if(template===se)return fixed;
    const geom=fixed.attached!.geometry,g=fixed.attached!;
    const frame=resolvePoolRailContactFrame(geom,g.rawOrientation,g.parameter,g.activeVertex,g.source);
    const coefficient=geom.coefficients[geom.vertices.indexOf(g.activeVertex)][3],weight=Number(coefficient.numerator)*2**coefficient.exponent;
    const shoulder=add(wanted,sub(pos(basis.world[start.controls[h(l)].upper]),base)),size=reach[h(l)].lengths[0];
    const desired=blend([fixed.target[0],shoulder[1],shoulder[2]-size*.38],fixed.target,exit);
    let best=g.parameter,distance=Infinity;
    for(const row of geom.edges){
     if(row.edge.toParameter<=3)continue;
     const from=add(frame.translation,scale(sub(row.from,frame.targetPoint),1/weight)),d=scale(sub(row.to,row.from),1/weight);
     const t=Math.max(0,Math.min(1,dot(sub(desired,from),d)/dot(d,d))),q=add(from,scale(d,t)),gap=length(sub(q,desired));
     if(gap<distance){distance=gap;best=row.edge.fromParameter+(row.edge.toParameter-row.edge.fromParameter)*t;}
    }
    return source.slideClimbWrist(l,u,template,best,fixed.pole);
   });
   const positions=[feet[0],feet[1],...hands];
   const constraints=positions.flatMap((state,j)=>state?[{limb:limbs[j],center:sub(state.target,sub(pos(basis.world[start.controls[j].upper]),base)),
    reach:{...reach[j],maximum:reach[j].maximum-margin/12}}]:[]);
   const placed=projectPoolEntryRoot(wanted,constraints,{minimum:[-1,-1,0],maximum:[1,2,3]}).projected;
   if(!placed)throw new PoolTrialRefusal('The turning stance cannot reach its installed foot and hand contacts.',{cause:{unit:u,wanted,constraints}});
   translatePoolRoot(basis,sub(placed,base));
   const controls=start.controls.map((c,j)=>{
    const joint=pos(basis.world[c.upper]),shift=sub(joint,pos(first.world[c.upper])),s=c.state;
    if(j<2)return {...c,state:{target:feet[j].target,orientation:feet[j].orientation,pole:add(s.pole,shift)}};
    const l=limbs[j] as PoolHand,end=outside.controls[j].state,held=hands[j-2];
    const guide=blend(add(s.pole,shift),add(end.pole,sub(joint,pos(last.world[c.upper]))),ease((u-45000)/19000));
    if(held){
     const state=fitClimbHand(source,l,joint,held);
     return {...c,state:{...state,pole:outwardElbow(joint,state.target,guide,reach[j].lengths[0],reach[j].lengths[1],hs[0])}};
    }
    const original=l==='handR'?45000:51000,arrival=l==='handR'?52500:58750,ratio=(u-original)/(arrival-original);
    const side=joint[0]<hs[0]?1:-1,arm=reach[j].lengths[0],tuck=add(joint,transform(yaw(angle),[0,-arm*.40,-arm*.72]));
    tuck[0]+=side*margin*2;
    const target=blend(blend(s.target,tuck,ease(ratio/.40)),end.target,ease((ratio-.48)/.52));
    const orientation=interpolateTransform(s.orientation,end.orientation,ease(ratio));
    const state={target,orientation,pole:outwardElbow(joint,target,guide,reach[j].lengths[0],reach[j].lengths[1],hs[0])};
    return {...c,state:fitClimbHand(source,l,joint,state)};
   });
   let node=makePoolPoseProgram(basis.basis,controls,policy);
   for(const l of ['footL','footR'] as const){
    const q=policy[l];if(!q.required&&q.mode!=='approach'&&q.mode!=='free')continue;
    const ledge=source.fixture.solids.find(s=>s.id===def.places.crest.surface)!;
    const obstacles=l==='footL'&&u>=69250?[{solid:ledge,axis:1 as const,side:-1 as const}]:[];
    const fit=fitPoolKneeOrbit(source,node,{action,phase},l,0,q.required?'installed':'free-goal',obstacles);
    if(fit.clear)node=fit.program;
   }
   programs.set(u,node);
  }
  corners[i]=next;
 }
 return programs;
}

/** A fresh two-foot, two-hand stance above the platform, facing the outside flight. */
export function platformDescentStance(source:PoolCycleSource,standing:PoolPoseProgram,u:number){
 const {bundle,neutral}=source,pose=poolIntervalPreference(bundle,neutral.rest,neutral.inverse,standing.preferenceBasis,standing.preferenceBasis,0,true);
 const hip=bundle.bones.findIndex(b=>b.name==='hips'),h=pos(pose.world[hip]);
 const foot=(['footL','footR'] as const).map(l=>source.turnLandingFoot(l,u));
 const centre=scale(add(foot[0].target,foot[1].target),.5),height=h[2]-(standing.controls[0].state.target[2]+standing.controls[1].state.target[2])/2;
 const wanted:Vec3=[centre[0],centre[1]+source.fixture.rails[0].radius*2,centre[2]+height*.83];
 translatePoolRoot(pose,sub(wanted,h));
 const controls=standing.controls.map((c,i)=>{
  const pole=add(c.state.pole,sub(wanted,h));if(i<2)return {...c,state:{target:foot[i].target,orientation:foot[i].orientation,pole}};
  const hand=i===2?'handL':'handR',joint=pos(pose.world[c.upper]),a=source.anatomy[hand],reach=configuredPoolChainReach(neutral.rest,a.upper,a.lower,a.end);
  const grip=fitClimbHand(source,hand,joint,source.exteriorClimbGrip(hand,u,pose),[3,6]);
  return {...c,state:{...grip,pole:outwardElbow(joint,grip.target,pole,reach.lengths[0],reach.lengths[1],wanted[0])}};
 });
 return makePoolPoseProgram(pose.basis,controls,poolSourcePolicy(source.fixture,'pool_exit_0',u/source.definition.clockUnits));
}
