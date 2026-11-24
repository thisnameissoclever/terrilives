import {add,sub,scale,dot,cross,unit,length,multiply,transform,type Vec3} from './math.js';
import {evaluatePoolPoseProgram,poolSkinMatrices} from './pool-contact-sample.js';
import {properPoolRotation} from './pool-canonical-pose.js';
import {posedCageSurface} from './geometry-proof.js';
import {PoolSolidIndex,type Triangle} from './pool-solid.js';
import type {PoolCycleSource} from './pool-cycle-source.js';
import type {PoolPoseProgram} from './pool-pose-program.js';

const point=(m:readonly number[]):Vec3=>[m[12],m[13],m[14]];
type Range=[number,number];

/** Fold a released leg around its own configured hinge if its straight flight would touch its rail. */
export function prepareFlightTuck(source:PoolCycleSource,departure:PoolPoseProgram,seconds:number,forward:number,up:number){
 const {neutral,bundle}=source,world=evaluatePoolPoseProgram(bundle,neutral.rest,neutral.inverse,departure,{action:'pool_enter',phase:.6}).world;
 const g=source.geometry[0],mesh=posedCageSurface(g,source.cages[0],poolSkinMatrices(world,neutral.inverse));
 const at=(id:number):Vec3=>[mesh[id*3],mesh[id*3+1],mesh[id*3+2]];
 const fit=(limb:'footL'|'footR',index:number)=>{
  const a=source.anatomy[limb],h=point(world[a.upper]),lower=properPoolRotation(bundle.basisActions.pool_enter[0][a.lower]);
  const local=unit([lower[6]-lower[9],lower[8]-lower[2],lower[1]-lower[4]]);
  const m=[...world[a.lower]];m.splice(12,3,0,0,0);const axis=unit(transform(m,local));
  const rail=source.fixture.solids.find(s=>s.id===source.fixture.rails[index].id)!,solid=new PoolSolidIndex(rail);
  const part=g.description.parts.find(p=>p.name==='Creator bare leg '+(index===0?'L':'R'))!;
  const side=index===0?-1:1,limit=side*(index===0?rail.bounds[1][0]:rail.bounds[0][0])-source.fixture.rails[index].radius/8;
  const witnesses=new Set<number>();
  for(let k=part.start;k<part.start+part.count;k+=3){
   const ids=[g.indices[k],g.indices[k+1],g.indices[k+2]],pts=ids.map(at);
   if(pts.every(p=>p[0]<rail.bounds[0][0])||pts.every(p=>p[0]>rail.bounds[1][0]))continue;
   for(let n=1;n<=12;n++){
    const t=seconds*n/12,d:Vec3=[0,forward*t,up*t-4.905*t*t];
    if([1,2].some(j=>pts.every(p=>p[j]+d[j]<rail.bounds[0][j])||pts.every(p=>p[j]+d[j]>rail.bounds[1][j])))continue;
    const tri=pts.map(p=>add(p,d)) as unknown as Triangle;
    if(tri.some(p=>solid.clearance(p).distance<0)||solid.triangleWitness(tri)){for(const id of ids)witnesses.add(id);break;}
   }
  }
  let allowed:Range[]=[[-Math.PI/3,Math.PI/3]];
  for(const id of witnesses){
   const rel=sub(at(id),h),along=scale(axis,dot(rel,axis)),rad=sub(rel,along),sw=cross(axis,rad);
   const A=side*rad[0],B=side*sw[0],norm=Math.hypot(A,B),C=limit-side*(h[0]+along[0]);
   if(norm<1e-10||C>=norm)continue;
   if(C<=-norm){allowed=[];break;}
   const centre=Math.atan2(B,A),cut=Math.acos(C/norm),next:Range[]=[];
   for(const [l,r] of allowed)for(const delta of [-2*Math.PI,0,2*Math.PI]){
    const lo=Math.max(l,centre+cut+delta),hi=Math.min(r,centre+2*Math.PI-cut+delta);if(hi>lo)next.push([lo,hi]);
   }
   allowed=next;
  }
  const angle=allowed.map(([l,r])=>l<=0&&r>=0?0:Math.abs(l)<Math.abs(r)?l+Math.min(.012,(r-l)/2):r-Math.min(.012,(r-l)/2))
   .sort((a,b)=>Math.abs(a)-Math.abs(b))[0]??0;
  return (u:number)=>{
   const t=angle*u,c=Math.cos(t),s=Math.sin(t),v=1-c,[x,y,z]=axis;
   const Q=[c+x*x*v,y*x*v+z*s,z*x*v-y*s,0,x*y*v-z*s,c+y*y*v,z*y*v+x*s,0,x*z*v+y*s,y*z*v-x*s,c+z*z*v,0,0,0,0,1];
   const f=departure.controls[index].state,carry=(p:Vec3)=>add(h,transform(Q,sub(p,h)));
   return angle===0?f:{...f,target:carry(f.target),pole:carry(point(world[a.lower])),orientation:multiply(Q,f.orientation)};
  };
 };
 return [fit('footL',0),fit('footR',1)] as const;
}
