import {add,sub,scale,multiply,transform,type Vec3} from './math.js';
import {interpolateTransform} from './motion.js';
import {evaluatePoolPoseProgram,poolIntervalPreference,poolSkinMatrices} from './pool-contact-sample.js';
import {setPoolWorldRotation,translatePoolRoot} from './pool-canonical-pose.js';
import {makePoolPoseProgram,type PoolPoseProgram} from './pool-pose-program.js';
import {configuredPoolChainReach} from './pool-entry-domain.js';
import {poolSurfacePoint} from './pool-entry-anatomy.js';
import {poolSourcePolicy} from './pool-source-policy.js';
import {preparePoolSurfacePosition} from './pool-climb-out-fit.js';
import {posedCageSurface} from './geometry-proof.js';
import {aimOutwardKnee} from './pool-outward-calf.js';
import type {PoolCycleSource} from './pool-cycle-source.js';

const xyz=(m:readonly number[]):Vec3=>[m[12],m[13],m[14]];
const ease=(x:number)=>{const t=Math.max(0,Math.min(1,x));return t*t*(3-2*t);};
const mix=(a:Vec3,b:Vec3,t:number)=>add(a,scale(sub(b,a),t));
const yaw=(a:number)=>[Math.cos(a),Math.sin(a),0,0,-Math.sin(a),Math.cos(a),0,0,0,0,1,0,0,0,0,1];
const sides=['footL','footR','handL','handR'] as const;

/** Gather the kicking feet and tread upright before moving across the submerged ladder mouth. */
export function insetSwimApproach(source:PoolCycleSource,water:PoolPoseProgram,play:(u:number)=>number){
 const {neutral,bundle,definition}=source,act='pool_exit_0',hip=bundle.bones.findIndex(b=>b.name==='hips');
 const dry=source.entry(0),standing=poolIntervalPreference(bundle,neutral.rest,neutral.inverse,dry.preferenceBasis,dry.preferenceBasis,0,true);
 const wet=poolIntervalPreference(bundle,neutral.rest,neutral.inverse,water.preferenceBasis,water.preferenceBasis,0,true);
 const h0=xyz(wet.world[hip]),hs=xyz(standing.world[hip]);
 const shoulderHeight=(standing.world[source.anatomy.handL.upper][14]+standing.world[source.anatomy.handR.upper][14])/2-hs[2];
 const floor=source.fixture.solids.find(s=>s.kind==='floor')!,z=source.fixture.waterHeight-shoulderHeight+.045;
 const rail=source.fixture.rails[1].points[0].point,far=floor.bounds[0][1],farLane=far+(rail[1]-far)*.28;
 const radius=source.fixture.rails[0].radius;
 return (u:number)=>{
  if(u===10000)return water;
  const phase=play(u)/definition.clockUnits,up=ease((u-10000)/3500),angle=Math.PI*ease((u-11900)/6100),rot=yaw(angle);
  const p=poolIntervalPreference(bundle,neutral.rest,neutral.inverse,water.preferenceBasis,dry.preferenceBasis,up,true);
  if(angle)setPoolWorldRotation(p,hip,multiply(rot,p.world[hip]));
  // Cross the latter half of the basin while reaching for the ladder. The swimmer has
  // already turned upright before moving sideways past the bottom stringer.
  const across=ease((u-14500)/4500),away=ease((u-10000)/5100),wanted:Vec3=[
   h0[0]+(definition.ground.pelvisXY[0]-h0[0])*.55*across,h0[1]+(farLane-h0[1])*away,h0[2]+(z-h0[2])*up];
  translatePoolRoot(p,sub(wanted,xyz(p.world[hip])));
  const controls=water.controls.map((c,i)=>{
   const l=sides[i],s=c.state,joint=xyz(p.world[c.upper]),a=source.anatomy[l],sizes=configuredPoolChainReach(neutral.rest,a.upper,a.lower,a.end);
   const orientation=interpolateTransform(s.orientation,multiply(rot,dry.controls[i].state.orientation),up);
   let goal:Vec3;
   if(i<2){
    const above=Math.max(...a.surfaceCoefficients.map(k=>(floor.bounds[1][2]+3*radius-poolSurfacePoint(orientation,k)[2])/k[3]));
    const q=add(joint,transform(rot,[0,sizes.lengths[1]*.34,-sizes.lengths[1]*.65]));
    goal=[q[0],q[1],Math.max(above,q[2])];
   }else{
    const inward=(h0[0]-xyz(wet.world[c.upper])[0])*.36;
    goal=add(joint,transform(rot,[inward,-sizes.lengths[0]*.65,-sizes.lengths[0]*.48]));
   }
   const prior=add(wanted,transform(rot,sub(s.target,h0))),target=mix(prior,goal,up);
   const pole=add(joint,transform(rot,sub(dry.controls[i].state.pole,xyz(standing.world[c.upper]))));
   return {...c,state:{target,orientation,pole}};
  });
  const policy=poolSourcePolicy(source.fixture,act,phase),location={action:act,phase};let program=makePoolPoseProgram(p.basis,controls,policy);
  for(const [i,limb] of (['footL','footR'] as const).entries()){
   const socket=xyz(p.world[controls[i].upper]),reach=configuredPoolChainReach(neutral.rest,controls[i].upper,controls[i].lower,controls[i].end);
   const target=add(socket,transform(rot,[(i===0?-1:1)*.16*reach.lengths[0],-.75*reach.lengths[0],.05*reach.lengths[0]]));
   program=aimOutwardKnee(source,program,location,limb,target);
  }
  const skin=poolSkinMatrices(evaluatePoolPoseProgram(bundle,neutral.rest,neutral.inverse,program,location).world,neutral.inverse);
  const m=posedCageSurface(source.geometry[0],source.cages[0],skin);let minimum=Infinity;
  for(const part of source.geometry[0].description.parts.filter(s=>s.name.includes('bare leg')||s.name.includes('bare foot')))
   for(let i=part.start;i<part.start+part.count;i++)minimum=Math.min(minimum,m[3*source.geometry[0].indices[i]+2]);
  const first=source.fixture.solids.find(s=>s.id===definition.places.inside1.surface)!;
  const sill=floor.bounds[1][2]+(first.bounds[1][2]-floor.bounds[1][2])*ease((u-12000)/3500);
  const lift=Math.max(0,sill+radius-minimum);
  let base=wanted;
  if(lift){
   const offset:Vec3=[0,0,lift];translatePoolRoot(p,offset);base=add(wanted,offset);
   program=makePoolPoseProgram(p.basis,program.controls.map(c=>({...c,state:{...c.state,target:add(c.state.target,offset),pole:add(c.state.pole,offset)}})),policy);
  }
  const fitted=preparePoolSurfacePosition(source,program,base,location)(base,0),delta=sub(fitted,base);
  if(delta.every(v=>v===0))return program;
  translatePoolRoot(p,delta);
  return makePoolPoseProgram(p.basis,program.controls.map(c=>({...c,state:{...c.state,target:add(c.state.target,delta),pole:add(c.state.pole,delta)}})),policy);
 };
}
