import type {PoolCycleSource} from './pool-cycle-source.js';
import type {PoolPoseProgram} from './pool-pose-program.js';
import {evaluatePoolPoseProgram,poolSkinMatrices} from './pool-contact-sample.js';
import {posedCageSurface} from './geometry-proof.js';

type XY=readonly [number,number];
const cross=(a:XY,b:XY,c:XY)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);

function hull(points:XY[]){
 const ordered=points.sort((a,b)=>a[0]-b[0]||a[1]-b[1]),half=(p:XY[])=>{
  const out:XY[]=[];for(const v of p){while(out.length>1&&cross(out[out.length-2],out[out.length-1],v)<=0)out.pop();out.push(v);}out.pop();return out;
 };
 return [...half(ordered),...half(ordered.reverse())];
}

/** Find the smallest shoulder turn which fits the configured upper body between the two guards. */
export function fitLaunchPassage(source:PoolCycleSource,node:PoolPoseProgram,unit:number){
 const pose=evaluatePoolPoseProgram(source.bundle,source.neutral.rest,source.neutral.inverse,node,{action:'pool_enter',phase:unit/100000});
 const spine=pose.world[source.bundle.bones.findIndex(b=>b.name==='spine')],skin=poolSkinMatrices(pose.world,source.neutral.inverse);
 const rails=source.fixture.rails.map(r=>source.fixture.solids.find(s=>s.id===r.id)!);
 const margin=source.fixture.rails[0].radius/4,low=rails[0].bounds[1][0]+margin,high=rails[1].bounds[0][0]-margin;
 const axial=(p:XY,angle:number)=>p[0]*Math.cos(angle)-p[1]*Math.sin(angle);
 const polys:XY[]=[];
 source.geometry.forEach((g,layer)=>{
  const mesh=posedCageSurface(g,source.cages[layer],skin);
  const selected=g.description.parts.filter(p=>/bare torso|upper arm skin|Forearm with elbow|Relaxed palm|Resting thumb|two_piece top/.test(p.name));
  const ids=new Set(selected.flatMap(p=>Array.from(g.indices.subarray(p.start,p.start+p.count))));
  for(const id of ids)polys.push([mesh[id*3]-spine[12],mesh[id*3+1]-spine[13]]);
 });
 const polygon=hull(polys);if(!polygon.length)throw new Error('The launch has no selected upper body.');
 const values=(a:number)=>polygon.map(p=>axial(p,a)),width=(a:number)=>{const v=values(a);return Math.max(...v)-Math.min(...v);};
 // Projected width changes formula only at a hull edge normal. Feasible boundaries
 // solve one sinusoid for a pair of opposing hull vertices.
 const angles=new Set<number>([0,-Math.PI/2,Math.PI/2]),gap=high-low;
 for(let i=0;i<polygon.length;i++)for(let j=i+1;j<polygon.length;j++){
  const x=polygon[i][0]-polygon[j][0],y=polygon[i][1]-polygon[j][1],r=Math.hypot(x,y);
  if(r<gap)continue;
  const centre=Math.atan2(-y,x),arc=Math.acos(gap/r);
  for(const s of [1,-1])for(const shift of [-Math.PI,0,Math.PI]){
   const a=centre+s*arc+shift;if(Math.abs(a)<=Math.PI/2)angles.add(a);
  }
 }
 const sorted=[...angles].sort((a,b)=>a-b);let chosen=0;
 if(width(0)>gap){
  const candidates:number[]=[];
  for(let i=1;i<sorted.length;i++){
   const a=sorted[i-1],b=sorted[i];if(width((a+b)/2)>gap)continue;
   candidates.push(a>=0?a+Math.min(.025,(b-a)/2):b-Math.min(.025,(b-a)/2));
  }
  if(candidates.length)chosen=candidates.sort((a,b)=>Math.abs(a)-Math.abs(b)||b-a)[0];
  else{
   // The upper rail is finite. Use the narrowest posture for the subsequent
   // actual triangle check, which also considers the jump's changing height.
   for(let i=0;i<polygon.length;i++){
    const p=polygon[i],q=polygon[(i+1)%polygon.length];
    let a=Math.atan2(q[0]-p[0],q[1]-p[1]);while(a>Math.PI/2)a-=Math.PI;while(a< -Math.PI/2)a+=Math.PI;
    if(width(a)<width(chosen))chosen=a;
   }
  }
 }
 const v=values(chosen),lo=low-Math.min(...v),hi=high-Math.max(...v);
 return {yaw:chosen,dx:(lo<=hi?Math.max(lo,Math.min(hi,spine[12])):(lo+hi)/2)-spine[12]};
}
