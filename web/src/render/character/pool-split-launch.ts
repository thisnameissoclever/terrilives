import {add,sub,scale,length,unit,multiply,transform,type Vec3} from './math.js';
import {interpolateTransform} from './motion.js';
import {poolIntervalPreference} from './pool-contact-sample.js';
import {setPoolWorldRotation,translatePoolRoot} from './pool-canonical-pose.js';
import {makePoolPoseProgram,type PoolPoseProgram} from './pool-pose-program.js';
import {poolSourcePolicy} from './pool-source-policy.js';
import {poolSurfacePoint} from './pool-entry-anatomy.js';
import {configuredPoolChainReach,poolChainReachable,poolRootRayIntervals,projectPoolEntryRoot,type PoolReachConstraint} from './pool-entry-domain.js';
import {PoolTrialRefusal} from './pool-trial-work.js';
import type {PoolCycleSource} from './pool-cycle-source.js';
import {fitLaunchPassage} from './pool-launch-passage.js';
import {applyLaunchAnkle,fitLaunchAnkle} from './pool-launch-ankle.js';
import {splitDeparture} from './pool-split-departure.js';
import {prepareFlightTuck} from './pool-launch-tuck.js';
import {fitPoolKneeOrbit,fitPoolKneeOrbitEdge} from './pool-knee-orbit-fit.js';
import {fitLaunchWaist} from './pool-launch-waist.js';
import {insetWaterOffset,translateInsetPaddle} from './pool-inset-water.js';
import {fitInsetArmGuides} from './pool-inset-arms.js';

const launch=60000,wet=87000,clock=100000,start=42000;
const clamp=(t:number)=>Math.max(0,Math.min(1,t));
const ease=(t:number)=>{const f=clamp(t);return f*f*(3-2*f);};
const mix=(a:number,b:number,u:number)=>a+(b-a)*u;
const point=(m:readonly number[]):Vec3=>[m[12],m[13],m[14]];
const rotation=(m:readonly number[])=>{const r=[...m];r.splice(12,3,0,0,0);return r;};
const limbs=['footL','footR','handL','handR'] as const;

function supportedShift(wanted:Vec3,constraints:PoolReachConstraint[]){
 const legal=(p:Vec3)=>constraints.every(c=>poolChainReachable(c.reach,p,c.center));
 if(legal(wanted))return wanted;
 const inner=constraints.map(c=>({...c,reach:{...c.reach,maximum:c.reach.maximum-1e-7}}));
 const p=projectPoolEntryRoot(wanted,inner,{minimum:[-1,-1,0],maximum:[1,2,4]}).projected;
 if(p&&legal(p))return p;
 if(p){
  const short=constraints.find(c=>length(sub(c.center,p))<=c.reach.minimum);
  if(short){
   const line=sub(p,short.center),dir=length(line)>0?unit(line):[0,0,1] as Vec3;
   for(const range of poolRootRayIntervals(dir,inner.map(c=>({...c,center:sub(c.center,p)})))){
    const lo=Math.max(0,range.minimum);if(lo>=range.maximum)continue;
    const candidate=add(p,scale(dir,lo+Math.min(.001,(range.maximum-lo)/2)));
    if(legal(candidate))return candidate;
   }
  }
 }
 throw new PoolTrialRefusal('The loaded jump cannot reach its named supports.',{cause:{wanted,constraints}});
}

/** Push from the installed crest sole and lift the trailing foot outside the lip before swinging it forward. */
export function prepareSplitLevelPoolHop(source:PoolCycleSource,crest:PoolPoseProgram){
 const definition=source.definition;
 if(definition.version!==16||definition.forwardHop?.launchFromUnit!==start)throw new Error('Missing split-level launch definition.');
 const hop=definition.forwardHop;
 const {bundle,neutral}=source,makePose=()=>poolIntervalPreference(bundle,neutral.rest,neutral.inverse,crest.preferenceBasis,crest.preferenceBasis,0,true);
 const original=makePose(),hip=bundle.bones.findIndex(b=>b.name==='hips'),spine=bundle.bones.findIndex(b=>b.name==='spine'),head=bundle.bones.findIndex(b=>b.name==='head');
 const originalHip=point(original.world[hip]),left=source.foot('footL','outside3'),right=source.foot('footR','crest'),r=source.fixture.rails[0].radius;
 const plate=source.fixture.solids.find(s=>s.id===right.support.surface)!;
 const shapes=limbs.map(l=>{const a=source.anatomy[l];return configuredPoolChainReach(neutral.rest,a.upper,a.lower,a.end);});
 if(!crest.controls[2].state.attached||!crest.controls[3].state.attached||
  ![left,right].every((f,i)=>f.target.every((v,n)=>v===crest.controls[i].state.target[n])))
  throw new Error('The jump must begin with both installed soles and both rail grasps.');
 const footPoints=source.anatomy.footL.surfaceCoefficients.map(c=>({p:poolSurfacePoint(left.orientation,c),w:c[3]}));
 const outside=Math.max(left.target[1],...footPoints.map(v=>(plate.bounds[1][1]+r/4-v.p[1])/v.w));
 const above=Math.max(...footPoints.map(v=>(plate.bounds[1][2]+r*2-v.p[2])/v.w));
 const riseStart=46000,seconds=definition.nativeTicks.enter/definition.nativeTicks.tickHz,flight=(wet-launch)/clock*seconds,load=(launch-riseStart)/clock*seconds;
 const gravity=9.81,up=(source.fixture.waterHeight-right.plane+.5*gravity*flight*flight)/flight;
 const forward=(definition.waterCorridor.initialCentre[1]-right.target[1])/flight;
 const socket=point(original.world[source.anatomy.footR.upper]),dx=socket[0]-right.target[0],dy=Math.min(Math.max(0,socket[1]-right.target[1]),shapes[1].maximum*.27);
 const targetY=originalHip[1]+right.target[1]+dy-socket[1],targetZ=originalHip[2]+right.target[2]+Math.sqrt(Math.max(0,(.93*shapes[1].maximum)**2-dx*dx-dy*dy))-socket[2];
 const shiftZ=Math.max(0,targetZ-originalHip[2]),shiftY=targetY-originalHip[1];
 const hermite=(distance:number,speed:number,t:number)=>distance*ease(t)+speed*load*t*t*(t-1);
 const stored=new Map<number,PoolPoseProgram>([[start,crest]]);
 let passage:{yaw:number;dx:number}|undefined;
 let ankleFit:{yaw:number;lean:number}|undefined;
 function loaded(u:number):PoolPoseProgram{
  const hit=stored.get(u);if(hit)return hit;
  const phase=u/clock,policy=poolSourcePolicy(source.fixture,'pool_enter',phase),pose=makePose(),t=clamp((u-riseStart)/(launch-riseStart));
  const relaxed=ease((u-47000)/13000);
  for(const b of [spine,head]){
   setPoolWorldRotation(pose,b,interpolateTransform(rotation(original.world[b]),rotation(neutral.world[b]),relaxed));
  }
  const straight=pose.world.map(m=>[...m]),turnAmount=ease((u-47000)/10000),a=(passage?.yaw??0)*turnAmount,c=Math.cos(a),s=Math.sin(a);
  const turn=[c,s,0,0,-s,c,0,0,0,0,1,0,0,0,0,1];
  if(a!==0)setPoolWorldRotation(pose,spine,multiply(turn,straight[spine]));
  const back=ease((u-44000)/4000),lift=ease((u-48000)/6000),swing=ease((u-54000)/6000);
  const leftGoal:Vec3=[left.target[0],mix(mix(left.target[1],outside,back),right.target[1]+.06,swing),
   mix(left.target[2]+Math.min(.02,left.lift/2)*back,above,lift)];
  const goals=[leftGoal,right.target,...crest.controls.slice(2).map(c=>c.state.target)];
  const constraints=limbs.flatMap((l,i)=>(i<2||policy[l].required)?[{limb:l,reach:shapes[i],center:sub(goals[i],point(pose.world[crest.controls[i].upper]))}]:[]);
  const wanted:Vec3=[turnAmount*(passage?.dx??0),hermite(shiftY,Math.max(forward,3*shiftY/load),t),hermite(shiftZ,Math.min(up,3*shiftZ/load),t)];
  translatePoolRoot(pose,supportedShift(wanted,constraints));
  const controls=crest.controls.map((c,i)=>{
   const l=limbs[i],s=c.state,joint=point(pose.world[c.upper]),delta=sub(joint,point(original.world[c.upper]));
   if(i<2)return {...c,state:{...s,target:goals[i],pole:add(s.pole,delta)}};
   if(policy[l].required){
    const held=source.heldClimbWrist(i===2?'handL':'handR','pool_enter',phase,s);
    return {...c,state:{...held,pole:add(s.pole,delta)}};
   }
   const pulled=ease((u-(i===2?44000:47000))/5000),segment=shapes[i].lengths[1];
   const tucked=add(joint,transform(turn,[(originalHip[0]-straight[c.upper][12])*.5,-segment*.50,-segment*.78]));
   let target=add(s.target,scale(sub(tucked,s.target),pulled));
   const orientation=a===0?s.orientation:multiply(turn,s.orientation);
   const anatomy=source.anatomy[i===2?'handL':'handR'],offsets=anatomy.completeHandCoefficients!.map(v=>({p:poolSurfacePoint(orientation,v),w:v[3]}));
   const rails=source.fixture.rails.map(r=>source.fixture.solids.find(s=>s.id===r.id)!);
   const minX=Math.max(...offsets.map(v=>(rails[0].bounds[1][0]+r*pulled/8-v.p[0])/v.w));
   const maxX=Math.min(...offsets.map(v=>(rails[1].bounds[0][0]-r*pulled/8-v.p[0])/v.w));
   target=[Math.max(minX,Math.min(maxX,target[0])),target[1],target[2]];
   const line=sub(target,joint),distance=length(line),reach=shapes[i],safe=Math.max(reach.minimum+r,Math.min(reach.maximum-r,distance));
   if(distance!==safe)target=add(joint,scale(distance>0?unit(line):[0,-1,0],safe));
   const pole=add(s.pole,delta),guide=add(joint,transform(turn,[(originalHip[0]-straight[c.upper][12])*.65,0,-segment*.7]));
   return {...c,state:{target,orientation,pole:add(pole,scale(sub(guide,pole),pulled))}};
  });
  const raw=makePoolPoseProgram(pose.basis,controls,policy),lean=ease((u-52000)/8000);
  const p=ankleFit&&lean>0?applyLaunchAnkle(source,raw,ankleFit.yaw*lean,ankleFit.lean*lean):raw;
  stored.set(u,p);return p;
 }
 const water=source.paddle(0);
 const submergedLadder=hop.platformTurn?source.fixture.solids.filter(s=>s.id.includes('inside ladder tread')||s.id.includes('ladder stringer')):[];
 let tuckedFeet:ReturnType<typeof prepareFlightTuck>|undefined;
 function air(u:number){
  const departure=loaded(launch);
  tuckedFeet??=prepareFlightTuck(source,departure,flight,forward,up);
  const dt=(u-launch)/clock*seconds,move:Vec3=[0,forward*dt,up*dt-.5*gravity*dt*dt];
  const pose=poolIntervalPreference(bundle,neutral.rest,neutral.inverse,departure.preferenceBasis,departure.preferenceBasis,0,true);
  translatePoolRoot(pose,move);
  const amount=ease(dt/.075)*(1-ease((dt-.26)/(flight-.26)));
  return makePoolPoseProgram(pose.basis,departure.controls.map((c,i)=>{
   const f=i<2?tuckedFeet![i](amount):c.state;
   return {...c,state:{...f,target:add(f.target,move),orientation:f.orientation,pole:add(f.pole,move)}};
  }),poolSourcePolicy(source.fixture,'pool_enter',u/clock));
 }
 function recover(splash:PoolPoseProgram,u:number){
  const t=ease((u-wet)/(clock-wet)),p=source.freeWaterKnot(splash,water,t,'pool_enter',u/clock);
  if(hop.insetEntry){
   const hierarchy=(n:PoolPoseProgram)=>poolIntervalPreference(bundle,neutral.rest,neutral.inverse,n.preferenceBasis,n.preferenceBasis,0,true);
   const left=hierarchy(splash),right=hierarchy(water),now=hierarchy(p);
   // Recover each free ankle and wrist relative to its own moving socket as the body tips into the stroke.
   const controls=p.controls.map((c,i)=>{
    const a=sub(splash.controls[i].state.target,point(left.world[c.upper])),b=sub(water.controls[i].state.target,point(right.world[c.upper]));
    const offset=add(scale(a,1-t),scale(b,t)),target=add(point(now.world[c.upper]),offset);
    return {...c,state:{...c.state,target,pole:add(c.state.pole,sub(target,c.state.target))}};
   });
   const raw=makePoolPoseProgram(p.preferenceBasis,controls,p.policy);
   return translateInsetPaddle(source,raw,insetWaterOffset(source,[{program:raw,action:'pool_enter',phase:u/clock}]));
  }
  const rightEdge=Math.max(...source.fixture.solids.filter(s=>s.id.toLowerCase().includes('ladder')).map(s=>s.bounds[1][0]));
  const tread=source.fixture.solids.find(s=>s.id===definition.places.inside2.surface)!;
  const controls=p.controls.map((c,i)=>{
   if(i>=2)return c;
   const f=source.anatomy[i===0?'footL':'footR'].surfaceCoefficients,flat=(state:typeof c.state)=>{
    const m=[...state.orientation];m.splice(12,3,...state.target);return m;
   };
   const now=flat(c.state),end=flat(water.controls[i].state);
   let left=Infinity,endLeft=Infinity,safe=Infinity;
   for(const v of f){const a=poolSurfacePoint(now,v);left=Math.min(left,a[0]);endLeft=Math.min(endLeft,poolSurfacePoint(end,v)[0]);
    safe=Math.min(safe,c.state.target[1]+(tread.bounds[0][1]-r-a[1])/v[3]);}
   const opening=rightEdge+r,extend=endLeft>opening?ease((left-opening)/(endLeft-opening)):ease((u-wet)/(clock-wet));
   const from=splash.controls[i].state.target[1],tuck=Math.min(from,safe)-r;
   const y=mix(mix(from,tuck,ease((u-wet)/2500)),water.controls[i].state.target[1],extend);
   const target:Vec3=[c.state.target[0],y,c.state.target[2]];
   if(submergedLadder.length){
    const matrix=[...c.state.orientation];matrix.splice(12,3,...target);
    const vertices=f.map(v=>poolSurfacePoint(matrix,v));
    const range=(axis:number)=>[Math.min(...vertices.map(v=>v[axis])),Math.max(...vertices.map(v=>v[axis]))];
    const box=[range(0),range(1),range(2)];
    const near=submergedLadder.filter(s=>box.every(([lo,hi],axis)=>lo<s.bounds[1][axis]+r&&hi>s.bounds[0][axis]-r));
    if(near.length){
     const east=Math.max(...near.map(s=>s.bounds[1][0]))+r,front=Math.min(...near.map(s=>s.bounds[0][1]))-r;
     const dx=Math.max(0,...vertices.map((v,j)=>(east-v[0])/f[j][3])),dy=Math.min(0,...vertices.map((v,j)=>(front-v[1])/f[j][3]));
     const pose=poolIntervalPreference(bundle,neutral.rest,neutral.inverse,p.preferenceBasis,p.preferenceBasis,0,true),joint=point(pose.world[c.upper]);
     const options:Vec3[]=[[dx,0,0],[0,dy,0]];
     const delta=options.sort((a,b)=>length(a)-length(b)).find(d=>poolChainReachable(shapes[i],joint,add(target,d)));
     if(delta)return {...c,state:{...c.state,target:add(target,delta)}};
    }
   }
   return {...c,state:{...c.state,target}};
  });
  return makePoolPoseProgram(p.preferenceBasis,controls,p.policy);
 }
 let splash:PoolPoseProgram|undefined;
 const measuredPath=new Map<number,PoolPoseProgram>(),orbits=new Map<number,number>();
 function supported(u:number):PoolPoseProgram{
  const found=measuredPath.get(u);if(found)return found;
  let step=splitDeparture(source,crest,loaded(launch),u,supportedShift,up,forward);
  if(u>=51000&&u<launch){
   if(u>=56000)step=fitLaunchWaist(source,step,u);
   const previous=hop.entryUnits.filter(k=>k>=51000&&k<u).at(-1);
   if(previous!==undefined&&!orbits.has(previous))supported(previous);
   const preferred=previous===undefined?0:(orbits.get(previous)??0)*(launch-u)/(launch-previous);
   const location={action:'pool_enter',phase:u/clock};
   let fitted=fitPoolKneeOrbit(source,step,location,'footR',preferred);
   if(previous!==undefined&&u-previous>1&&fitted.kneeOrbit!==0)
    fitted=fitPoolKneeOrbitEdge(source,measuredPath.get(previous)!,previous,fitted,u,Math.round((previous+u)/2),'pool_enter','footR');
   orbits.set(u,fitted.angle);step=fitted.program;
  }
  if(hop.insetEntry&&u<launch)step=fitInsetArmGuides(source,step,u);
  measuredPath.set(u,step);return step;
 }
 return (u:number):PoolPoseProgram=>{
  if(!Number.isSafeInteger(u)||u<start||u>clock)throw new Error('Split-level hop phase is outside its clock.');
  if(u===start)return crest;
  if(!passage){passage=fitLaunchPassage(source,loaded(launch),launch);stored.clear();stored.set(start,crest);}
  if(!ankleFit){ankleFit=fitLaunchAnkle(source,loaded(launch),launch);stored.clear();stored.set(start,crest);}
  if(u===launch)return loaded(launch);
  if(u<launch)return supported(u);
  if(u<wet)return air(u);
  splash??=air(wet);
  if(u===wet)return splash;
  if(u===clock)return water;
  return recover(splash,u);
 };
}
