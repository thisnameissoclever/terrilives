import {add,sub,scale,dot,length,multiply,transform,type Vec3} from './math.js';
import {interpolateTransform} from './motion.js';
import {poolIntervalPreference} from './pool-contact-sample.js';
import {setPoolWorldRotation,translatePoolRoot} from './pool-canonical-pose.js';
import {makePoolPoseProgram,type PoolPoseProgram} from './pool-pose-program.js';
import {poolSurfacePoint} from './pool-entry-anatomy.js';
import type {PoolSurfaceCoefficient} from './pool-surface-coefficient.js';
import {configuredPoolChainReach,projectPoolEntryRoot} from './pool-entry-domain.js';
import {reachableSegment} from './contact-math.js';
import {resolvePoolRailContactFrame} from './pool-rail-contact-frame.js';
import {poolSourcePolicy} from './pool-source-policy.js';
import {fitClimbHand} from './pool-climb-hand.js';
import {outwardBodyPassage,outwardElbow} from './pool-outward-passage.js';
import {fitPoolKneeOrbit} from './pool-knee-orbit-fit.js';
import {outwardCalfDomain,aimOutwardKnee} from './pool-outward-calf.js';
import {PoolTrialRefusal} from './pool-trial-work.js';
import type {PoolCycleSource,PoolFoot,PoolHand} from './pool-cycle-source.js';
import type {PoolLimbState} from './pool-contact-evaluator.js';

export const outwardLowerExitUnits=[66250,67500,69250,71000,72500,73500,74900,76300,77500,78500,79900,81300,82500,
 84600,87000,89150,91250,93350,95700,97900,100000] as const;
type Sole=ReturnType<PoolCycleSource['foot']>;
type LowerGoal=(limb:PoolFoot,place:string,unit:number)=>Sole;
const limbs=['footL','footR','handL','handR'] as const;
const point=(m:readonly number[]):Vec3=>[m[12],m[13],m[14]];
const ease=(v:number)=>{const t=Math.max(0,Math.min(1,v));return t*t*(3-2*t);};
const blend=(a:Vec3,b:Vec3,t:number)=>add(a,scale(sub(b,a),t));
const yaw=(a:number)=>[Math.cos(a),Math.sin(a),0,0,-Math.sin(a),Math.cos(a),0,0,0,0,1,0,0,0,0,1];
const rotation=(m:readonly number[])=>{const r=[...m];r.splice(12,3,0,0,0);return r;};
const stairs=[
 {from:45000,end:52500,limb:'footR',place:'crest'},
 {from:52500,end:60000,limb:'footL',place:'outside3'},
 {from:60000,end:66250,limb:'footR',place:'outside2'},
 {from:66250,end:72500,limb:'footL',place:'outside1'},
 {from:72500,end:77500,limb:'footR',place:'ground'},
 {from:77500,end:82500,limb:'footL',place:'ground'},
 {from:82500,end:91250,limb:'footR',place:'ground'},
 {from:91250,end:100000,limb:'footL',place:'ground'}
] as const;

/** Lift clear of the old tread, descend outside its edge, and set the heel down on the next tread. */
export function outwardFootSwing(limb:PoolFoot,a:Pick<Sole,'target'|'orientation'|'lift'>,b:Pick<Sole,'target'|'orientation'|'lift'>,v:number,turn:boolean,
 coeff:readonly PoolSurfaceCoefficient[],railBack:number,radius:number,thighLength:number){
  if(v===0)return a;if(v===1)return b;
  const t=ease(v),rotationProgress=ease((v-.2)/.52),middle=turn?multiply(yaw(Math.PI/2),a.orientation):undefined;
  const orientation=middle?(rotationProgress<.5?interpolateTransform(a.orientation,middle,2*rotationProgress):
   interpolateTransform(middle,b.orientation,2*rotationProgress-1)):interpolateTransform(a.orientation,b.orientation,rotationProgress);
  const target=blend(a.target,b.target,t),margin=radius/6;
  if(turn){
   // The right foot passes poolward of the left during the dry half-turn.
   target[1]+=(limb==='footR'?-1:1)*Math.sin(Math.PI*v)*Math.min(.12,thighLength/3);
   target[2]+=Math.sin(Math.PI*v)*thighLength/4;
  }else{

   const outside=Math.max(...coeff.map(c=>(railBack+margin-poolSurfacePoint(orientation,c)[1])/c[3]),a.target[1],b.target[1]);
   const lift=Math.min(a.lift/2,radius),above=a.target[2]+lift,settle=b.target[2]+Math.min(b.lift/2,radius);
   if(v<.20){const w=ease(v/.20);target[1]=a.target[1]+(outside-a.target[1])*w;target[2]=a.target[2]+lift*w;}
   else if(v<.76){target[1]=outside;target[2]=above+(settle-above)*ease((v-.20)/.56);}
   else{const w=ease((v-.76)/.24);target[1]=outside+(b.target[1]-outside)*w;target[2]=settle+(b.target[2]-settle)*w;}
  }
  return {target,orientation};
 }

/** Descend with the toes facing dry ground, then turn by lifting one foot at a time. */
export function outwardLowerExit(source:PoolCycleSource,seam:PoolPoseProgram,standing:PoolPoseProgram,goal:LowerGoal,start:45000|66250=66250){
 const {bundle,neutral,definition}=source,action='pool_exit_0',clock=definition.clockUnits;
 const hop=definition.version===16?definition.forwardHop:undefined,route=hop?.outwardDescent;
 if(!hop||route?.kind!=='walk-out'||route.rightOutside2Unit!==66250||route.rightDryUnit!==77500||
   route.leftDryUnit!==82500||route.rightTurnUnit!==91250||outwardLowerExitUnits.some(u=>!hop.climbOutUnits.includes(u)))
  throw new Error('Missing outward lower-exit clock.');
 const hip=bundle.bones.findIndex(b=>b.name==='hips'),radius=source.fixture.rails[0].radius;
 const pref=(n:PoolPoseProgram)=>poolIntervalPreference(bundle,neutral.rest,neutral.inverse,n.preferenceBasis,n.preferenceBasis,0,true);
 const startPose=pref(seam),finishPose=pref(standing),h0=point(startPose.world[hip]),hn=point(finishPose.world[hip]);
 const ranges=limbs.map(l=>{const a=source.anatomy[l];return configuredPoolChainReach(neutral.rest,a.upper,a.lower,a.end);});
 const startFeet=start===45000?[goal('footL','crest',start),goal('footR','inside3',start)]:[goal('footL','outside3',start),goal('footR','outside2',start)];
 const feet=[...startFeet],poses=new Map<number,PoolPoseProgram>([[start,seam]]);
 for(let i=0;i<2;i++)if(!seam.policy[limbs[i]].required||feet[i].target.some((v,j)=>v!==seam.controls[i].state.target[j])||
  feet[i].orientation.some((v,j)=>v!==seam.controls[i].state.orientation[j]))
  throw new Error('The lower descent requires the two installed outward feet at its seam.');
 for(const [i,l] of (['handL','handR'] as const).entries()){
  const wrist=seam.controls[i+2].state.attached;
  if(!seam.policy[l].required||wrist?.geometry.surface!==source.fixture.rails[1-i].id)
   throw new Error('The outward descent requires the two maintained rail grips at its seam.');
 }
 const mean=(values:readonly {target:Vec3}[])=>scale(add(values[0].target,values[1].target),.5);
 const firstCentre=mean(feet),lastCentre=mean(standing.controls.slice(0,2).map(c=>c.state));
 const hipOverFeet=sub(hn,lastCentre);
 const previousHands=seam.controls.slice(2).map(c=>c.state);
 const releaseHands=new Map<PoolHand,{state:PoolLimbState;unit:number}>();
 const railBack=Math.max(...source.fixture.solids.filter(s=>s.id.includes('outside ladder tread')).map(s=>s.bounds[1][1]));
 if(!Number.isFinite(railBack))throw new Error('The outward descent requires a finite outer tread edge.');
 const targetKnots=hop.climbOutUnits;
 const passage=start===45000?outwardBodyPassage(source,seam,start/clock):undefined;
 const passageAngle=(u:number)=>(passage?.angle??0)*ease((u-45000)/6500)*(1-ease((u-56500)/8500));
 const calf=outwardCalfDomain(source);
 const poseAt=(unit:number)=>{
  const t=ease((unit-start)/(82500-start)),turned=pref(standing);
  setPoolWorldRotation(turned,hip,multiply(bodyTurn(unit),turned.world[hip]));
  const p=poolIntervalPreference(bundle,neutral.rest,neutral.inverse,seam.preferenceBasis,turned.basis,t,true);
  const a=passageAngle(unit);
  if(a)setPoolWorldRotation(p,hip,multiply(yaw(a),p.world[hip]));
  return p;
 };
 function bodyTurn(unit:number){return yaw(Math.PI*(1+ease((unit-82500)/(100000-82500))));}
 function railSegments(limb:PoolHand,unit:number,prior:PoolLimbState){
  if(!prior.attached)throw new Error('The outward descent lost a required wrist.');
  const rail=source.outwardRail(limb,unit),goal=prior.attached,location={action,phase:unit/clock,limb};
  const outside=goal.parameter>=3;
  const frame=resolvePoolRailContactFrame(rail,goal.rawOrientation,rail.edges[0].edge.fromParameter,goal.activeVertex,location);
  const coefficient=rail.coefficients[rail.vertices.indexOf(frame.activeVertex)][3];
  const weight=Number(coefficient.numerator)*2**coefficient.exponent;
  const wrist=(p:Vec3)=>add(frame.translation,scale(sub(p,frame.targetPoint),1/weight));
  return rail.edges.flatMap(edge=>{
   const lo=edge.edge.fromParameter,hi=edge.edge.toParameter;
   if(start===66250&&(outside?hi<=3:lo>=3))return [];
   const from=wrist(edge.from);return [{lo,hi,from,d:sub(wrist(edge.to),from)}];
  });
 }
 function grip(limb:PoolHand,unit:number,joint:Vec3,prior:PoolLimbState,desired:Vec3,pole:Vec3,segments:ReturnType<typeof railSegments>){
  const reach=ranges[limb==='handL'?2:3],outside=prior.attached!.parameter>=3;
  let best:{parameter:number;cost:number}|undefined;
  for(const {lo,hi,from,d} of segments){
   const legal=reachableSegment(from,d,joint,reach.maximum-radius/8,[0,1]);
   if(!legal)continue;
   const f=Math.max(legal[0],Math.min(legal[1],dot(sub(desired,from),d)/dot(d,d))),p=add(from,scale(d,f));
   if(length(sub(p,joint))<=reach.minimum+radius/8)continue;
   const cost=length(sub(desired,p)),parameter=lo+(hi-lo)*f;
   if(!best||cost<best.cost)best={parameter,cost};
  }
  if(!best)throw new PoolTrialRefusal('No reachable outward rail slide for '+limb+' at '+unit,{cause:{joint,desired}});
  const state=fitClimbHand(source,limb,joint,source.slideClimbWrist(limb,unit,prior,best.parameter,pole),start===45000?[0,6]:outside?[3,6]:[0,3]);
  return {...state,pole:outwardElbow(joint,state.target,pole,reach.lengths[0],reach.lengths[1],hn[0])};
 }
 for(const step of stairs){
  if(step.from<start)continue;
  const side=step.limb==='footL'?0:1,previous=feet[side],next=goal(step.limb,step.place,step.end),baseCentre=mean(feet);
  if(step.from>=82500&&(next.target.some((v,i)=>v!==standing.controls[side].state.target[i])||
    next.orientation.some((v,i)=>v!==standing.controls[side].state.orientation[i])))
   throw new Error('The turning foot must land on its literal standing frame.');
  const nextFeet=[...feet];nextFeet[side]=next;
  for(const u of targetKnots.filter(k=>k>step.from&&k<=step.end)){
   if(u===100000){poses.set(u,standing);continue;}
   const policy=poolSourcePolicy(source.fixture,action,u/clock),p=poseAt(u),weight=(u-step.from)/(step.end-step.from);
   const now=feet.map((f,i)=>{
    if(i!==side)return f;
    if(step.from>=52500)return outwardFootSwing(step.limb,previous,next,weight,step.from>=82500,source.anatomy[step.limb].surfaceCoefficients,railBack,radius,ranges[side].lengths[0]);
    if(weight===1)return next;
    const across=ease((weight-.25)/.5),target=blend(previous.target,next.target,across);
    const top=Math.max(previous.target[2],next.target[2])+radius;
    target[2]=weight<.5?previous.target[2]+(top-previous.target[2])*ease(weight/.25):top+(next.target[2]-top)*ease((weight-.75)/.25);
    return {target,orientation:interpolateTransform(previous.orientation,next.orientation,across)};
   });
   const centre=blend(baseCentre,mean(nextFeet),ease(weight)),toward=ease((u-start)/(82500-start));
   if(step.from>=77500)centre[0]+=(feet[1-side].target[0]-centre[0])*Math.sin(Math.PI*weight)**2;
   const offset=blend(sub(h0,firstCentre),transform(bodyTurn(u),hipOverFeet),toward);
   const intended=add(centre,offset),h=point(p.world[hip]);
   if(passage&&u<82500){
    const v=passage.position(passageAngle(u)),across=ease((u-start)/15000);
    intended[0]+=(v.x-intended[0])*ease((u-start)/6500)*(1-ease((u-70000)/12500));
    intended[1]=Math.max(intended[1],h0[1]+(v.y-h0[1])*across);
   }
   const shins=now.map((f,i)=>{
    if(!passage||u<(i===0?54000:61250)||u>(i===0?81300:76300))return;
    const knee=calf(i,f.target);if(!knee)return;
    const socket=sub(point(p.world[seam.controls[i].upper]),h);
    const dx=intended[0]+socket[0]-knee[0],dy=intended[1]+socket[1]-knee[1],thigh=ranges[i].lengths[0];
    const ceiling=knee[2]+Math.sqrt(Math.max(0,thigh*thigh-dx*dx-dy*dy))-socket[2];
    intended[2]=Math.min(intended[2],ceiling);
    return knee;
   });
   const constraints=now.map((f,i)=>({limb:limbs[i],center:sub(f.target,sub(point(p.world[seam.controls[i].upper]),h)),
    reach:{...ranges[i],maximum:ranges[i].maximum-radius/12}}));
   const wrists=new Map<PoolHand,ReturnType<typeof railSegments>>();
   for(const [k,hand] of (['handL','handR'] as const).entries())if(policy[hand].required){
    const segments=railSegments(hand,u,previousHands[k]);wrists.set(hand,segments);
    const i=k+2,shoulder=sub(point(p.world[seam.controls[i].upper]),h),wanted=add(intended,shoulder);
    let closest:Vec3|undefined,best=Infinity;
    for(const {from,d} of segments){
     const amount=Math.max(0,Math.min(1,dot(sub(wanted,from),d)/dot(d,d))),q=add(from,scale(d,amount)),distance=length(sub(q,wanted));
     if(distance<best){best=distance;closest=q;}
    }
    if(!closest)throw new PoolTrialRefusal('The outward hand has no finite rail segment at '+u);
    constraints.push({limb:hand,center:sub(closest,shoulder),reach:{...ranges[i],maximum:ranges[i].maximum-radius/6}});
   }
   const result=projectPoolEntryRoot(intended,constraints,{minimum:[-1,0,0],maximum:[0,2,3]}).projected;
   if(!result)throw new PoolTrialRefusal('The outward descent cannot reach both ankles at '+u,{cause:{intended,constraints}});
   translatePoolRoot(p,sub(result,h));
   const controls=seam.controls.map((c,i)=>{
    const joint=point(p.world[c.upper]),l=limbs[i],shift=sub(joint,point(startPose.world[c.upper]));
    if(i<2)return {...c,state:{target:now[i].target,orientation:now[i].orientation,pole:add(c.state.pole,shift)}};
    const hand=l as PoolHand,turned=multiply(rotation(p.world[hip]),rotationTranspose(finishPose.world[hip]));
    const finish=standing.controls[i].state,restJoint=point(finishPose.world[c.upper]);
    const loose=add(joint,transform(turned,sub(finish.target,restJoint)));
    const pole=add(joint,transform(turned,sub(finish.pole,restJoint)));
    if(policy[hand].required){
     const desired=add(c.state.target,sub(result,h0));
     const held=grip(hand,u,joint,previousHands[i-2],desired,add(c.state.pole,shift),wrists.get(hand)!);
     previousHands[i-2]=held;releaseHands.set(hand,{state:held,unit:u});return {...c,state:held};
    }
    const latest=releaseHands.get(hand)??{state:c.state,unit:66250};
    const t=ease((u-latest.unit)/3000);
    const target=blend(latest.state.target,loose,t),guide=outwardElbow(joint,target,latest.state.pole,ranges[i].lengths[0],ranges[i].lengths[1],hn[0]);
    const state={target,orientation:interpolateTransform([...latest.state.orientation],multiply(turned,finish.orientation),t),
     pole:blend(guide,pole,ease((u-latest.unit-1500)/5000))};
    return {...c,state:fitClimbHand(source,hand,joint,state)};
   });
   let program=makePoolPoseProgram(p.basis,controls,policy);
   if(start===45000&&u<=81300)for(const limb of ['footL','footR'] as const){
    const contact=policy[limb],eligible=contact.required||contact.mode==='free'||contact.mode==='approach';
    if(!eligible)continue;
    const i=limb==='footL'?0:1,knee=shins[i],at={action,phase:u/clock};
    if(knee)program=aimOutwardKnee(source,program,at,limb,knee);
    const obstacles=knee?['crest','outside3','outside2'].map(place=>source.fixture.solids.find(s=>s.id===definition.places[place].surface)!)
     .filter(s=>s.bounds[1][2]>now[i].target[2]&&s.bounds[0][2]<now[i].target[2]+ranges[i].lengths[1])
     .map(solid=>({solid,axis:1 as const,side:-1 as const})):[];
    const preferred=2*Math.atan(program.controls[i].state.kneeOrbit??0);
    const fit=fitPoolKneeOrbit(source,program,at,limb,preferred,contact.required?'installed':'free-goal',obstacles);
    if(fit.clear)program=fit.program;
   }
   poses.set(u,program);
  }
  feet[side]=next;
 }
 return poses;
}

function rotationTranspose(m:readonly number[]){
 return [m[0],m[4],m[8],0,m[1],m[5],m[9],0,m[2],m[6],m[10],0,0,0,0,1];
}
