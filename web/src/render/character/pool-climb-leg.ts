import {add,multiply,type Vec3} from './math.js';
import type {PoolCycleSource} from './pool-cycle-source.js';
import {makePoolPoseProgram,type PoolPoseProgram} from './pool-pose-program.js';
import {evaluatePoolPoseProgram,poolIntervalPreference,poolSkinMatrices} from './pool-contact-sample.js';
import {translatePoolRoot,setPoolWorldRotation} from './pool-canonical-pose.js';
import {posedCageSurface} from './geometry-proof.js';
import {configuredPoolChainReach,poolChainReachable} from './pool-entry-domain.js';
import {PoolSolidIndex,type Triangle} from './pool-solid.js';
import type {PoolSolid} from './pool-contact-types.js';
import {PoolTrialRefusal} from './pool-trial-work.js';
import {fitLoadedLegOrbit} from './pool-loaded-leg-orbit.js';
import {fitPoolKneeOrbit} from './pool-knee-orbit-fit.js';

interface Plane {part:string;solid:PoolSolid;axis:0|1|2;sign:1|-1}
interface Hit {rule:Plane;vertex:number;gap:number}
const point=(m:readonly number[]):Vec3=>[m[12],m[13],m[14]];
const indices=new WeakMap<PoolSolid,PoolSolidIndex>();
function index(s:PoolSolid){let found=indices.get(s);if(!found){found=new PoolSolidIndex(s);indices.set(s,found);}return found;}
const limits=(s:PoolSolid,p:Vec3)=>p.every((v,i)=>v>=s.bounds[0][i]&&v<=s.bounds[1][i]);

/** Fit the configured hips and swinging ankle against the actual evaluated knee and shin surfaces. */
export function fitClimbLeg(source:PoolCycleSource,initial:PoolPoseProgram,unit:number):PoolPoseProgram {
  const {fixture,definition}=source,policy=initial.policy;
  const solid=(s:string)=>fixture.solids.find(v=>v.id===s)!;
  const crest=solid(definition.places.crest.surface),third=solid(definition.places.inside3.surface);
  const rules:Plane[]=[];
  if(policy.footL.surface===definition.places.inside2.surface)
    rules.push({part:'Creator bare leg L',solid:third,axis:1,sign:-1});
  if(policy.footR.surface===crest.id){
    rules.push({part:'Creator bare leg R',solid:solid(fixture.rails[1].id),axis:0,sign:-1});
    if(!policy.footL.required&&policy.footR.required){
      const axis=initial.controls[0].state.target[2]>=crest.bounds[1][2]?2:1;
      rules.push({part:'Creator bare leg L',solid:crest,axis,sign:1},
        {part:'Creator bare foot L',solid:solid(definition.places.outside3.surface),axis:2,sign:1});
    }
  }
  if(!rules.length)return initial;
  const loc={action:'pool_exit_0',phase:unit/definition.clockUnits},g=source.geometry[0],margin=fixture.rails[0].radius/8;
  const parts=new Map(g.description.parts.map(v=>[v.name,v]));
  const skin=(p:PoolPoseProgram)=>{const pose=evaluatePoolPoseProgram(source.bundle,source.neutral.rest,source.neutral.inverse,p,loc);
    return posedCageSurface(g,source.cages[0],poolSkinMatrices(pose.world,source.neutral.inverse));};
  function witness(mesh:Float32Array,rule:Plane):Hit|undefined {
    const part=parts.get(rule.part)!,s=rule.solid,f=index(s);
    const bound=rule.sign>0?s.bounds[1][rule.axis]+margin:s.bounds[0][rule.axis]-margin;
    let hit:Hit|undefined;
    const p=(id:number):Vec3=>[mesh[id*3],mesh[id*3+1],mesh[id*3+2]];
    for(let i=part.start;i<part.start+part.count;i+=3){
      const ids=[g.indices[i],g.indices[i+1],g.indices[i+2]],tri=ids.map(p) as unknown as Triangle;
      if([0,1,2].some(j=>tri.every(v=>v[j]<s.bounds[0][j])||tri.every(v=>v[j]>s.bounds[1][j])))continue;
      if(!tri.some(v=>limits(s,v)&&f.inside(v))&&!f.triangleWitness(tri))continue;
      for(let j=0;j<3;j++){const gap=rule.sign*(bound-tri[j][rule.axis]);
        if(gap>0&&(!hit||gap>hit.gap))hit={rule,gap,vertex:ids[j]};
      }
    }
    return hit;
  }
  const find=(mesh:Float32Array)=>rules.flatMap(rule=>{const h=witness(mesh,rule);return h?[h]:[];});
  let current=initial,mesh=skin(initial),hits=find(mesh);
  let lastHingeRefusal:PoolTrialRefusal|undefined;
  if(!hits.length)return initial;
  if(policy.footR.required&&hits.some(h=>h.rule.part==='Creator bare leg R'&&h.rule.solid.id===fixture.rails[1].id)){
    const preferred=2*Math.atan(initial.controls[1].state.kneeOrbit??0);
    try{
      const swivel=fitPoolKneeOrbit(source,initial,loc,'footR',preferred);
      if(swivel.clear){
        const surface=skin(swivel.program);
        current=swivel.program;mesh=surface;hits=find(mesh);
        if(!hits.length)return current;
      }
    }catch(error){if(!(error instanceof PoolTrialRefusal))throw error;lastHingeRefusal=error;}
  }
  const hip=source.bundle.bones.findIndex(v=>v.name==='hips');
  const limbs=['footL','footR','handL','handR'] as const;
  const reaches=limbs.map(l=>{const a=source.anatomy[l];return configuredPoolChainReach(source.neutral.rest,a.upper,a.lower,a.end);});
  const stride=reaches[0].maximum,free=!policy.footL.required;
  function shifted(p:PoolPoseProgram,d:number[]){
    const pose=poolIntervalPreference(source.bundle,source.neutral.rest,source.neutral.inverse,p.preferenceBasis,p.preferenceBasis,0,true);
    const delta:Vec3=[d[0],d[1],d[2]],yaw=d[3]/stride,c=Math.cos(yaw),s=Math.sin(yaw);
    if(yaw)setPoolWorldRotation(pose,hip,multiply([c,s,0,0,-s,c,0,0,0,0,1,0,0,0,0,1],pose.world[hip]));
    translatePoolRoot(pose,delta);
    const controls=p.controls.map((control,i)=>{
      const a=source.anatomy[limbs[i]],state=control.state,goal=i===0&&free?add(state.target,[0,d[4],d[5]]):state.target;
      return {control,i,state,goal,start:point(pose.world[a.upper])};
    });
    if(controls.some(r=>!poolChainReachable(reaches[r.i],r.start,r.goal)))return;
    return makePoolPoseProgram(pose.basis,controls.map(({control,state,goal})=>({...control,state:{...state,target:goal,pole:add(state.pole,delta)}})),policy);
  }
  function evaluateTrial(d:number[]){
    const program=shifted(current,d);if(!program)return;
    try{return {program,surface:skin(program)};}
    catch(error){if(!(error instanceof PoolTrialRefusal))throw error;lastHingeRefusal=error;return;}
  }
  for(let iteration=0;iteration<6;iteration++){
    const epsilon=margin/2,delta=[0,0,0,0,0,0],gradients=hits.map(()=>new Array<number>(6).fill(0));
    for(let j=0;j<(free?6:4);j++){
      const d=[0,0,0,0,0,0];d[j]=epsilon;
      let trial=evaluateTrial(d);if(!trial){d[j]=-epsilon;trial=evaluateTrial(d);}if(!trial)continue;
      const {surface}=trial;
      hits.forEach((h,i)=>{const k=h.vertex*3+h.rule.axis;gradients[i][j]=h.rule.sign*(surface[k]-mesh[k])/d[j];});
    }
    for(let i=0;i<hits.length;i++){
      const g=gradients[i],dot=g.reduce((x,v,j)=>x+v*delta[j],0),den=g.reduce((x,v)=>x+v*v,0);
      if(den>0){const k=Math.max(0,hits[i].gap+margin-dot)/den;g.forEach((v,j)=>{delta[j]+=v*k;});}
    }
    const size=Math.hypot(...delta),cap=stride/5;
    if(size>cap)delta.forEach((v,j)=>{delta[j]=v*cap/size;});
    let accepted=false;
    const cost=hits.reduce((sum,h)=>sum+h.gap,0);
    for(const fraction of [1,.5,.25,.125]){
      const trial=evaluateTrial(delta.map(v=>v*fraction));if(!trial)continue;
      const {program:p,surface:candidate}=trial,next=find(candidate);if(!next.length)return p;
      if(next.reduce((sum,h)=>sum+h.gap,0)>=cost)continue;
      current=p;mesh=candidate;hits=next;accepted=true;break;
    }
    if(!accepted)break;
  }
  const orbitTrials:{start:string;angle:number;allowed:readonly (readonly number[])[];changed:boolean;remaining?:readonly string[]}[]=[];
  if(policy.footR.required&&!policy.footL.required&&!policy.handL.required&&!policy.handR.required&&
    hits.some(h=>h.rule.part==='Creator bare leg R'&&h.rule.solid.id===fixture.rails[1].id)){
    for(const node of new Set([initial,current])){
      try{
        const orbit=fitLoadedLegOrbit(source,node,loc,'footR');
        const remaining=orbit.changed?find(skin(orbit.program)):undefined;
        if(remaining?.length===0)return orbit.program;
        orbitTrials.push({start:node===initial?'authored':'adjusted',angle:orbit.angle,allowed:orbit.allowed,
          changed:orbit.changed,remaining:remaining?.map(h=>h.rule.solid.id)});
      }catch(error){if(!(error instanceof PoolTrialRefusal))throw error;lastHingeRefusal=error;}
    }
  }
  throw new PoolTrialRefusal('The configured climb leg cannot clear its tread or rail within the maintained reach constraints.',
    {cause:{unit,lastHingeRefusal:lastHingeRefusal?.message,orbitTrials,hits:hits.map(h=>({part:h.rule.part,solid:h.rule.solid.id,gap:h.gap,vertex:h.vertex}))}});
}
