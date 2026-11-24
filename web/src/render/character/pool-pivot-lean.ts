import {add,sub,multiply,transform,type Vec3} from './math.js';
import type {PoolCycleSource} from './pool-cycle-source.js';
import {poolIntervalPreference,evaluatePoolPoseProgram,poolSkinMatrices} from './pool-contact-sample.js';
import {posedCageSurface} from './geometry-proof.js';
import {setPoolWorldRotation,translatePoolRoot} from './pool-canonical-pose.js';
import {makePoolPoseProgram,type PoolPoseProgram} from './pool-pose-program.js';
import {PoolTrialRefusal} from './pool-trial-work.js';
import {projectedTrianglePatch,type Triangle} from './pool-solid.js';
import {configuredPoolChainReach} from './pool-entry-domain.js';

type Range=[number,number];
type Face={points:Vec3[];low:number;high:number};
const pos=(m:readonly number[]):Vec3=>[m[12],m[13],m[14]];
const wrap=(a:number)=>Math.atan2(Math.sin(a),Math.cos(a));
const maxLean=Math.PI/5;
const bounds=(points:Vec3[]):Face=>({points,low:Math.min(...points.map(p=>p[0])),high:Math.max(...points.map(p=>p[0]))});

function clearLanding(source:PoolCycleSource,initial:PoolPoseProgram,unit:number){
 const action={action:'pool_exit_0',phase:unit/source.definition.clockUnits};
 const loaded=(['footL','footR'] as const).find(l=>initial.policy[l].required)!;
 const support=initial.policy[loaded],solid=source.fixture.solids.find(s=>s.id===support.surface);
 if(!solid||support.region?.kind!=='top-face')throw new Error('The loaded step lacks a top surface.');
 const faces=(support.region.triangles??[]).map(id=>solid.triangles[id].map(v=>solid.vertices[v]) as unknown as Triangle);
 const top=solid.bounds[1][2],margin=source.fixture.rails[0].radius/16;
 let program=initial;
 for(let iteration=0;iteration<4;iteration++){
  const solved=evaluatePoolPoseProgram(source.bundle,source.neutral.rest,source.neutral.inverse,program,action);
  const matrices=poolSkinMatrices(solved.world,source.neutral.inverse);let minimum=Infinity;
  for(const [gi,g] of source.geometry.entries()){
   const parts=g.description.parts.filter(p=>p.name==='Creator bare hips'||p.name==='Creator pool trunks waist'||p.name==='Creator pool two_piece waist');
   if(!parts.length)continue;
   const mesh=posedCageSurface(g,source.cages[gi],matrices),p=(id:number):Vec3=>[mesh[id*3],mesh[id*3+1],mesh[id*3+2]];
   for(const part of parts)for(let k=part.start;k<part.start+part.count;k+=3){
    const tri:Triangle=[p(g.indices[k]),p(g.indices[k+1]),p(g.indices[k+2])];if(tri.every(v=>v[2]>=top+margin))continue;
    for(const face of faces)for(const point of projectedTrianglePatch(tri,face))minimum=Math.min(minimum,point[2]);
   }
  }
  if(minimum>=top+margin)return program;
  if(iteration===3)throw new PoolTrialRefusal('The supported waist did not clear the landing within its bounded vertical fit.',{cause:{unit,minimum,top}});
  const lift=top+2*margin-minimum,delta:Vec3=[0,0,lift],pose=poolIntervalPreference(source.bundle,source.neutral.rest,source.neutral.inverse,program.preferenceBasis,program.preferenceBasis,0,true);
  const a=source.anatomy[loaded],state=program.controls[loaded==='footL'?0:1].state;
  const r=configuredPoolChainReach(source.neutral.rest,a.upper,a.lower,a.end),d=sub(state.target,add(pos(pose.world[a.upper]),delta)),distance=Math.hypot(...d);
  if(distance<=r.minimum||distance>=r.maximum)throw new PoolTrialRefusal('The landed waist cannot rise within the loaded ankle reach.',{cause:{unit,lift,distance,reach:r}});
  translatePoolRoot(pose,delta);
  program=makePoolPoseProgram(pose.basis,program.controls.map((c,i)=>({...c,state:{...c.state,
   target:i===(loaded==='footL'?0:1)?c.state.target:add(c.state.target,delta),pole:add(c.state.pole,delta)}})),program.policy);
 }
 return program;
}

export function sliceX(points:Vec3[],low:number,high:number){
 let polygon=points;
 for(const sign of [-1,1]){
  const edge=sign<0?low:high,input=polygon;polygon=[];
  for(let i=0;i<input.length;i++){
   const p=input[i],q=input[(i+1)%input.length],a=(p[0]-edge)*sign,b=(q[0]-edge)*sign;
   if(a<=0)polygon.push(p);
   if(a*b<0){const t=a/(a-b);polygon.push([edge,p[1]+(q[1]-p[1])*t,p[2]+(q[2]-p[2])*t]);}
  }
 }
 return polygon;
}

/** Bound the radial and angular extent of a convex slice about an X-aligned ankle axis. */
export function polar(points:Vec3[],pivot:Vec3){
 const yz=points.map(p=>[p[1]-pivot[1],p[2]-pivot[2]]),first=Math.atan2(yz[0][1],yz[0][0]);
 let low=Infinity,high=0,angleLow=Infinity,angleHigh=-Infinity;
 for(let i=0;i<yz.length;i++){
  const [y,z]=yz[i],[nextY,nextZ]=yz[(i+1)%yz.length],a=nextY-y,b=nextZ-z,den=a*a+b*b;
  const t=den?Math.max(0,Math.min(1,-(y*a+z*b)/den)):0;
  low=Math.min(low,Math.hypot(y+a*t,z+b*t));high=Math.max(high,Math.hypot(y,z));
  const angle=first+wrap(Math.atan2(z,y)-first);angleLow=Math.min(angleLow,angle);angleHigh=Math.max(angleHigh,angle);
 }
 if(angleHigh-angleLow>=Math.PI)return {low:0,high,angleLow:-Math.PI,angleHigh:Math.PI};
 return {low,high,angleLow,angleHigh};
}

/** Rotate the pelvis, limbs and their goals together around the supporting ankle, keeping its installed sole flat. */
export function fitSupportedPoolLean(source:PoolCycleSource,program:PoolPoseProgram,unit:number,preferredAngle:number){
 const location={action:'pool_exit_0',phase:unit/source.definition.clockUnits},policy=program.policy;
 const loaded=(['footL','footR'] as const).filter(l=>policy[l].required);
 if(loaded.length!==1||policy.handL.required||policy.handR.required)throw new Error('An ankle-pivot lean needs one loaded sole and two released hands.');
 const active=loaded[0],foot=program.controls[active==='footL'?0:1],pivot=foot.state.target;
 const solved=evaluatePoolPoseProgram(source.bundle,source.neutral.rest,source.neutral.inverse,program,location);
 const matrices=poolSkinMatrices(solved.world,source.neutral.inverse);
 const rails=source.fixture.rails.map(rail=>{
  const s=source.fixture.solids.find(s=>s.id===rail.id)!;
  return {low:s.bounds[0][0],high:s.bounds[1][0],faces:s.triangles.map(t=>{
   const face=bounds(t.map(id=>s.vertices[id]));return {...face,polar:polar(face.points,pivot)};
  })};
 });
 const forbidden:Range[]=[],padding=source.fixture.rails[0].radius/16;
 for(const [gi,g] of source.geometry.entries()){
  const mesh=posedCageSurface(g,source.cages[gi],matrices),p=(id:number):Vec3=>[mesh[id*3],mesh[id*3+1],mesh[id*3+2]];
  for(const part of g.description.parts){
   const splitHead=source.definition.version===16&&source.definition.forwardHop?.launchFromUnit&&(part.region===1||part.region===8);
   if(!splitHead&&!/upper arm skin|Forearm with elbow|Relaxed palm|Resting thumb|bare torso|Natural neck|Sculpted head|HAIR_/.test(part.name))continue;
   for(let k=part.start;k<part.start+part.count;k+=3){
    const pts=[p(g.indices[k]),p(g.indices[k+1]),p(g.indices[k+2])],body=bounds(pts);
    for(const rail of rails){
     if(body.low>rail.high||body.high<rail.low)continue;
     const coarse=polar(pts,pivot);
     for(const f of rail.faces){
      if(body.low>f.high||body.high<f.low)continue;
      const f0=f.polar;if(coarse.low>f0.high+padding||coarse.high+padding<f0.low)continue;
      const b=sliceX(pts,f.low,f.high),h=sliceX(f.points,body.low,body.high);if(!b.length||!h.length)continue;
      const s=polar(b,pivot),t=polar(h,pivot);if(s.low>t.high+padding||s.high+padding<t.low)continue;
      const margin=Math.atan2(padding,Math.max(padding,s.low));
      for(const turn of [-2*Math.PI,0,2*Math.PI]){
       const lo=Math.max(-maxLean,t.angleLow-s.angleHigh-margin+turn),hi=Math.min(maxLean,t.angleHigh-s.angleLow+margin+turn);
       if(hi>=lo)forbidden.push([lo,hi]);
      }
     }
    }
   }
  }
 }
 const union:Range[]=[];
 for(const [lo,hi] of forbidden.sort((a,b)=>a[0]-b[0])){
  if(!union.length||lo>union[union.length-1][1])union.push([lo,hi]);
  else union[union.length-1][1]=Math.max(union[union.length-1][1],hi);
 }
 const block=union.find(([lo,hi])=>lo<=preferredAngle&&hi>=preferredAngle);
 const choices:number[]=[];
 if(!block)choices.push(preferredAngle);
 else{
  const index=union.indexOf(block),before=index===0?-maxLean:union[index-1][1],after=index===union.length-1?maxLean:union[index+1][0];
  if(before<block[0])choices.push(block[0]-Math.min(.012,(block[0]-before)/2));
  if(after>block[1])choices.push(block[1]+Math.min(.012,(after-block[1])/2));
 }
 if(!choices.length)throw new PoolTrialRefusal('No measured angular corridor for the loaded-ankle pivot.',{cause:{unit,active,union}});
 const angle=choices.sort((a,b)=>Math.abs(a-preferredAngle)-Math.abs(b-preferredAngle))[0],c=Math.cos(angle),s=Math.sin(angle);
 if(angle===0)return {program,angle};
 const turn=[1,0,0,0,0,c,s,0,0,-s,c,0,0,0,0,1],carry=(p:Vec3)=>add(pivot,transform(turn,sub(p,pivot)));
 const pose=poolIntervalPreference(source.bundle,source.neutral.rest,source.neutral.inverse,program.preferenceBasis,program.preferenceBasis,0,true);
 const hip=source.bundle.bones.findIndex(b=>b.name==='hips'),old=pose.world[hip],goal=carry(pos(old));
 setPoolWorldRotation(pose,hip,multiply(turn,old));translatePoolRoot(pose,sub(goal,pos(pose.world[hip])));
 const leaned=makePoolPoseProgram(pose.basis,program.controls.map((a,i)=>{
  const limb=(['footL','footR','handL','handR'] as const)[i],state=a.state,held=limb===active;
  let target=held?state.target:carry(state.target);
  const orientation=held||i<2&&policy[limb].mode!=='free'?state.orientation:multiply(turn,state.orientation);
  if(!held&&(limb==='footL'||limb==='footR')&&policy[limb].surface){
   const place=Object.entries(source.definition.places).find(([,p])=>p.surface===policy[limb].surface)?.[0];
   if(!place)throw new Error('The swinging foot has no declared tread for its approach.');
   const nominal=source.primaryExitFoot(limb,place,unit).target[2];
   if(target[2]<nominal)target=[target[0],target[1],Math.max(nominal,state.target[2])];
  }
  return {...a,state:{...state,target,orientation,pole:carry(state.pole)}};
 }),policy);
 return {program:clearLanding(source,leaned,unit),angle};
}
