import {add,sub,scale,dot,cross,unit,length,multiply,transform,type Vec3} from './math.js';
import {poolIntervalPreference,evaluatePoolPoseProgram,poolSkinMatrices} from './pool-contact-sample.js';
import {posedCageSurface} from './geometry-proof.js';
import {PoolSolidIndex,type Triangle} from './pool-solid.js';
import {makePoolPoseProgram,type PoolPoseProgram} from './pool-pose-program.js';
import {setPoolWorldRotation,translatePoolRoot} from './pool-canonical-pose.js';
import type {PoolCycleSource} from './pool-cycle-source.js';

type Plane={a:Vec3;b:number};
const X:Vec3=[1,0,0],position=(m:readonly number[]):Vec3=>[m[12],m[13],m[14]];
function nearestAxis(planes:Plane[]):Vec3|undefined{
 let best:Vec3|undefined;
 const addCandidate=(v:Vec3)=>{
  if((!best||v[0]>best[0])&&planes.every(p=>dot(p.a,v)<=p.b+1e-9))best=v;
 };
 addCandidate(X);
 for(let i=0;i<planes.length;i++){
  const p=planes[i];if(Math.abs(p.b)>1)continue;
  const center=scale(p.a,p.b),radius=Math.sqrt(1-p.b*p.b),toward=sub(X,scale(p.a,p.a[0]));
  if(length(toward)>1e-10)addCandidate(add(center,scale(unit(toward),radius)));
  for(let j=0;j<i;j++){
   const q=planes[j],d=dot(p.a,q.a),den=1-d*d;if(den<1e-10)continue;
   const h=add(scale(p.a,(p.b-d*q.b)/den),scale(q.a,(q.b-d*p.b)/den)),z=1-dot(h,h);
   if(z<0)continue;
   const normal=scale(unit(cross(p.a,q.a)),Math.sqrt(z));addCandidate(add(h,normal));addCandidate(sub(h,normal));
  }
 }
 return best;
}

/** Correct the departure about the loaded ankle if a configured surface touches a rail. */
export function fitLaunchAnkle(source:PoolCycleSource,launch:PoolPoseProgram,unitAt:number){
 const solved=evaluatePoolPoseProgram(source.bundle,source.neutral.rest,source.neutral.inverse,launch,{action:'pool_enter',phase:unitAt/100000});
 const skin=poolSkinMatrices(solved.world,source.neutral.inverse),ankle=launch.controls[1].state.target,margin=source.fixture.rails[0].radius/8;
 const rails=source.fixture.rails.map(r=>source.fixture.solids.find(s=>s.id===r.id)!);
 const indices=rails.map(r=>new PoolSolidIndex(r));
 const points:Vec3[]=[];let collides=false;
 for(const [gi,g] of source.geometry.entries()){
  const mesh=posedCageSurface(g,source.cages[gi],skin),p=(id:number):Vec3=>[mesh[id*3],mesh[id*3+1],mesh[id*3+2]],ids=new Set<number>();
  for(const part of g.description.parts)for(let k=part.start;k<part.start+part.count;k+=3){
   const a=g.indices[k],b=g.indices[k+1],c=g.indices[k+2];ids.add(a);ids.add(b);ids.add(c);
   if(collides)continue;
   for(const [j,r] of rails.entries()){
    if([0,1,2].some(axis=>[a,b,c].every(id=>mesh[id*3+axis]<r.bounds[0][axis])||[a,b,c].every(id=>mesh[id*3+axis]>r.bounds[1][axis])))continue;
    const tri:Triangle=[p(a),p(b),p(c)];if(tri.some(v=>indices[j].clearance(v).distance<0)||indices[j].triangleWitness(tri)){collides=true;break;}
   }
  }
  for(const id of ids){const v=p(id);if(v[2]>rails[0].bounds[1][2]+.18)continue;points.push(sub(v,ankle));}
 }
 if(!collides)return {yaw:0,lean:0};
 const low=rails[0].bounds[1][0]+margin-ankle[0],high=rails[1].bounds[0][0]-margin-ankle[0];
 const tilt=Math.sin(Math.PI/6),planes:Plane[]=[{a:[-1,0,0],b:0},{a:[0,0,1],b:tilt},{a:[0,0,-1],b:tilt}];
 let axis=X,best=X,minimum=Infinity;
 for(let attempt=0;attempt<40;attempt++){
  let worst=0,witness:Vec3|undefined,side=1;
  for(const v of points){
   const x=dot(v,axis);
   if(x-high>worst){worst=x-high;witness=v;side=1;}
   if(low-x>worst){worst=low-x;witness=v;side=-1;}
  }
  if(worst<minimum){minimum=worst;best=axis;}
  if(!witness||worst<1e-7)break;
  const n=length(witness);if(n<1e-8)break;
  planes.push({a:scale(witness,side/n),b:(side>0?high:-low)/n});
  const next=nearestAxis(planes);if(!next)break;axis=next;
 }
 return {yaw:Math.atan2(-best[1],best[0]),lean:Math.asin(Math.max(-1,Math.min(1,best[2])))};
}

export function applyLaunchAnkle(source:PoolCycleSource,node:PoolPoseProgram,yaw:number,lean:number):PoolPoseProgram{
 if(yaw===0&&lean===0)return node;
 const a=Math.cos(yaw),b=Math.sin(yaw),c=Math.cos(lean),s=Math.sin(lean);
 const rot=[c*a,b,-s*a,0,-c*b,a,s*b,0,s,0,c,0,0,0,0,1],origin=node.controls[1].state.target;
 const carry=(v:Vec3)=>add(origin,transform(rot,sub(v,origin)));
 const p=poolIntervalPreference(source.bundle,source.neutral.rest,source.neutral.inverse,node.preferenceBasis,node.preferenceBasis,0,true);
 const hip=source.bundle.bones.findIndex(b=>b.name==='hips'),old=p.world[hip],goal=carry(position(old));
 setPoolWorldRotation(p,hip,multiply(rot,old));translatePoolRoot(p,sub(goal,position(p.world[hip])));
 return makePoolPoseProgram(p.basis,node.controls.map((v,i)=>{
  if(v.state.attached)throw new Error('Ankle-centered flight preparation requires released hands.');
  const f=v.state;return {...v,state:{target:i===1?origin:carry(f.target),pole:carry(f.pole),orientation:i===1?f.orientation:multiply(rot,f.orientation)}};
 }),node.policy);
}
