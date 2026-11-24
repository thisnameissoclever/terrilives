import {add,sub,scale,length,unit,multiply,inverseAffine,transform,type Vec3} from './math.js';
import {interpolateTransform} from './motion.js';
import {poolIntervalPreference} from './pool-contact-sample.js';
import {makePoolPoseProgram,type PoolPoseProgram} from './pool-pose-program.js';
import {translatePoolRoot} from './pool-canonical-pose.js';
import {poolSourcePolicy} from './pool-source-policy.js';
import {configuredPoolChainReach,type PoolReachConstraint} from './pool-entry-domain.js';
import {poolSurfacePoint} from './pool-entry-anatomy.js';
import type {PoolCycleSource} from './pool-cycle-source.js';

const at=(m:readonly number[]):Vec3=>[m[12],m[13],m[14]];
const ease=(v:number)=>{v=Math.max(0,Math.min(1,v));return v*v*(3-2*v);};
const clip=(v:number)=>Math.max(0,Math.min(1,v));
const lerp=(a:Vec3,b:Vec3,t:number)=>add(a,scale(sub(b,a),t));
const rotate=(m:readonly number[])=>{const a=[...m];a.splice(12,3,0,0,0);return a;};
const names=['footL','footR','handL','handR'] as const;

/** A single pelvis path connects the actual two-level landing to the chosen departure. */
export function splitDeparture(source:PoolCycleSource,start:PoolPoseProgram,end:PoolPoseProgram,u:number,
 rootFit:(v:Vec3,c:PoolReachConstraint[])=>Vec3,up:number,forward:number){
 const {bundle,neutral}=source,hip=bundle.bones.findIndex(b=>b.name==='hips'),spine=bundle.bones.findIndex(b=>b.name==='spine');
 const frame=(a:PoolPoseProgram,b:PoolPoseProgram,t:number)=>poolIntervalPreference(bundle,neutral.rest,neutral.inverse,a.preferenceBasis,b.preferenceBasis,t,true);
 const old=frame(start,start,0),final=frame(end,end,0),turn=ease((u-44000)/10500),pose=frame(start,end,turn);
 const h0=at(old.world[hip]),h1=at(final.world[hip]),ph=u/100000,policy=poolSourcePolicy(source.fixture,'pool_enter',ph);
 const left=source.foot('footL','outside3'),crest=source.foot('footR','crest'),plate=source.fixture.solids.find(s=>s.id===crest.support.surface)!;
 const margin=source.fixture.rails[0].radius/4;
 const foot=start.controls[0].state,arrived=end.controls[0].state;
 const orientT=ease((u-50000)/6500);
 const orientation=orientT===0?foot.orientation:orientT===1?arrived.orientation:interpolateTransform([...foot.orientation],[...arrived.orientation],orientT);
 const rows=source.anatomy.footL.surfaceCoefficients.map(c=>({p:poolSurfacePoint(orientation,c),w:c[3]}));
 const outside=Math.max(foot.target[1],...rows.map(r=>(plate.bounds[1][1]+margin-r.p[1])/r.w));
 const above=Math.max(...rows.map(r=>(plate.bounds[1][2]+3*margin-r.p[2])/r.w));
 const pull=ease((u-44000)/3500),raise=ease((u-47500)/6000),advance=ease((u-53500)/6500);
 const ankle=lerp([foot.target[0],outside,above],arrived.target,advance);
 ankle[1]=u<=53500?foot.target[1]+(outside-foot.target[1])*pull:ankle[1];
 ankle[2]=u<=53500?left.target[2]+(Math.max(left.target[2]+left.lift/6,above)-left.target[2])*raise:
   Math.max(ankle[2],above*(1-advance)+arrived.target[2]*advance);
 const wantedFoot=u<=44000?foot.target:ankle;
 const tY=clip((u-47500)/12500),tZ=clip((u-44000)/16000);
 const hermite=(d:number,v:number,t:number)=>d*ease(t)+v*t*t*(t-1);
 const retreat=(outside-foot.target[1])*pull*(1-ease((u-47500)/6500));
 const requested:Vec3=[h0[0]+(h1[0]-h0[0])*ease(tY),
  h0[1]+hermite(h1[1]-h0[1],Math.max(forward*.25,3*(h1[1]-h0[1])),tY)+retreat,
  h0[2]+hermite(h1[2]-h0[2],Math.min(.32*up,3*Math.max(0,h1[2]-h0[2])),tZ)];
 const reach=names.map(l=>{const a=source.anatomy[l];return configuredPoolChainReach(neutral.rest,a.upper,a.lower,a.end);});
 const targets=[wantedFoot,crest.target,start.controls[2].state.target,start.controls[3].state.target];
 const constrained=names.flatMap((l,i)=>{
  if(i>=2&&!policy[l].required)return [];
  const r=reach[i],lengths=r.lengths;
  // A slight bend at a moving shoulder leaves room for the true interpolated arm arc.
  const maximum=i>=2&&u>44000?Math.sqrt(lengths[0]**2+lengths[1]**2+2*lengths[0]*lengths[1]*Math.cos(Math.PI/30)):r.maximum;
  return [{limb:l,reach:{...r,maximum},center:sub(targets[i],at(pose.world[start.controls[i].upper]))}];
 });
 translatePoolRoot(pose,rootFit(sub(requested,at(pose.world[hip])),constrained));
 const current=rotate(pose.world[spine]),fromTo=multiply(current,inverseAffine(rotate(final.world[spine])));
 const commands=start.controls.map((c,i)=>{
  const s=c.state,l=names[i],shoulder=at(pose.world[c.upper]);
  if(i<2)return {...c,state:{target:targets[i],orientation:i===0&&u>44000?orientation:s.orientation,pole:add(s.pole,sub(shoulder,at(old.world[c.upper])))}};
  if(policy[l].required)return {...c,state:{...source.heldClimbWrist(i===2?'handL':'handR','pool_enter',ph,s),pole:add(s.pole,sub(shoulder,at(old.world[c.upper])))}};
  const other=end.controls[i].state,goal=add(shoulder,transform(fromTo,sub(other.target,at(final.world[c.upper]))));
  const tuck=ease((u-(i===2?44000:47000))/5000),desired=lerp(s.target,goal,tuck);
  const orient=interpolateTransform([...s.orientation],multiply(fromTo,other.orientation),tuck);
  const hand=source.anatomy[i===2?'handL':'handR'],r=source.fixture.rails[0].radius,coeff=hand.completeHandCoefficients!;
  const rails=source.fixture.rails.map(k=>source.fixture.solids.find(h=>k.id===h.id)!);
  const offsets=coeff.map(c=>({x:poolSurfacePoint(orient,c)[0],w:c[3]}));
  desired[0]=Math.max(Math.max(...offsets.map(o=>(rails[0].bounds[1][0]+margin*tuck-o.x)/o.w)),
   Math.min(Math.min(...offsets.map(o=>(rails[1].bounds[0][0]-margin*tuck-o.x)/o.w)),desired[0]));
  const line=sub(desired,shoulder),d=length(line),size=Math.max(reach[i].minimum+r,Math.min(reach[i].maximum-r,d));
  const target=d===size?desired:add(shoulder,scale(d>0?unit(line):[0,-1,0],size));
  const pole=lerp(add(s.pole,sub(shoulder,at(old.world[c.upper]))),add(shoulder,transform(fromTo,sub(other.pole,at(final.world[c.upper])))),tuck);
  return {...c,state:{target,pole,orientation:orient}};
 });
 return makePoolPoseProgram(pose.basis,commands,policy);
}
