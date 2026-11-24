import {add,sub,scale,unit,cross,dot,length,type Vec3} from './math.js';
import type {PoolCycleSource} from './pool-cycle-source.js';
import type {PoolPoseProgram} from './pool-pose-program.js';
import {makePoolPoseProgram} from './pool-pose-program.js';
import {evaluatePoolPoseProgram,poolIntervalPreference,poolSkinMatrices} from './pool-contact-sample.js';
import {posedCageSurface} from './geometry-proof.js';
import {PoolSolidIndex,type Triangle} from './pool-solid.js';
import {fitPoolFirstRungHips} from './pool-ground-grip.js';
import {configuredPoolChainReach} from './pool-entry-domain.js';
import {translatePoolRoot} from './pool-canonical-pose.js';
import {PoolTrialRefusal} from './pool-trial-work.js';

const point=(m:readonly number[]):Vec3=>[m[12],m[13],m[14]];

/** Clear the exterior shin at the rim while keeping the installed ankle and both rail attachments. */
export function fitExteriorLandingShin(source:PoolCycleSource,node:PoolPoseProgram,u:number):PoolPoseProgram{
 if(u<32000||u>42000)return node;
 const loc={action:'pool_enter',phase:u/source.definition.clockUnits},left=source.anatomy.footL,layer=source.geometry[0];
 const leg=layer.description.parts.find(p=>p.name==='Creator bare leg L')!;
 const plate=source.fixture.solids.find(s=>s.id===source.definition.places.crest.surface)!,solid=new PoolSolidIndex(plate);
 const nominal=evaluatePoolPoseProgram(source.bundle,source.neutral.rest,source.neutral.inverse,node,loc);
 function clearance(world:readonly number[][]){
  const mesh=posedCageSurface(layer,source.cages[0],poolSkinMatrices(world,source.neutral.inverse));
  const p=(id:number):Vec3=>[mesh[id*3],mesh[id*3+1],mesh[id*3+2]];
  let worst:Vec3|undefined;
  for(let k=leg.start;k<leg.start+leg.count;k+=3){
   const tri:Triangle=[p(layer.indices[k]),p(layer.indices[k+1]),p(layer.indices[k+2])];
   if([0,1,2].some(axis=>tri.every(v=>v[axis]<plate.bounds[0][axis])||tri.every(v=>v[axis]>plate.bounds[1][axis])))continue;
   const witness=solid.triangleWitness(tri)?.point??tri.find(v=>solid.clearance(v).distance<0);
   if(witness&&(!worst||witness[1]<worst[1]))worst=witness;
  }
  return worst;
 }
 const hit=clearance(nominal.world);if(!hit)return node;
 const hip=source.bundle.bones.findIndex(b=>b.name==='hips'),H=point(nominal.world[hip]);
 const joint=point(nominal.world[left.upper]),knee=point(nominal.world[left.lower]),ankle=node.controls[0].state.target;
 const axis=unit(cross(sub(joint,knee),sub(ankle,knee))),toward=cross(axis,sub(hit,ankle))[1];
 if(Math.abs(toward)<1e-7)throw new PoolTrialRefusal('The exterior shin has no sagittal clearance direction.');
 const goal=source.foot('footL','outside3'),others=['footR','handL','handR'] as const;
 const constraints=others.map((l,i)=>{
  const a=source.anatomy[l],c=node.controls[i+1];
  return {limb:l,center:sub(c.state.target,sub(point(nominal.world[a.upper]),H)),
   reach:configuredPoolChainReach(source.neutral.rest,a.upper,a.lower,a.end)};
 });
 const reach=configuredPoolChainReach(source.neutral.rest,left.upper,left.lower,left.end);
 const candidate=(angle:number)=>{
  const r=sub(knee,ankle),c=Math.cos(angle),s=Math.sin(angle);
  const guide=add(ankle,add(add(scale(r,c),scale(cross(axis,r),s)),scale(axis,dot(axis,r)*(1-c))));
  const anchored=fitPoolFirstRungHips(H,sub(guide,sub(joint,H)),reach.lengths[0],constraints),delta=sub(anchored,H);
  const pose=poolIntervalPreference(source.bundle,source.neutral.rest,source.neutral.inverse,node.preferenceBasis,node.preferenceBasis,0,true);
  translatePoolRoot(pose,delta);
  const next=makePoolPoseProgram(pose.basis,node.controls.map(a=>({...a,state:{...a.state,pole:add(a.state.pole,delta)}})),node.policy);
  const actual=evaluatePoolPoseProgram(source.bundle,source.neutral.rest,source.neutral.inverse,next,loc);
  if(length(sub(point(actual.world[left.end]),goal.target))>1e-8)throw new Error('The exterior shin fit moved the installed sole.');
  return {next,hit:clearance(actual.world)};
 };
 const margin=source.fixture.rails[0].radius/8;
 let magnitude=Math.atan2(plate.bounds[1][1]-hit[1]+2*margin,Math.abs(toward));
 for(let k=0;k<5&&magnitude<=Math.PI/6;k++,magnitude*=1.6){
  const result=candidate(magnitude*Math.sign(toward));if(!result.hit)return result.next;
 }
 throw new PoolTrialRefusal('The configured exterior shin still enters the crest.',{cause:{u,hit}});
}
