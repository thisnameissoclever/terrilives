import {add,sub,scale,dot,cross,length,unit,multiply,type Vec3} from './math.js';
import {evaluatePoolPoseProgram,poolSkinMatrices,poolIntervalPreference} from './pool-contact-sample.js';
import {posedCageSurface} from './geometry-proof.js';
import type {PoolCycleSource} from './pool-cycle-source.js';
import {makePoolPoseProgram,type PoolPoseProgram} from './pool-pose-program.js';
import {PoolSolidIndex,type Triangle} from './pool-solid.js';
import {rollWindow} from './pool-climb-reach-in.js';
import {setPoolWorldRotation} from './pool-canonical-pose.js';
import {fitPoolKneeOrbit} from './pool-knee-orbit-fit.js';

type XY=readonly [number,number];
const wedge=(a:XY,b:XY,c:XY)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function boundary(points:XY[]):XY[]{
 const half=(p:XY[])=>{const h:XY[]=[];for(const q of p){while(h.length>=2&&wedge(h.at(-2)!,h.at(-1)!,q)<=0)h.pop();h.push(q);}h.pop();return h;};
 points.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);return [...half(points),...half(points.reverse())];
}

export function outwardArrival(source:PoolCycleSource,node:PoolPoseProgram,u:number){
 const phase=u/source.definition.clockUnits,location={action:'pool_exit_0',phase};
 if(u>=38524&&u<=45000){
  const contact=node.policy.footL;
  if(contact.required||contact.mode==='free'||contact.mode==='approach'){
   const fitted=fitPoolKneeOrbit(source,node,location,'footL',0,contact.required?'installed':'free-goal');
   if(fitted.clear)return fitted.program;
  }
 }
 if(u<24400||u>29619)return node;
 const {bundle,neutral}=source,body=source.geometry[0],solids=source.fixture.rails.map(r=>source.fixture.solids.find(s=>s.id===r.id)!);
 const world=evaluatePoolPoseProgram(bundle,neutral.rest,neutral.inverse,node,location).world;
 const surface=posedCageSurface(body,source.cages[0],poolSkinMatrices(world,neutral.inverse));
 const mesh=(id:number):Vec3=>[surface[3*id],surface[3*id+1],surface[3*id+2]];
 const parts=body.description.parts.filter(p=>[1,8,9].includes(p.region)),indices=solids.map(s=>new PoolSolidIndex(s));
 const points:Vec3[]=[];let hit=false;
 for(const p of parts)for(let k=p.start;k<p.start+p.count;k+=3){
  const tri:Triangle=[mesh(body.indices[k]),mesh(body.indices[k+1]),mesh(body.indices[k+2])];
  for(const [i,s] of solids.entries()){
   if([1,2].some(j=>tri.every(v=>v[j]<s.bounds[0][j])||tri.every(v=>v[j]>s.bounds[1][j])))continue;
   points.push(...tri);
   if(!hit&&!tri.every(v=>v[0]<s.bounds[0][0])&&!tri.every(v=>v[0]>s.bounds[1][0]))
    hit=!!indices[i].triangleWitness(tri)||tri.some(q=>indices[i].inside(q));
  }
 }
 if(!hit)return node;
 const head=bundle.bones.findIndex(b=>b.name==='head'),margin=source.fixture.rails[0].radius/8;
 const pivot=world[head].slice(12,15) as unknown as Vec3,angle=rollWindow(points,pivot,solids[0].bounds[1][0]+margin,solids[1].bounds[0][0]-margin);
 if(angle===null)return node;
 const c=Math.cos(angle),s=Math.sin(angle),p=poolIntervalPreference(bundle,neutral.rest,neutral.inverse,node.preferenceBasis,node.preferenceBasis,0,true);
 setPoolWorldRotation(p,head,multiply([c,0,-s,0,0,1,0,0,s,0,c,0,0,0,0,1],p.world[head]));
 const basis=[...node.preferenceBasis];basis[head]=p.basis[head];
 return makePoolPoseProgram(basis,node.controls,node.policy);
}

/** Choose a yaw from the swimmer's actual torso and swimsuit widths in the fitted post opening. */
export function outwardBodyPassage(source:PoolCycleSource,seam:PoolPoseProgram,phase:number){
 const posed=evaluatePoolPoseProgram(source.bundle,source.neutral.rest,source.neutral.inverse,seam,{action:'pool_exit_0',phase});
 const hip=posed.world[source.bundle.bones.findIndex(b=>b.name==='hips')],skin=poolSkinMatrices(posed.world,source.neutral.inverse);
 const points:XY[]=[];
 source.geometry.forEach((g,i)=>{
  const selected=g.description.parts.filter(p=>/bare hips|bare torso|pool .* (waist|top)/.test(p.name)),m=posedCageSurface(g,source.cages[i],skin);
  for(const part of selected)for(const id of new Set(g.indices.subarray(part.start,part.start+part.count)))points.push([m[id*3]-hip[12],m[id*3+1]-hip[13]]);
 });
 if(!points.length)throw new Error('The ladder passage lacks the selected torso.');
 const rails=source.fixture.rails.map(r=>source.fixture.solids.find(s=>s.id===r.id)!);
 const margin=source.fixture.rails[0].radius/4,minX=rails[0].bounds[1][0]+margin,maxX=rails[1].bounds[0][0]-margin;
 const hull=boundary(points),gap=maxX-minX;
 const span=(a:number)=>{const c=Math.cos(a),s=Math.sin(a),x=hull.map(p=>p[0]*c-p[1]*s),y=hull.map(p=>p[1]*c+p[0]*s);
  return {low:Math.min(...x),high:Math.max(...x),rear:Math.min(...y)};};
 const cuts=new Set<number>([-Math.PI/2,0,Math.PI/2]);
 for(let i=0;i<hull.length;i++)for(let j=i+1;j<hull.length;j++){
  const x=hull[i][0]-hull[j][0],y=hull[i][1]-hull[j][1],r=Math.hypot(x,y);if(r<gap)continue;
  const mid=Math.atan2(-y,x),range=Math.acos(gap/r);
  for(const sign of [-1,1])for(const k of [-Math.PI,0,Math.PI]){const t=mid+sign*range+k;if(Math.abs(t)<=Math.PI/2)cuts.add(t);}
 }
 const sorted=[...cuts].sort((a,b)=>a-b),options:number[]=[];
 if(span(0).high-span(0).low<=gap)options.push(0);
 for(let i=1;i<sorted.length;i++){
  const a=sorted[i-1],b=sorted[i],middle=(a+b)/2,box=span(middle);if(box.high-box.low>gap)continue;
  const inset=Math.min(Math.PI/60,(b-a)/2);
  options.push(a>=0?a+inset:b-inset);
 }
 // If the conservative torso projection is wider than the opening, choose its narrowest side.
 // The observer still checks whether the finite posts intersect each actual triangle.
 const angle=options.length?options.sort((a,b)=>Math.abs(a)-Math.abs(b)||b-a)[0]:
   [Math.PI/2,-Math.PI/2].sort((a,b)=>(span(a).high-span(a).low)-(span(b).high-span(b).low))[0];
 const front=Math.max(...rails.map(r=>r.bounds[1][1]))+margin;
 return {angle,position(a:number){
  const b=span(a);return {x:(minX+maxX-b.low-b.high)/2,y:front-b.rear};
 }};
}

/** Select a reachable elbow on its actual bend circle, between the wrist and the ladder centre. */
export function outwardElbow(shoulder:Vec3,wrist:Vec3,preferred:Vec3,upper:number,lower:number,centre:number):Vec3{
 const chord=sub(wrist,shoulder),d=length(chord);
 if(d<=Math.abs(upper-lower)||d>=upper+lower)return preferred;
 const axis=scale(chord,1/d),along=(d*d+upper*upper-lower*lower)/(2*d),origin=add(shoulder,scale(axis,along));
 const r=Math.sqrt(Math.max(0,upper*upper-along*along)),normal=sub([1,0,0],scale(axis,axis[0])),dx=length(normal);
 if(dx*r<1e-8)return preferred;
 const u=unit(normal),v=cross(axis,u),x=Math.max(-1,Math.min(1,((shoulder[0]+centre)/2-origin[0])/(r*dx)));
 const y=(dot(sub(preferred,origin),v)<0?-1:1)*Math.sqrt(1-x*x);
 return add(shoulder,scale(add(scale(u,x),scale(v,y)),upper));
}
