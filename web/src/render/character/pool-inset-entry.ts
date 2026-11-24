import {add,sub,scale,type Vec3} from './math.js';
import {interpolateTransform} from './motion.js';
import {configuredPoolChainReach,projectPoolEntryRoot} from './pool-entry-domain.js';
import {poolIntervalPreference} from './pool-contact-sample.js';
import {translatePoolRoot} from './pool-canonical-pose.js';
import {makePoolPoseProgram,type PoolPoseProgram} from './pool-pose-program.js';
import {poolSourcePolicy} from './pool-source-policy.js';
import {poolSurfacePoint} from './pool-entry-anatomy.js';
import type {PoolCycleSource,PoolHand,PoolForwardHop} from './pool-cycle-source.js';
import {PoolTrialRefusal} from './pool-trial-work.js';
import {poolSurfacePoint as handPoint} from './pool-entry-anatomy.js';
import {fitInsetArmGuides} from './pool-inset-arms.js';
import {fitPoolKneeOrbit} from './pool-knee-orbit-fit.js';

const limbs=['footL','footR','handL','handR'] as const;
const point=(m:readonly number[]):Vec3=>[m[12],m[13],m[14]];
const blend=(a:Vec3,b:Vec3,t:number)=>add(a,scale(sub(b,a),t));
const smooth=(t:number)=>{const x=Math.max(0,Math.min(1,t));return x*x*(3-2*x);};
const fraction=(u:number,lo:number,hi:number)=>smooth((u-lo)/(hi-lo));
type Step=NonNullable<PoolForwardHop['insetEntry']>['steps'][number];
type Foot=ReturnType<PoolCycleSource['foot']>;

function footFlight(source:PoolCycleSource,step:Step,a:Foot,b:Foot,u:number):Vec3{
 if(u===step.start)return a.target;if(u===step.land)return b.target;
 const r=source.fixture.rails[0].radius,from=a.target,to=b.target;
 if(step.toPlace==='ground'){
  const t=(u-step.start)/(step.land-step.start),target=blend(from,to,smooth(t));
  target[2]+=Math.sin(Math.PI*t)*Math.min(a.lift,b.lift);return target;
 }
 const top=to[2]+Math.min(b.lift*.6,2*r),lower=from[2]+Math.min(a.lift*.6,2*r);
 const overhead=source.fixture.solids.filter(s=>s.id.includes('outside ladder tread')&&s.bounds[1][2]>a.plane&&s.bounds[1][2]<=b.plane);
 const lip=Math.max(...overhead.map(s=>s.bounds[1][1]),...(!overhead.length?[from[1]]:[]));
 const exterior=Math.max(from[1],...source.anatomy[step.limb].surfaceCoefficients.map(c=>(lip+r/2-poolSurfacePoint(a.orientation,c)[1])/c[3]));
 const rear:Vec3=[from[0],exterior,lower],raised:Vec3=[from[0],exterior,top],over:Vec3=[to[0],to[1],top];
 if(u<=step.release)return blend(from,rear,fraction(u,step.start,step.release));
 if(u<=step.high)return blend(rear,raised,fraction(u,step.release,step.high));
 if(u<=step.across)return blend(raised,over,fraction(u,step.high,step.across));
 return blend(over,to,fraction(u,step.across,step.land));
}

/** Walk into the dry bay before taking the exterior grips. Keep each supporting foot planted. */
export function prepareInsetPoolEntry(source:PoolCycleSource,hop:PoolForwardHop){
 const spec=hop.insetEntry;if(!spec)throw new Error('Missing inset staircase entry.');
 const def=source.definition,clock=def.clockUnits,units=hop.entryUnits.filter(u=>u<=42000);
 const stance=source.entry(0),rest=poolIntervalPreference(source.bundle,source.neutral.rest,source.neutral.inverse,stance.preferenceBasis,stance.preferenceBasis,0,true);
 const hip=source.bundle.bones.findIndex(b=>b.name==='hips'),startHips=point(rest.world[hip]);
 const reaches=limbs.map(l=>{const a=source.anatomy[l];return configuredPoolChainReach(source.neutral.rest,a.upper,a.lower,a.end);});
 const radius=source.fixture.rails[0].radius;
 const rails=source.fixture.rails.map(r=>source.fixture.solids.find(s=>s.id===r.id)!);
 const frames=new Map<number,PoolPoseProgram>([[0,stance]]),both:[Foot,Foot]=[source.foot('footL','ground'),source.foot('footR','ground')];
 const centre=(feet:readonly Vec3[])=>scale(add(feet[0],feet[1]),.5);
 const neutralOffset=sub(startHips,centre(both.map(f=>f.target)));
 let nextIndex=1,stepIndex=0,from=both[1],to=source.insetGroundFoot('footR');
 const holds:Partial<Record<PoolHand,PoolPoseProgram['controls'][number]['state']>>={};
 function construct(u:number){
  while(u>spec!.steps[stepIndex].land){
   both[spec!.steps[stepIndex].limb==='footL'?0:1]=to;stepIndex++;
   const next=spec!.steps[stepIndex];from=both[next.limb==='footL'?0:1];to=source.foot(next.limb,next.toPlace);
  }
  const step=spec!.steps[stepIndex],moving=step.limb==='footL'?0:1,t=(u-step.start)/(step.land-step.start),policy=poolSourcePolicy(source.fixture,'pool_enter',u/clock);
  const positions=both.map(f=>f.target);positions[moving]=footFlight(source,step,from,to,u);
  const final=both.map(f=>f.target);final[moving]=to.target;
  const centreXY=blend(centre(both.map(f=>f.target)),centre(final),smooth(t)),rise=fraction(u,0,17000);
  const lean=rise*17;
  let pose=source.climbBody({hips:[0,0,0],hipPitch:0,trunkPitch:lean,headPitch:lean/3},0);
  const off=limbs.map(l=>point(pose.world[source.anatomy[l].upper]));
  const xy=add(centreXY,neutralOffset);xy[1]+=rise*reaches[moving].lengths[0]*.20;
  xy[0]+=.4*(positions[1-moving][0]-centreXY[0])*Math.sin(Math.PI*t)**2;
  const ceilings=positions.map((g,i)=>g[2]-off[i][2]+Math.sqrt(Math.max(0,(reaches[i].maximum*(.965-.04*rise))**2-(xy[0]+off[i][0]-g[0])**2-(xy[1]+off[i][1]-g[1])**2)));
  const requested:Vec3=[xy[0],xy[1],startHips[2]+(Math.min(...ceilings)-startHips[2])*fraction(u,0,spec!.steps[0].land)];
  const constraints=positions.map((g,i)=>({limb:limbs[i],center:sub(g,off[i]),reach:{...reaches[i],maximum:reaches[i].maximum-radius/4}}));
  const solved=projectPoolEntryRoot(requested,constraints,{minimum:[-1,0,0],maximum:[0,2,3]}).projected;
  if(!solved)throw new PoolTrialRefusal('Inset step exceeds its two actual ankle reaches at '+u,{cause:{positions,requested}});
  translatePoolRoot(pose,sub(solved,point(pose.world[hip])));
  if(u>=spec!.grip.start){
   const reachable=(p:typeof pose)=>(['handL','handR'] as const).every(h=>source.insetEntryGrip(h,u,p,holds[h]?.attached,false));
   if(!reachable(pose)){
    const leanTo=(angle:number)=>source.climbBody({hips:solved,hipPitch:0,trunkPitch:angle,headPitch:angle/3},0);
    let lo=lean,hi=60;
    if(reachable(leanTo(hi))){
     for(let j=0;j<6;j++){const mid=(lo+hi)/2;if(reachable(leanTo(mid)))hi=mid;else lo=mid;}
     pose=leanTo(Math.min(60,hi+2));
    }
   }
  }
  const controls=stance.controls.map((c,i)=>{
   const joint=point(pose.world[c.upper]),neutralJoint=point(rest.world[c.upper]),delta=sub(joint,neutralJoint);
   if(i<2)return {...c,state:{target:positions[i],orientation:i===moving?to.orientation:both[i].orientation,pole:add(c.state.pole,delta)}};
   const h=limbs[i] as PoolHand,tuck=fraction(u,spec!.steps[0].land,spec!.grip.start);
   const free={target:add(joint,add(scale(sub(c.state.target,neutralJoint),1-.25*tuck),[0,0,reaches[i].maximum*.14*tuck])),orientation:c.state.orientation,pole:add(c.state.pole,delta)};
   const inside=fraction(u,0,spec!.steps[0].land),anatomy=source.anatomy[h];
   const coefficients=anatomy.completeHandCoefficients!;
   const limit=i===2?Math.max(...coefficients.map(v=>(rails[0].bounds[1][0]+radius-handPoint(free.orientation,v)[0])/v[3])):Math.min(...coefficients.map(v=>(rails[1].bounds[0][0]-radius-handPoint(free.orientation,v)[0])/v[3]));
   const x=i===2?Math.max(free.target[0],limit):Math.min(free.target[0],limit);
   free.target[0]+=(x-free.target[0])*inside;


   if(u<spec!.grip.start)return {...c,state:free};
   const g=source.insetEntryGrip(h,u,pose,holds[h]?.attached);
   if(!g){
    if(!policy[h].required)return {...c,state:free};
    throw new PoolTrialRefusal('Inset staircase cannot reach '+h+' at '+u,{cause:{joint,hips:solved,feet:positions}});
   }
   if(!policy[h].required){const v=fraction(u,spec!.grip.start,spec!.grip.end);return {...c,state:{target:blend(free.target,g.target,v),orientation:interpolateTransform([...free.orientation],[...g.orientation],v),pole:blend(free.pole,g.pole,v)}};}
   holds[h]=g;
   return {...c,state:g};
  });
  let result=makePoolPoseProgram(pose.basis,controls,policy);
  for(const l of ['footL','footR'] as const){
   if(!policy[l].required)continue;
   const surface=policy[l].surface,next=surface===def.places.outside2.surface?'outside3':surface===def.places.outside3.surface?'crest':undefined;
   if(!next)continue;
   const solid=source.fixture.solids.find(s=>s.id===def.places[next].surface)!;
   const fit=fitPoolKneeOrbit(source,result,{action:'pool_enter',phase:u/clock},l,0,'installed',[{solid,axis:1,side:-1}]);
   if(fit.clear)result=fit.program;
  }
  return fitInsetArmGuides(source,result,u);
 }
 return {crestUnit:42000,at(unit:number){if(!units.includes(unit))throw new Error('Undeclared inset staircase knot.');
  while(nextIndex<units.length&&units[nextIndex]<=unit){const u=units[nextIndex];frames.set(u,construct(u));nextIndex++;}
  return frames.get(unit)!;
 }};
}
