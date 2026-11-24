import {add,sub,scale,unit,cross,dot,length,type Vec3} from './math.js';
import {evaluatePoolPoseProgram,poolSkinMatrices} from './pool-contact-sample.js';
import {makePoolPoseProgram,type PoolPoseProgram} from './pool-pose-program.js';
import {posedCageSurface} from './geometry-proof.js';
import {PoolSolidIndex,type Triangle} from './pool-solid.js';
import {poolIntervalPreference} from './pool-contact-sample.js';
import {translatePoolRoot} from './pool-canonical-pose.js';
import {configuredPoolChainReach,poolRootRayIntervals} from './pool-entry-domain.js';
import type {PoolCycleSource} from './pool-cycle-source.js';
type Side='L'|'R';
const W=new WeakMap<PoolCycleSource,ReturnType<typeof prepare>>();
function prepare(s:PoolCycleSource){
 const g=s.geometry[0],part=(side:Side)=>g.description.parts.filter(p=>p.name==='Creator upper arm skin '+side||p.name==='Forearm with elbow and wrist sections'+(side==='R'?'.001':''));
 const solids=s.fixture.solids.filter(o=>s.fixture.rails.some(r=>r.id===o.id)||o.id==='Pool stone coping'||o.id===s.definition.places.crest.surface).map(solid=>({solid,index:new PoolSolidIndex(solid)}));
 return {g,parts:{L:part('L'),R:part('R')},solids};
}
const point=(m:readonly number[]):Vec3=>[m[12],m[13],m[14]];
export function fitInsetArmGuides(s:PoolCycleSource,n:PoolPoseProgram,u:number){
 let data=W.get(s);if(!data){data=prepare(s);W.set(s,data);}
 const {g,parts,solids}=data,loc={action:'pool_enter',phase:u/s.definition.clockUnits};
 const evaluate=(p:PoolPoseProgram)=>evaluatePoolPoseProgram(s.bundle,s.neutral.rest,s.neutral.inverse,p,loc);
 let world=evaluate(n).world;
 const skin=(w:typeof world)=>posedCageSurface(g,s.cages[0],poolSkinMatrices(w,s.neutral.inverse));
 let mesh=skin(world),current=n;
 function hit(side:Side,mesh:Float32Array){const vertex=(i:number):Vec3=>[mesh[i*3],mesh[i*3+1],mesh[i*3+2]];
  for(const part of parts[side])for(let i=part.start;i<part.start+part.count;i+=3){
   const f:Triangle=[vertex(g.indices[i]),vertex(g.indices[i+1]),vertex(g.indices[i+2])];
   for(const {solid:o,index} of solids){
    if([0,1,2].some(a=>f.every(p=>p[a]<o.bounds[0][a])||f.every(p=>p[a]>o.bounds[1][a])))continue;
    if(f.some(p=>index.inside(p))||index.triangleWitness(f))return true;
   }
  }return false;
 }
 for(const [side,index] of [['L',2],['R',3]] as const){
  if(!hit(side,mesh))continue;
  const c=current.controls[index],shoulder=point(world[c.upper]),wrist=c.state.target,axis=unit(sub(wrist,shoulder)),orig=point(world[c.lower]);
  const perp=(d:Vec3)=>sub(d,scale(axis,dot(d,axis)));
  const radial=unit(perp(sub(orig,shoulder))),tangent=cross(axis,radial);
  const inward=side==='L'?1:-1;
  const directions:Vec3[]=[[inward,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1],[inward,1,0],[inward,-1,0],[-inward,0,0]];
  const angles=directions.map(d=>Math.atan2(dot(d,tangent),dot(d,radial))).sort((a,b)=>Math.abs(a)-Math.abs(b));
  const command=(a:number)=>{
   const pole=add(shoulder,scale(add(scale(radial,Math.cos(a)),scale(tangent,Math.sin(a))),length(sub(orig,shoulder))));
   return makePoolPoseProgram(current.preferenceBasis,current.controls.map((ctl,i)=>i===index?{...ctl,state:{...ctl.state,pole}}:ctl),current.policy);
  };
  for(const a of angles){
   let p=command(a),w=evaluate(p).world,m=skin(w);
   if(hit(side,m))continue;
   let bad=0,good=a;
   for(let i=0;i<3;i++){const x=(bad+good)/2,test=command(x),tw=evaluate(test).world,tm=skin(tw);if(hit(side,tm))bad=x;else{good=x;p=test;w=tw;m=tm;}}
   current=p;world=w;mesh=m;break;
  }
 }
 if(hit('L',mesh)||hit('R',mesh)){
  const carry=(i:number)=>i>=2&&!current.policy[i===2?'handL':'handR'].required;
  const constraints=current.controls.filter((_,i)=>!carry(i)).map(c=>({limb:s.bundle.bones[c.end].name,center:sub(c.state.target,point(world[c.upper])),reach:configuredPoolChainReach(s.neutral.rest,c.upper,c.lower,c.end)}));
  const direction:Vec3=[0,1,0];
  const span=poolRootRayIntervals(direction,constraints).find(a=>a.minimum===0);
  if(span){
   const upper=s.anatomy.handR,arm=configuredPoolChainReach(s.neutral.rest,upper.upper,upper.lower,upper.end);
   const max=Math.min(span.maximum*.92,arm.lengths[0]/2);
   let previous=0;
   const candidate=(d:number)=>{
    const pose=poolIntervalPreference(s.bundle,s.neutral.rest,s.neutral.inverse,current.preferenceBasis,current.preferenceBasis,0,true),delta=scale(direction,d);
    translatePoolRoot(pose,delta);
    const trial=makePoolPoseProgram(pose.basis,current.controls.map((c,i)=>({...c,state:{...c.state,target:carry(i)?add(c.state.target,delta):c.state.target,pole:add(c.state.pole,delta)}})),current.policy);
    const surface=skin(evaluate(trial).world);
    return !hit('L',surface)&&!hit('R',surface)?trial:undefined;
   };
   for(const fraction of [.33,.67,1]){
    const d=max*fraction,first=candidate(d);
    if(first){
     let hi=d,lo=previous,result=first;
     for(let j=0;j<3;j++){const mid=(hi+lo)/2,test=candidate(mid);if(test){hi=mid;result=test;}else lo=mid;}
     return result;
    }
    previous=d;
   }
  }
 }
 return current;
}
