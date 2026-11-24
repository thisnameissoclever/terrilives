import {add,sub,scale,dot,cross,unit,length,multiply,transform,type Vec3} from './math.js';
import {poolIntervalPreference,evaluatePoolPoseProgram,poolSkinMatrices} from './pool-contact-sample.js';
import {posedCageSurface} from './geometry-proof.js';
import {setPoolWorldRotation,translatePoolRoot} from './pool-canonical-pose.js';
import {PoolSolidIndex,type Triangle} from './pool-solid.js';
import {makePoolPoseProgram,type PoolPoseProgram} from './pool-pose-program.js';
import {sliceX,polar} from './pool-pivot-lean.js';
import type {PoolCycleSource,PoolFoot} from './pool-cycle-source.js';
import type {PoolSourceLocation} from './pool-source-policy.js';

type Range=[number,number];
type Face={v:Vec3[];lo:number;hi:number;r:ReturnType<typeof polar>};
const zero:Vec3=[0,0,0],point=(m:readonly number[]):Vec3=>[m[12],m[13],m[14]],bound=Math.PI/2;
const merge=(r:Range[])=>{const out:Range[]=[];
 for(const [a,b] of r.sort((l,h)=>l[0]-h[0])){if(!out.length||a>out[out.length-1][1])out.push([a,b]);else out[out.length-1][1]=Math.max(out[out.length-1][1],b);}return out;
};

/** Orbit a knee around its fixed hip/ankle chord, with the other limbs free to follow. */
export function fitLoadedLegOrbit(source:PoolCycleSource,node:PoolPoseProgram,loc:PoolSourceLocation,limb:PoolFoot,preferred=0){
 const others=limb==='footL'?'footR':'footL',i=limb==='footL'?0:1;
 if(!node.policy[limb].required||node.policy[others].required||node.policy.handL.required||node.policy.handR.required)
  throw new Error('The loaded-leg orbit needs its declared sole and three free limbs.');
 const {bundle,neutral}=source,pose=evaluatePoolPoseProgram(bundle,neutral.rest,neutral.inverse,node,loc);
 const a=source.anatomy[limb],ankle=node.controls[i].state.target,hipSocket=point(pose.world[a.upper]),axis=unit(sub(hipSocket,ankle));
 const ortho=unit(cross(axis,Math.abs(axis[0])<.8?[1,0,0]:[0,1,0])),vertical=cross(axis,ortho);
 const chart=(p:Vec3):Vec3=>{const v=sub(p,ankle);return [dot(v,axis),dot(v,ortho),dot(v,vertical)];};
 const skin=poolSkinMatrices(pose.world,neutral.inverse),margin=source.fixture.rails[0].radius/12;
 const solids=source.fixture.rails.map(r=>source.fixture.solids.find(s=>s.id===r.id)!);
 const indexes=solids.map(s=>new PoolSolidIndex(s));
 const layers=source.geometry.map((g,slot)=>{
  const drawable=g.description.parts.filter(p=>p.name!=='Creator bare foot '+limb.slice(-1));
  return {g,mesh:posedCageSurface(g,source.cages[slot],skin),drawable};
 });
 function collides(){
  for(const {g,mesh,drawable} of layers){
   const pt=(k:number):Vec3=>[mesh[k*3],mesh[k*3+1],mesh[k*3+2]];
   for(const part of drawable)for(let n=part.start;n<part.start+part.count;n+=3){
    const ids=g.indices.subarray(n,n+3);
    for(let j=0;j<solids.length;j++){
     const s=solids[j];if([0,1,2].some(k=>ids.every(id=>mesh[id*3+k]<s.bounds[0][k]-margin)||ids.every(id=>mesh[id*3+k]>s.bounds[1][k]+margin)))continue;
     const tri:Triangle=[pt(ids[0]),pt(ids[1]),pt(ids[2])];
     if(tri.some(v=>indexes[j].clearance(v).distance<margin)||indexes[j].minimumTriangleGap(tri,margin)<margin)return true;
    }
   }
  }return false;
 }
 if(!preferred&&!collides())return {program:node,angle:0,allowed:[[0,0]] as Range[],changed:false};
 const faces:Face[]=[],buckets=new Map<number,number[]>(),cell=.10;
 const visit=(lo:number,hi:number,r0:number,r1:number,f:(key:number)=>void)=>{
  for(let x=Math.floor(lo/cell);x<=Math.floor(hi/cell);x++)for(let r=Math.floor(r0/cell);r<=Math.floor(r1/cell);r++)f((x+64)*256+r+64);
 };
 for(const s of solids)for(const tri of s.triangles){
  const v=tri.map(id=>chart(s.vertices[id])),r=polar(v,zero),lo=Math.min(...v.map(p=>p[0])),hi=Math.max(...v.map(p=>p[0])),id=faces.length;
  faces.push({v,r,lo,hi});visit(lo,hi,r.low-margin,r.high+margin,k=>{const ids=buckets.get(k)??[];ids.push(id);buckets.set(k,ids);});
 }
 let blocked:Range[]=[];const seen=new Int32Array(faces.length);let serial=0;
 for(const {g,mesh,drawable} of layers){
  const pts=new Map<number,Vec3>(),at=(id:number)=>{let p=pts.get(id);if(!p){p=chart([mesh[id*3],mesh[id*3+1],mesh[id*3+2]]);pts.set(id,p);}return p;};
  for(const part of drawable)for(let n=part.start;n<part.start+part.count;n+=3){
   const p=[at(g.indices[n]),at(g.indices[n+1]),at(g.indices[n+2])],lo=Math.min(p[0][0],p[1][0],p[2][0]),hi=Math.max(p[0][0],p[1][0],p[2][0]),r=polar(p,zero);serial++;
   visit(lo,hi,r.low,r.high,k=>{for(const id of buckets.get(k)??[]){
    if(seen[id]===serial)continue;seen[id]=serial;const h=faces[id];
    if(h.lo>hi||h.hi<lo||h.r.low>r.high+margin||h.r.high+margin<r.low)continue;
    const body=sliceX(p,h.lo,h.hi),metal=sliceX(h.v,lo,hi);if(!body.length||!metal.length)continue;
    const br=polar(body,zero),hr=polar(metal,zero);if(br.low>hr.high+margin||hr.low>br.high+margin)continue;
    const pad=Math.atan2(margin,Math.max(margin,br.low));
    for(const offset of [-2*Math.PI,0,2*Math.PI]){const x=Math.max(-bound,hr.angleLow-br.angleHigh+offset-pad),y=Math.min(bound,hr.angleHigh-br.angleLow+offset+pad);if(x<=y)blocked.push([x,y]);}
   }});
   if(blocked.length>4096)blocked=merge(blocked);
  }
 }
 const allowed:Range[]=[];let lo=-bound;
 for(const [x,y] of merge(blocked)){if(x>lo)allowed.push([lo,x]);lo=Math.max(lo,y);}
 if(lo<bound)allowed.push([lo,bound]);
 if(!allowed.length)return {program:node,angle:0,allowed,changed:false};
 const angle=allowed.map(([x,y])=>Math.max(x+Math.min(.012,(y-x)/2),Math.min(y-Math.min(.012,(y-x)/2),preferred)))
  .sort((x,y)=>Math.abs(x-preferred)-Math.abs(y-preferred))[0];
 if(angle===0)return {program:node,angle,allowed,changed:false};
 const [x,y,z]=axis,c=Math.cos(angle),s=Math.sin(angle),k=1-c;
 const Q=[c+x*x*k,y*x*k+z*s,z*x*k-y*s,0,x*y*k-z*s,c+y*y*k,z*y*k+x*s,0,x*z*k+y*s,y*z*k-x*s,c+z*z*k,0,0,0,0,1];
 const carry=(v:Vec3)=>add(ankle,transform(Q,sub(v,ankle)));
 const adjusted=poolIntervalPreference(bundle,neutral.rest,neutral.inverse,node.preferenceBasis,node.preferenceBasis,0,true);
 const hip=bundle.bones.findIndex(b=>b.name==='hips'),old=adjusted.world[hip],goal=carry(point(old));
 setPoolWorldRotation(adjusted,hip,multiply(Q,old));translatePoolRoot(adjusted,sub(goal,point(adjusted.world[hip])));
 const result=makePoolPoseProgram(adjusted.basis,node.controls.map((c,j)=>{
  const f=c.state;return {...c,state:{...f,target:j===i?ankle:carry(f.target),pole:carry(f.pole),
   orientation:j===i||j<2&&node.policy[j===0?'footL':'footR'].mode!=='free'?f.orientation:multiply(Q,f.orientation)}};
 }),node.policy);
 return {program:result,angle,allowed,changed:true};
}
