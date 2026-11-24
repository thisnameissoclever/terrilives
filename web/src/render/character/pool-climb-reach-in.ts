import {add,sub,multiply,type Vec3} from './math.js';
import type {PoolCycleSource} from './pool-cycle-source.js';
import {makePoolPoseProgram,type PoolPoseProgram} from './pool-pose-program.js';
import {evaluatePoolPoseProgram,interpolatePoolPoseProgram,poolIntervalPreference,poolSkinMatrices} from './pool-contact-sample.js';
import {posedCageSurface} from './geometry-proof.js';
import {PoolSolidIndex,type Triangle} from './pool-solid.js';
import {poolSurfacePoint} from './pool-entry-anatomy.js';
import {setPoolWorldRotation} from './pool-canonical-pose.js';
import {configuredPoolChainReach,poolChainReachable} from './pool-entry-domain.js';
import {PoolTrialRefusal} from './pool-trial-work.js';

const point=(m:readonly number[]):Vec3=>[m[12],m[13],m[14]];
type Range=[number,number];
const cap=Math.PI/6;
export function rollWindow(points:readonly Vec3[],pivot:Vec3,low:number,high:number):number|null{
  let window:Range[]=[[-cap,cap]];
  for(const p of points){
    const x=p[0]-pivot[0],z=p[2]-pivot[2],r=Math.hypot(x,z),centre=Math.atan2(z,x);
    if(!r)continue;
    const cuts=[-cap,cap];
    for(const edge of [low,high]){
      const ratio=(edge-pivot[0])/r;if(Math.abs(ratio)>1)continue;
      const a=Math.acos(ratio);
      for(const sign of [-1,1])for(const turn of [-2*Math.PI,0,2*Math.PI]){
        const v=centre+sign*a+turn;if(v>-cap&&v<cap)cuts.push(v);
      }
    }
    cuts.sort((a,b)=>a-b);
    const next:Range[]=[];
    for(let i=1;i<cuts.length;i++){
      const t=(cuts[i-1]+cuts[i])/2,q=pivot[0]+Math.cos(t)*x+Math.sin(t)*z;
      if(q<low||q>high)continue;
      for(const [lo,hi] of window){const a=Math.max(lo,cuts[i-1]),b=Math.min(hi,cuts[i]);if(a<=b)next.push([a,b]);}
    }
    window=next;if(!window.length)return null;
  }
  return window.map(([lo,hi])=>Math.max(lo,Math.min(hi,0))).sort((a,b)=>Math.abs(a)-Math.abs(b))[0]??null;
}

/** Verify the swept face and hands across the turn before asking the swimmer to lean or reorient a wrist. */
export function fitClimbApproach(source:PoolCycleSource,keys:Map<number,PoolPoseProgram>):void {
  const def=source.definition;if(def.version!==16||!def.forwardHop?.launchFromUnit)return;
  const plan=def.forwardHop.climbKeys,from=plan.find(k=>k.authoredUnit===58000)?.unit,to=plan.find(k=>k.authoredUnit===64000)?.unit;
  if(from===undefined||to===undefined)throw new Error('Missing authored climb reach-in window.');
  const units=plan.map(k=>k.unit).filter(u=>u>=from&&u<=to),g=source.geometry[0],n=source.neutral;
  const solids=source.fixture.rails.map(r=>source.fixture.solids.find(s=>s.id===r.id)!);
  const indices=solids.map(s=>new PoolSolidIndex(s)),margin=source.fixture.rails[0].radius/8;
  const head=g.description.parts.filter(p=>p.region===1||p.region===8);
  const hands=['handL','handR'] as const;
  const palm=hands.map((_,i)=>g.description.parts.filter(p=>['Relaxed palm','Resting thumb'].some(name=>p.name===name+(i?'.001':''))));
  const hit=[new Set<number>(),new Set<number>(),new Set<number>()],parts=[head,...palm];
  const vertices=parts.map(group=>[...new Set(group.flatMap(p=>Array.from(g.indices.subarray(p.start,p.start+p.count))))]);
  const marked=parts.map(()=>new Set<number>());
  for(let i=1;i<units.length;i++)for(const t of [.25,.5,.75]){
    const u=units[i-1],v=units[i],a=keys.get(u)!,b=keys.get(v)!;
    const pose=interpolatePoolPoseProgram(source.bundle,n.rest,n.inverse,a,b,t,{action:'pool_exit_0',phase:(u+(v-u)*t)/def.clockUnits});
    const skin=posedCageSurface(g,source.cages[0],poolSkinMatrices(pose.world,n.inverse));
    const p=(id:number):Vec3=>[skin[id*3],skin[id*3+1],skin[id*3+2]];
    for(let j=0;j<parts.length;j++){
      if(marked[j].has(i))continue;
      let lo=Infinity,hi=-Infinity;
      for(const id of vertices[j]){const x=skin[id*3];lo=Math.min(lo,x);hi=Math.max(hi,x);}
      const candidates=solids.map((solid,index)=>({solid,index})).filter(({solid})=>hi>=solid.bounds[0][0]&&lo<=solid.bounds[1][0]);
      if(!candidates.length)continue;
      outer:for(const part of parts[j])for(let k=part.start;k<part.start+part.count;k+=3){
        const tri:Triangle=[p(g.indices[k]),p(g.indices[k+1]),p(g.indices[k+2])];
        for(const {index,solid} of candidates){
          if([0,1,2].some(axis=>tri.every(q=>q[axis]<solid.bounds[0][axis])||tri.every(q=>q[axis]>solid.bounds[1][axis])))continue;
          if(tri.some(q=>q.every((v,i)=>v>=solid.bounds[0][i]&&v<=solid.bounds[1][i])&&indices[index].inside(q))||indices[index].triangleWitness(tri)){
            marked[j].add(i);hit[j].add(u);hit[j].add(v);break outer;
          }
        }
      }
    }
  }
  const arrived=keys.get(to)!,neck=source.bundle.bones.findIndex(b=>b.name==='head'),spine=source.bundle.bones.findIndex(b=>b.name==='spine');
  const finalFree=units.at(-2)!;
  for(let i=0;i<2;i++){
    const prior=keys.get(finalFree)!.controls[i+2].state,last=arrived.controls[i+2].state;
    if(!prior.attached&&last.attached&&(prior.target[1]!==last.target[1]||prior.target[2]!==last.target[2]||
      prior.orientation.some((v,k)=>v!==last.orientation[k])))hit[i+1].add(finalFree);
  }
  if(!hit.some(s=>s.size))return;
  const headVertices=vertices[0];
  for(const u of units){
    const node=keys.get(u)!,loc={action:'pool_exit_0',phase:u/def.clockUnits},pose=poolIntervalPreference(source.bundle,n.rest,n.inverse,node.preferenceBasis,node.preferenceBasis,0,true);
    const shoulder=hands.map(l=>point(pose.world[source.anatomy[l].upper]));
    if(!hit.some(s=>s.has(u)))continue;
    let rotated=false;
    if(hit[0].has(u)){
      const solved=evaluatePoolPoseProgram(source.bundle,n.rest,n.inverse,node,loc),mesh=posedCageSurface(g,source.cages[0],poolSkinMatrices(solved.world,n.inverse));
      const points=headVertices.map(id=>[mesh[id*3],mesh[id*3+1],mesh[id*3+2]] as Vec3);
      const low=solids[0].bounds[1][0]+margin,high=solids[1].bounds[0][0]-margin;
      const neckAngle=rollWindow(points,point(solved.world[neck]),low,high);
      const joint=neckAngle===null?spine:neck,angle=neckAngle??rollWindow(points,point(solved.world[spine]),low,high);
      if(angle===null)throw new PoolTrialRefusal('The selected face and hair cannot pass between the ladder guards at '+u);
      if(angle!==0){const c=Math.cos(angle),s=Math.sin(angle);setPoolWorldRotation(pose,joint,multiply([c,0,-s,0,0,1,0,0,s,0,c,0,0,0,0,1],pose.world[joint]));rotated=true;}
    }
    const controls=node.controls.map((control,i)=>{
      if(i<2)return control;
      const j=i-2,limb=hands[j],a=source.anatomy[limb],upper=point(pose.world[a.upper]);
      const reach=configuredPoolChainReach(n.rest,a.upper,a.lower,a.end);
      let state={...control.state,pole:add(control.state.pole,sub(upper,shoulder[j]))};
      const trailing=limb==='handL'&&def.forwardHop!.outerGripTransfer?.kind==='right-first';
      if(trailing&&!state.attached)state={...state,target:add(state.target,sub(upper,shoulder[j]))};
      if(!trailing&&hit[1+j].has(u)&&u<to){
        const end=arrived.controls[i].state,goal=end.attached;
        if(!goal||state.attached)throw new Error('The reach-in needs a free wrist and its actual destination grasp.');
        const f=(to-u)/(to-from),side=goal.geometry.side,plane=goal.geometry.planeX;
        const inset=Math.max(0,...a.completeHandCoefficients!.map(coeff=>side*(plane-poolSurfacePoint(end.orientation,coeff)[0]-end.target[0]*coeff[3])/coeff[3]));
        const minimum=reach.minimum+margin,maximum=reach.maximum-margin;
        const wanted=end.target[0]+side*(inset+Math.max(margin,2*source.fixture.rails[0].radius*f));
        const guard=end.target[0]+side*(inset+margin);
        const x=Math.max(upper[0]-maximum+margin,Math.min(upper[0]+maximum-margin,wanted)),dx=x-upper[0];
        if(side*(x-guard)<0)throw new PoolTrialRefusal('The free climb wrist cannot reach the safe side of its rail at '+u);
        const dy=end.target[1]-upper[1],dz=end.target[2]-upper[2],radial=Math.hypot(dy,dz);
        const yz=Math.max(Math.sqrt(Math.max(0,minimum*minimum-dx*dx)),Math.min(Math.sqrt(Math.max(0,maximum*maximum-dx*dx)),radial));
        const target:Vec3=[x,upper[1]+(radial?dy/radial:0)*yz,upper[2]+(radial?dz/radial:1)*yz];
        state={...state,target,orientation:end.orientation};
      }
      if(!poolChainReachable(reach,upper,state.target))throw new PoolTrialRefusal('The ladder reach-in exceeds '+limb+' reach at '+u);
      return {...control,state};
    });
    keys.set(u,makePoolPoseProgram(rotated?pose.basis:node.preferenceBasis,controls,node.policy));
  }
}
