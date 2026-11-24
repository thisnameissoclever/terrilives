import {add,sub,dot,cross,scale,length,unit as direction,multiply,transform,type Vec3} from './math.js';
import {evaluatePoolPoseProgram,interpolatePoolPoseProgram,poolIntervalPreference,poolSkinMatrices} from './pool-contact-sample.js';
import {makePoolPoseProgram,type PoolPoseProgram} from './pool-pose-program.js';
import type {PoolCycleSource} from './pool-cycle-source.js';
import {posedCageSurface} from './geometry-proof.js';
import {PoolSolidIndex,type Triangle} from './pool-solid.js';
import {configuredPoolChainReach,poolChainReachable} from './pool-entry-domain.js';
import {fitAssembly} from './contact-math.js';
import {setPoolWorldRotation,translatePoolRoot} from './pool-canonical-pose.js';
import {PoolTrialRefusal} from './pool-trial-work.js';
import {poolSourcePolicy} from './pool-source-policy.js';
import type {PoolSolid} from './pool-contact-types.js';
import {poolAngularHalfPlane} from './pool-knee-orbit-fit.js';

const pos=(m:readonly number[]):Vec3=>[m[12],m[13],m[14]];
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
const ease=(v:number)=>{const t=clamp(v,0,1);return t*t*(3-2*t);};
const mix=(a:number,b:number,t:number)=>a+(b-a)*t;
const wrap=(v:number)=>Math.atan2(Math.sin(v),Math.cos(v));
const yaw=(a:number)=>[Math.cos(a),Math.sin(a),0,0,-Math.sin(a),Math.cos(a),0,0,0,0,1,0,0,0,0,1];
const pitch=(a:number)=>[1,0,0,0,0,Math.cos(a),Math.sin(a),0,0,-Math.sin(a),Math.cos(a),0,0,0,0,1];
const limbs=['footL','footR','handL','handR'] as const;

/** Choose the elbow from its actual reach circle. The guide stays on the swimmer's side of the rail. */
function armGuide(s:Vec3,w:Vec3,preferred:Vec3,upper:number,lower:number,mid:number):Vec3{
  const chord=sub(w,s),d=length(chord),axis=scale(chord,1/d);
  const along=(d*d+upper*upper-lower*lower)/(2*d),origin=add(s,scale(axis,along)),radius=Math.sqrt(Math.max(0,upper*upper-along*along));
  const across:Vec3=[1,0,0],project=sub(across,scale(axis,axis[0])),width=length(project);
  if(width<1e-6)return preferred;
  const normal=scale(project,1/width),tangent=cross(axis,normal),wanted=clamp(((mid+s[0])/2-origin[0])/(Math.max(radius,1e-9)*width),-1,1);
  const side=dot(sub(preferred,origin),tangent)>=0?1:-1;
  return add(origin,scale(add(scale(normal,wanted),scale(tangent,side*Math.sqrt(Math.max(0,1-wanted*wanted)))),upper));
}

/** Keep one centered egress from the inside turn to the outside stance. Both wrists and both legs use the same pelvis. */
export function fitClimbPassage(source:PoolCycleSource,programs:Map<number,PoolPoseProgram>){
  const motion=source.definition;if(motion.version!==16||!motion.forwardHop?.launchFromUnit)return;
  const plan=motion.forwardHop.climbKeys,from=plan.find(k=>k.authoredUnit===60000)?.unit,
    end=plan.find(k=>k.entryUnit===motion.forwardHop!.launchFromUnit)?.unit;
  if(from===undefined||end===undefined)throw new Error('The crest passage lacks its two declared stances.');
  const {fixture,bundle,neutral}=source,clock=motion.clockUnits,act='pool_exit_0';
  const stance=(node:PoolPoseProgram)=>poolIntervalPreference(bundle,neutral.rest,neutral.inverse,node.preferenceBasis,node.preferenceBasis,0,true);
  const hip=bundle.bones.findIndex(b=>b.name==='hips'),spine=bundle.bones.findIndex(b=>b.name==='spine');
  const start=stance(programs.get(from)!),finish=stance(programs.get(end)!);
  const heading=(world:readonly number[][],shoulders=false)=>{
    const chord=sub(pos(world[source.anatomy[shoulders?'handR':'footR'].upper]),pos(world[source.anatomy[shoulders?'handL':'footL'].upper]));
    return Math.atan2(chord[1],chord[0]);
  };
  const h0=heading(start.world),h1=heading(finish.world),z0=start.world[hip][14],z1=finish.world[hip][14];
  const s0=heading(start.world,true),s1=heading(finish.world,true);
  const rails=fixture.rails.map(r=>fixture.solids.find(s=>s.id===r.id)!),
    margin=fixture.rails[0].radius/8,lo=rails[0].bounds[1][0]+margin,hi=rails[1].bounds[0][0]-margin,mid=(lo+hi)/2;
  const obstacles=[...rails,...['crest','outside3','inside3'].map(place=>fixture.solids.find(s=>s.id===motion.places[place].surface)!)];
  const indices=obstacles.map(s=>new PoolSolidIndex(s));
  const distal:Record<string,typeof limbs[number]>={'Creator bare foot L':'footL','Creator bare foot R':'footR','Relaxed palm':'handL','Relaxed palm.001':'handR'};
  const layers=source.geometry.map((g,layer)=>{
    const parts=g.description.parts.map(p=>({...p,vertices:[...new Set(g.indices.subarray(p.start,p.start+p.count))]}));
    return {g,layer,parts};
  });
  const keys=plan.map(k=>k.unit).filter(u=>u>=from&&u<=end);
  const regrip=plan.find(k=>k.authoredUnit===64000)!.unit;
  const kneeCurve=keys.some(u=>programs.get(u)!.controls.slice(0,2).some(c=>c.state.kneeOrbit));
  const contacts=(a:PoolPoseProgram,b:PoolPoseProgram,t:number,u:number,all:boolean,report:(part:string,solid:PoolSolid,p:Vec3,exitY:number,exitX:number,axis:Vec3)=>void)=>{
    const phase=u/clock,policy=poolSourcePolicy(fixture,act,phase);
    const pose=interpolatePoolPoseProgram(bundle,neutral.rest,neutral.inverse,a,b,t,{action:act,phase}),skin=poolSkinMatrices(pose.world,neutral.inverse);
    for(const {g,layer,parts} of layers){
      const mesh=posedCageSurface(g,source.cages[layer],skin),p=(i:number):Vec3=>[mesh[i*3],mesh[i*3+1],mesh[i*3+2]];
      for(const part of parts){
       const reported=new Set<number>();
       const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
       for(const id of part.vertices)for(let axis=0;axis<3;axis++){
         min[axis]=Math.min(min[axis],mesh[id*3+axis]);max[axis]=Math.max(max[axis],mesh[id*3+axis]);
       }
       const limb=distal[part.name],held=limb&&policy[limb].required?policy[limb].surface:undefined;
       const independent=kneeCurve&&u<=regrip&&/^Creator bare leg [LR]$/.test(part.name);
       const candidates=obstacles.flatMap((s,j)=>s.id===held||independent&&j<2||[0,1,2].some(k=>max[k]<s.bounds[0][k]||min[k]>s.bounds[1][k])?[]:[j]);
       if(!candidates.length)continue;
       for(let i=part.start;i<part.start+part.count;i+=3){
        const id=[g.indices[i],g.indices[i+1],g.indices[i+2]];
        for(const j of candidates){
          if(!all&&reported.has(j))continue;const s=obstacles[j];
          if([0,1,2].some(k=>id.every(v=>mesh[v*3+k]<s.bounds[0][k])||id.every(v=>mesh[v*3+k]>s.bounds[1][k])))continue;
          const tri=id.map(p) as unknown as Triangle;
          const hits=tri.filter(q=>q.every((v,k)=>v>=s.bounds[0][k]&&v<=s.bounds[1][k])&&indices[j].inside(q));
          if(!hits.length||all){const h=indices[j].triangleWitness(tri);if(h)hits.push(h.point);}
          for(const hit of hits){
            const distance=all&&j<2?indices[j].exitAlong(hit,[0,1,0]):null;
            const side=j===0?1:-1,sideDistance=all&&j<2?indices[j].exitAlong(hit,[side,0,0]):null;
            report(part.name,s,hit,distance===null?s.bounds[1][1]:hit[1]+distance,
              sideDistance===null?s.bounds[j===0?1:0][0]:hit[0]+side*sideDistance,pos(pose.world[spine]));
            reported.add(j);if(!all)break;
          }
        }
      }
      }
    }
  };
  const guides=plan.filter(k=>[61000,62000,64000].includes(k.authoredUnit)).map(k=>k.unit);
  const release=keys.findIndex((u,i)=>i>0&&programs.get(keys[i-1])!.policy.handL.required&&!programs.get(u)!.policy.handL.required);
  if(release>=0){guides.push(keys[release]);if(release+1<keys.length)guides.push(keys[release+1]);}
  else if(motion.forwardHop.outerGripTransfer)guides.push(motion.forwardHop.outerGripTransfer.leftApproachUnit);
  const incident=keys.slice(0,-1);
  const refusals:string[]=[];
  let outwardAngle=0;
  const requiredTilts=new Map<number,number>();
  const turnRanges=new Map<number,[number,number][]>();
  const hipRanges=new Map<number,[number,number]>();
  const lastApproach=fixture.clips[act].samples.find(k=>k.phase===end/clock)!.limbs.footL.interval!;
  const approach=lastApproach[0]*clock;
  if(!(guides[0]>from&&guides.at(-1)!<approach))throw new Error('The upper climb guide lies outside the authored turn.');
  const envelope=(u:number)=>ease((u-from)/(guides[0]-from))*ease((approach-u)/(approach-guides.at(-1)!));
  const crossings=(poses:ReadonlyMap<number,PoolPoseProgram>,limit=Infinity,calibrate=false)=>{
    let count=0;
    for(const u of incident){const v=keys[keys.indexOf(u)+1],a=poses.get(u)!,b=poses.get(v)!;
      for(const t of [0,.25,.5,.75,...(v===end?[1]:[])]){
        const at=mix(u,v,t);
        const pairs=new Set<string>();
        try{contacts(a,b,t,at,calibrate,(part,solid,p,exitY,exitX,axis)=>{
          const key=part+'|'+solid.id;if(!pairs.has(key)){count++;pairs.add(key);}
          if(!calibrate||!rails.includes(solid)||!/bare hips|bare torso|upper arm|Forearm|pool /.test(part))return;
          const pivot=a.controls[1].state.target,w=envelope(at),y=p[1]-pivot[1],z=p[2]-pivot[2],r=Math.hypot(y,z);
          const desired=(exitY+margin-pivot[1])/r;
          if(w>0&&z>0&&desired<=1){
            const needed=Math.max(0,Math.atan2(z,y)-Math.acos(clamp(desired,-1,1)));
            for(const key of [u,v])if(key>from&&key<approach)requiredTilts.set(key,Math.max(requiredTilts.get(key)??0,needed));
            outwardAngle=Math.max(outwardAngle,needed);
          }
          if((/torso|upper arm|Forearm|top|strap/.test(part))&&w>0){
            const side=solid===rails[0]?1:-1,x=p[0]-axis[0],y=p[1]-axis[1];
            for(const key of [u,v])if(key>from&&key<approach){
              const ranges=turnRanges.get(key)??[[-Math.PI/3,Math.PI/3] as [number,number]];
              turnRanges.set(key,poolAngularHalfPlane(ranges,-side*x,side*y,side*(axis[0]-exitX)-margin));
            }
          }
          if(/bare hips|pool .*waist/.test(part)&&w>0){
            const side=solid===rails[0]?1:-1,dx=exitX+side*margin-p[0];
            for(const key of [u,v])if(key>from&&key<approach){
              const range=hipRanges.get(key)??[-Infinity,Infinity];
              hipRanges.set(key,side===1?[Math.max(range[0],dx),range[1]]:[range[0],Math.min(range[1],dx)]);
            }
          }
        });}
        catch(error){if(!(error instanceof PoolTrialRefusal))throw error;refusals.push(error.message);count++;}
        if(count>=limit)return count;
      }
    }
    return count;
  };
  const original=crossings(programs,Infinity,true);
  if(!original)return {before:0,after:0};
  const options:{name:string;count:number;lowerBound:boolean}[]=[],reachCaps:{unit:number;wanted:number;used:number}[]=[];
  const reaches=limbs.map(l=>{const a=source.anatomy[l];return configuredPoolChainReach(neutral.rest,a.upper,a.lower,a.end);});
  const armVectors=(u:number)=>{
    const p=evaluatePoolPoseProgram(bundle,neutral.rest,neutral.inverse,programs.get(u)!,{action:act,phase:u/clock});
    return limbs.slice(2).map(l=>{const a=source.anatomy[l];return sub(pos(p.world[a.lower]),pos(p.world[a.upper]));});
  };
  const enterArm=armVectors(from),leaveArm=armVectors(approach);
  const guide=(i:number,u:number,s:Vec3)=>{
    const t=ease((u-from)/(approach-from)),a=enterArm[i-2],b=leaveArm[i-2];return add(s,add(a,scale(sub(b,a),t)));
  };
  const tucked=new Map(programs);
  for(const u of keys){
    if(u===from||u>=approach)continue;
    const node=programs.get(u)!,pose=stance(node);
    const controls=node.controls.map((c,i)=>{
      if(i<2)return c;
      const r=reaches[i],s=pos(pose.world[source.anatomy[limbs[i]].upper]);
      return {...c,state:{...c.state,pole:armGuide(s,c.state.target,guide(i,u,s),r.lengths[0],r.lengths[1],mid)}};
    });
    tucked.set(u,makePoolPoseProgram(node.preferenceBasis,controls,node.policy));
  }
  let best=programs,bestCount=original;
  const keep=(candidate:Map<number,PoolPoseProgram>,name:string)=>{
    const count=crossings(candidate,bestCount);options.push({name,count,lowerBound:count>=bestCount});
    if(count<bestCount){best=candidate;bestCount=count;}
  };
  keep(tucked,'tucked elbows');
  const sweepGuide=(knots:Map<number,number>,u:number)=>{
    let a=from!,b=approach;
    for(const key of knots.keys()){if(key<=u&&key>a)a=key;if(key>=u&&key<b)b=key;}
    return a===b?(knots.get(a)??0):mix(knots.get(a)??0,knots.get(b)??0,ease((u-a)/(b-a)));
  };
  const turns=new Map<number,number>(),shifts=new Map<number,number>();
  for(const u of keys){
    const range=hipRanges.get(u);if(range&&range[0]<=range[1])shifts.set(u,clamp(0,range[0],range[1]));
    const ranges=turnRanges.get(u);if(!ranges?.length)continue;
    const angle=ranges.map(([lo,hi])=>clamp(0,lo+Math.min(.01,(hi-lo)/2),hi-Math.min(.01,(hi-lo)/2))).sort((a,b)=>Math.abs(a)-Math.abs(b))[0];
    turns.set(u,angle);
  }
  const finitePostTurn=(amount:number)=>{
    const candidate=new Map(programs);
    for(const u of keys){
      if(u<=from||u>=approach)continue;
      const node=programs.get(u)!,pose=stance(node),angle=amount*sweepGuide(turns,u),dx=amount*sweepGuide(shifts,u);
      if(!angle&&!dx)continue;
      const pivot=pos(pose.world[spine]),R=yaw(angle),delta:Vec3=[dx,0,0],carry=(v:Vec3)=>add(add(pivot,transform(R,sub(v,pivot))),delta);
      if(angle)setPoolWorldRotation(pose,spine,multiply(R,pose.world[spine]));
      if(dx)translatePoolRoot(pose,delta);
      const controls=node.controls.map((c,i)=>{
        const l=limbs[i],state=c.state,r=reaches[i],upper=pos(pose.world[source.anatomy[l].upper]);
        if(i>=2&&!node.policy[l].required&&node.policy[l].mode==='free'){
          return {...c,state:{...state,target:carry(state.target),pole:carry(state.pole),orientation:multiply(R,state.orientation)}};
        }
        if(!poolChainReachable(r,upper,state.target))throw new PoolTrialRefusal('The finite post turn cannot reach '+l+' at '+u);
        const pole=i<2?add(state.pole,delta):armGuide(upper,state.target,guide(i,u,upper),r.lengths[0],r.lengths[1],mid);
        return {...c,state:{...state,pole}};
      });
      candidate.set(u,makePoolPoseProgram(pose.basis,controls,node.policy));
    }
    return candidate;
  };
  if(turns.size||shifts.size)for(const amplitude of [1,.5]){
    if(!bestCount)break;
    try{keep(finitePostTurn(amplitude),'finite post twist '+amplitude);}catch(error){if(!(error instanceof PoolTrialRefusal))throw error;refusals.push(error.message);}
  }
  const clearancePitch=(amplitude:number)=>{
    const curve=new Map(programs);
    for(const u of keys){
      if(u<=from||u>=approach)continue;
      let tilt=0;
      for(const [key,needed] of requiredTilts){
        const fade=u<key?(u-from)/(key-from):(approach-u)/(approach-key);
        tilt=Math.max(tilt,needed*ease(fade));
      }
      tilt=Math.min(Math.PI/3,tilt)*amplitude;if(!tilt)continue;
      const node=programs.get(u)!,pose=stance(node),pivot=node.controls[1].state.target;
      const reachable=(angle:number)=>{
        const rotation=pitch(-angle);
        return node.controls.every((c,i)=>{
          const l=limbs[i];if(!node.policy[l].required)return true;
          const socket=add(pivot,transform(rotation,sub(pos(pose.world[source.anatomy[l].upper]),pivot)));
          return poolChainReachable(reaches[i],socket,c.state.target);
        });
      };
      if(!reachable(tilt)){
        let low=0,high=tilt;
        for(let i=0;i<14;i++){const mid=(low+high)/2;if(reachable(mid))low=mid;else high=mid;}
        reachCaps.push({unit:u,wanted:tilt,used:low});tilt=low;
      }
      const R=pitch(-tilt);
      const carry=(p:Vec3)=>add(pivot,transform(R,sub(p,pivot)));
      const goal=carry(pos(pose.world[hip]));
      setPoolWorldRotation(pose,hip,multiply(R,pose.world[hip]));translatePoolRoot(pose,sub(goal,pos(pose.world[hip])));
      const controls=node.controls.map((c,i)=>{
        const l=limbs[i],policy=node.policy[l],state=c.state,r=reaches[i],upper=pos(pose.world[source.anatomy[l].upper]);
        let target=state.target;
        if(!policy.required&&policy.mode==='free'){
          const q=carry(target);target=i<2?[q[0],Math.max(q[1],target[1]),Math.max(q[2],target[2])]:q;
        }
        if(!poolChainReachable(r,upper,target)){
          if(policy.required||i<2)throw new PoolTrialRefusal('Outward climb turn exceeds the installed reach at '+u+' '+l);
          const delta=sub(target,upper),d=length(delta);target=add(upper,scale(d>0?direction(delta):[0,0,-1],clamp(d,r.minimum+margin,r.maximum-margin)));
        }
        const pole=i<2?carry(state.pole):armGuide(upper,target,guide(i,u,upper),r.lengths[0],r.lengths[1],mid);
        return {...c,state:{...state,target,pole}};
      });
      curve.set(u,makePoolPoseProgram(pose.basis,controls,node.policy));
    }
    return curve;
  };
  if(outwardAngle>0)for(const amplitude of [1,.5]){
    if(!bestCount)break;
    try{keep(clearancePitch(amplitude),'outward tilt '+amplitude);}catch(error){if(!(error instanceof PoolTrialRefusal))throw error;refusals.push(error.message);}
  }
  function connected(rotate:boolean,amplitude:number){
    const fitted=new Map(programs);
    for(const u of keys){
      if(u===from||u>=approach)continue;
      const node=programs.get(u)!,pose=stance(node),old=pos(pose.world[hip]);
      const u01=(u-from!)/(end!-from!),turn=ease(u01),weight=amplitude*ease((u-from!)/(guides[0]-from!))*ease((approach-u)/(approach-guides.at(-1)!));
      const desiredHeading=h0+wrap(h1-h0)*turn,angle=rotate?wrap(desiredHeading-heading(pose.world))*weight:0;
      const shoulderTurn=wrap(s0+wrap(s1-s0)*turn-heading(pose.world,true))*weight;
      const originalSpine=pose.world[spine];
      if(angle!==0){
        setPoolWorldRotation(pose,hip,multiply(yaw(angle),pose.world[hip]));
        setPoolWorldRotation(pose,spine,multiply(yaw(shoulderTurn),originalSpine));
      }
      const spheres=limbs.flatMap((l,i)=>{
        if(i>1&&!node.policy[l].required)return [];
        return [{center:sub(node.controls[i].state.target,pos(pose.world[source.anatomy[l].upper])),radius:reaches[i].maximum-margin}];
      });
      const min=[0,1,2].map(k=>Math.max(...spheres.map(s=>s.center[k]-s.radius))) as unknown as Vec3;
      const max=[0,1,2].map(k=>Math.min(...spheres.map(s=>s.center[k]+s.radius))) as unknown as Vec3;
      const postEnd=Math.max(...rails.map(r=>r.bounds[1][1])),dry=finish.world[hip][13]-postEnd;
      const remainHigh=mix(z0,z1,ease(dry>0?(old[1]-postEnd)/dry:u01));
      const desired:Vec3=[weight*(mid-old[0]),0,weight*Math.max(0,remainHigh-old[2])];
      const centered=fitAssembly(desired,min,max,spheres);if(!centered)return;
      const assemble=(delta:Vec3)=>{
        const placed=poolIntervalPreference(bundle,neutral.rest,neutral.inverse,pose.basis,pose.basis,0,true);
        translatePoolRoot(placed,delta);
        const controls=node.controls.map((c,i)=>{
          const l=limbs[i],a=source.anatomy[l],r=reaches[i],s=pos(placed.world[a.upper]),state=c.state;
          let target=state.target;
          if(i>=2&&!node.policy[l].required){
            const v=sub(target,s),d=length(v);
            if(d>r.maximum-margin||d<r.minimum+margin)target=add(s,scale(d>0?direction(v):[0,0,-1],clamp(d,r.minimum+margin,r.maximum-margin)));
          }
          if(!poolChainReachable(r,s,target))throw new PoolTrialRefusal('The complete crest passage exceeds '+l+' reach at '+u);
          const pole=i<2?add(state.pole,delta):armGuide(s,target,guide(i,u,s),r.lengths[0],r.lengths[1],mid);
          return {...c,state:{...state,target,pole}};
        });
        return makePoolPoseProgram(placed.basis,controls,node.policy);
      };
      const body=assemble(centered),actual=evaluatePoolPoseProgram(bundle,neutral.rest,neutral.inverse,body,{action:act,phase:u/clock});
      const skin=poolSkinMatrices(actual.world,neutral.inverse);let dy=0;
      for(const {g,layer,parts} of layers){
        const waist=parts.filter(p=>/bare hips|bare torso|pool .*(waist|top)/.test(p.name));
        if(!waist.length)continue;
        const mesh=posedCageSurface(g,source.cages[layer],skin);
        for(const part of waist)for(const id of part.vertices){
          const i=id*3,x=mesh[i],y=mesh[i+1],z=mesh[i+2];
          const rail=x<lo?rails[0]:x>hi?rails[1]:undefined;
          if(rail&&y>=rail.bounds[0][1]-margin&&y<=rail.bounds[1][1]+margin&&z>=rail.bounds[0][2]&&z<=rail.bounds[1][2]+margin)
            dy=Math.max(dy,rail.bounds[1][1]+margin-y);
        }
      }
      const outside=dy?fitAssembly([desired[0],centered[1]+dy*weight,desired[2]],min,max,spheres):null;
      fitted.set(u,outside?assemble(outside):body);
    }
    return fitted;
  }
  for(const [rotate,amplitude] of [[false,1],[true,1],[true,.5]] as const){
    if(bestCount===0)break;
    let candidate:Map<number,PoolPoseProgram>|undefined;
    try{candidate=connected(rotate,amplitude);}
    catch(error){if(!(error instanceof PoolTrialRefusal))throw error;refusals.push(error.message);continue;}
    if(!candidate){refusals.push('No common pelvis translation for the installed supports.');continue;}
    try{keep(candidate,(rotate?'turn and center ':'center ')+amplitude);}catch(error){if(!(error instanceof PoolTrialRefusal))throw error;refusals.push(error.message);}
  }
  if(best!==programs)for(const [u,node] of best)programs.set(u,node);
  return {before:original,after:bestCount,outwardAngle,options,reachCaps,refusals};
}
