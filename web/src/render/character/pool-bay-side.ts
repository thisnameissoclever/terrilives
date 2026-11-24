import {add,type Vec3} from './math.js';
import {evaluatePoolPoseProgram,poolIntervalPreference,poolSkinMatrices} from './pool-contact-sample.js';
import {posedCageSurface} from './geometry-proof.js';
import {horizontalPatch,type Triangle} from './pool-solid.js';
import {configuredPoolChainReach,poolChainReachable} from './pool-entry-domain.js';
import {translatePoolRoot} from './pool-canonical-pose.js';
import {makePoolPoseProgram,type PoolPoseProgram} from './pool-pose-program.js';
import type {PoolCycleSource} from './pool-cycle-source.js';

/** Center the released upper body only when its material enters a side of the dry opening. */
export function clearDryBaySide(source:PoolCycleSource,node:PoolPoseProgram,u:number){
 const bay=source.definition.dryBay;if(!bay||node.policy.handL.required||node.policy.handR.required)return node;
 const {bundle,neutral}=source,loc={action:'pool_exit_0',phase:u/source.definition.clockUnits};
 const skin=poolSkinMatrices(evaluatePoolPoseProgram(bundle,neutral.rest,neutral.inverse,node,loc).world,neutral.inverse);
 const rim=source.fixture.solids.find(s=>s.id==='Pool stone coping')!,margin=source.fixture.rails[0].radius/8;
 let min=-Infinity,max=Infinity;
 const pieces:Triangle[]=[];
 for(const [i,g] of source.geometry.entries()){
  const vertices=posedCageSurface(g,source.cages[i],skin);
  for(const part of g.description.parts){
   if(!/bare hips|bare torso|upper arm skin|Forearm with elbow|Relaxed palm|Resting thumb|pool .* (waist|top)/.test(part.name))continue;
   for(let k=part.start;k<part.start+part.count;k+=3){
    const tri=[0,1,2].map(j=>{const n=g.indices[k+j]*3;return [vertices[n+1],vertices[n+2],vertices[n]];}) as unknown as Triangle;
    if(tri.every(p=>p[0]>rim.bounds[1][1]+margin)||tri.every(p=>p[0]<bay.outer[2])||tri.every(p=>p[1]>rim.bounds[1][2]+margin))continue;
    pieces.push(tri);
    const clipped=horizontalPatch(tri,[[bay.outer[2],0,-1],[rim.bounds[1][1],rim.bounds[1][2],1]]);
    for(const p of clipped){
     const cap=p[1]>=rim.bounds[0][2],insideL=bay.outer[0]+(cap ? .01 : 0),insideR=bay.outer[1]-(cap ? .01 : 0);
     min=Math.max(min,insideL+margin-p[2]);max=Math.min(max,insideR-margin-p[2]);
    }
   }
  }
 }
 if(min<=0&&max>=0)return node;
 const p=poolIntervalPreference(bundle,neutral.rest,neutral.inverse,node.preferenceBasis,node.preferenceBasis,0,true);
 const options:Vec3[]=[];
 const shifts=new Set([0,Math.max(0,min),Math.min(0,max)]);
 if(Number.isFinite(min)&&Number.isFinite(max))shifts.add((min+max)/2);
 const sides=[
  {lo:rim.bounds[0][0],hi:bay.outer[0]+.01,z0:rim.bounds[0][2],z1:rim.bounds[1][2],front:rim.bounds[1][1]},
  {lo:bay.outer[1]-.01,hi:rim.bounds[1][0],z0:rim.bounds[0][2],z1:rim.bounds[1][2],front:rim.bounds[1][1]},
  {lo:-.943,hi:bay.outer[0]+.003,z0:0,z1:rim.bounds[0][2],front:.943},
  {lo:bay.outer[1]-.003,hi:.943,z0:0,z1:rim.bounds[0][2],front:.943},
 ];
 for(const dx of shifts){
  if(!Number.isFinite(dx))continue;
  let dy=0;
  for(const tri of pieces){
   const xzy=tri.map(q=>[q[2]+dx,q[1],q[0]]) as unknown as Triangle;
   for(const s of sides){
    if(xzy.every(q=>q[0]<s.lo-margin)||xzy.every(q=>q[0]>s.hi+margin)||xzy.every(q=>q[1]<s.z0-margin)||xzy.every(q=>q[1]>s.z1+margin))continue;
    for(const q of horizontalPatch(xzy,[[s.lo-margin,s.z0-margin,-1],[s.hi+margin,s.z1+margin,1]]))dy=Math.max(dy,s.front+margin-q[2]);
   }
  }
  const delta:Vec3=[dx,dy,0];
  if((['footL','footR'] as const).every((l,i)=>{
   if(node.policy[l].mode==='free')return true;
   const c=node.controls[i],socket=p.world[c.upper].slice(12,15) as unknown as Vec3;
   return poolChainReachable(configuredPoolChainReach(neutral.rest,c.upper,c.lower,c.end),add(socket,delta),c.state.target);
  }))options.push(delta);
 }
 options.sort((a,b)=>Math.hypot(...a)-Math.hypot(...b));
 const delta=options[0];if(!delta)return node;
 translatePoolRoot(p,delta);
 return makePoolPoseProgram(p.basis,node.controls.map((c,i)=>({...c,state:{...c.state,
  target:i>=2||node.policy[i===0?'footL':'footR'].mode==='free'?add(c.state.target,delta):c.state.target,pole:add(c.state.pole,delta)}})),node.policy);
}
