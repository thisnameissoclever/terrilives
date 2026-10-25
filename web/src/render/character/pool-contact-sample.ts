import type {Bundle,Geometry} from './bundle.js';
import {canonicalPoolValue,poolPartKey,poolShapeIdentity} from './pool-contact-identity.js';
import {POOL_SOLVER_REVISION,POOL_INTERPOLATION_REVISION,type PoolContactArtifactV1,type PoolFixtureV1} from './pool-contact-types.js';
import {interpolateTransform} from './motion.js';
import {length,multiply,type Vec3} from './math.js';
import {composeSkeletonPose,configuredRestSetup} from './pose-joints.js';
import type {ShapeParameters} from './shape.js';
import {freezePoolContactArtifact} from './pool-contact-protocol.js';
import {samplePoolGraph} from './pool-motion-graph.js';
import {evaluatePoolLimb,resolvePoolLimbState,type PoolIntervalLimb} from './pool-contact-evaluator.js';
import {poolSourcePolicy,poolSourceEvents,requirePoolSourceSupport,requirePoolPolicyEqual,type PoolSourceLocation} from './pool-source-policy.js';
import {poolNodeProgramControls,poolIntervalProgramControls,type PoolPoseProgram} from './pool-pose-program.js';
import {properPoolRotation,solvePoolHierarchyLimb} from './pool-canonical-pose.js';
import {evaluatePoolOrientedLeg} from './pool-oriented-leg.js';
import {bindPoolRailGeometry,requirePoolRailGeometryPair} from './pool-rail-contact-frame.js';
import {preparePoolEntryAnatomy} from './pool-entry-anatomy.js';
import {shapeVertices} from './shape.js';
import {registerPoolRootTravel} from './pool-matrix-producer.js';

export class PoolContactNotReadyError extends Error {
  constructor(){super('Pool motion must be prepared before rendering this configuration.');this.name='PoolContactNotReadyError';}
}
interface Binding {rest:number[][];inverse:number[][];shapeKey:string}
const bindings=new WeakMap<Geometry,WeakMap<PoolContactArtifactV1,Binding>>();

/** Admission binds and checks physical identity before an actor may sample pool motion. */
export function bindPoolContacts(artifact:PoolContactArtifactV1,geometry:Geometry,shape:ShapeParameters,top:number,supplemental:readonly Geometry[],fixture:PoolFixtureV1):void {
  freezePoolContactArtifact(artifact);
  const shapeKey=poolShapeIdentity(shape,top);
  if(artifact.version!==1||artifact.solverRevision!==POOL_SOLVER_REVISION||artifact.revisions.interpolation!==POOL_INTERPOLATION_REVISION
      ||artifact.source!==geometry.manifest.sourceSha256||JSON.stringify(artifact.partKeys)!==JSON.stringify([geometry,...supplemental].map(poolPartKey))||artifact.shapeKey!==shapeKey||artifact.top!==top)throw new PoolContactNotReadyError();
  for(const track of [artifact.graph.entry,artifact.graph.paddle,...artifact.graph.bridges])for(const interval of track.intervals)for(const control of interval.controls){
    const bones=geometry.manifest.bones;
    if(bones[control.lower]?.parent!==control.upper||bones[control.end]?.parent!==control.lower)throw new PoolContactNotReadyError();
    if(control.legFrame){const side=bones[control.lower].name.slice(-1);
      if(bones[control.upper].name!=='thigh.'+side||bones[control.lower].name!=='shin.'+side||bones[control.end].name!=='foot.'+side||bones[bones[control.upper].parent]?.name!=='hips')throw new PoolContactNotReadyError();
    }
  }
  for(const track of [artifact.graph.entry,artifact.graph.paddle,...artifact.graph.bridges])for(const interval of track.intervals)for(const limb of interval.supportLimbs){
    const end=geometry.manifest.bones.findIndex(bone=>bone.name===(limb.startsWith('foot')?'foot.':'hand.')+limb.slice(-1));
    if(!interval.controls.some(control=>control.end===end&&(!limb.startsWith('foot')||control.legFrame==='source-entry-0')))throw new PoolContactNotReadyError();
  }
  for(const track of [artifact.graph.entry,artifact.graph.paddle,...artifact.graph.bridges])for(const interval of track.intervals)for(const observation of interval.observations)for(const contact of observation.arithmeticContacts){
    const part=geometry.description.parts.find(part=>part.name===contact.part);
    if(!part||!geometry.indices.subarray(part.start,part.start+part.count).includes(contact.activeVertex))throw new PoolContactNotReadyError();
  }
  const tracks=[{track:artifact.graph.entry,action:'pool_enter',scale:1},{track:artifact.graph.paddle,action:'pool_paddle',scale:1},...artifact.graph.bridges.map((track,origin)=>({track,action:'pool_exit_'+origin,scale:.1}))];
  const {rest,inverse}=configuredRestSetup(geometry.manifest,shape,top),attached=artifact.graph.poses.some(node=>node.controls.some(control=>control.state.attached));
  const anatomy=attached?preparePoolEntryAnatomy(geometry,shape,top):undefined,cage=attached?shapeVertices(geometry.cage,shape,top):undefined,bound=new WeakSet<object>();
  for(const {track,action,scale} of tracks){
    for(const key of track.keys){
      const node=artifact.graph.poses[key.pose],phase=fixture.clips[action].playback==='loop'&&key.phase===1?0:key.phase*scale;
      requirePoolPolicyEqual(node.policy,poolSourcePolicy(fixture,action,phase));
      const clip=fixture.clips[action],source=clip.samples.find(sample=>sample.phase===phase)?.limbs??clip.intervals.find(interval=>phase>=interval.start&&phase<interval.end)?.limbs;
      for(const limb of ['handL','handR'] as const){
        const end=geometry.manifest.bones.findIndex(bone=>bone.name==='hand.'+limb.slice(-1)),control=node.controls.find(control=>control.end===end),goal=control?.state.attached;
        if(node.policy[limb].required&&!goal)throw new PoolContactNotReadyError();
        if(!goal)continue;
        if(!source||!anatomy||!cage||node.policy[limb].mode==='free'||!node.policy[limb].required||goal.source.limb!==limb)throw new PoolContactNotReadyError();
        requirePoolSourceSupport(fixture,goal.source,goal.geometry.support);
        if(canonicalPoolValue({surface:goal.geometry.surface,region:goal.geometry.support.region})!==canonicalPoolValue({surface:source[limb].surface,region:source[limb].region}))throw new PoolContactNotReadyError();
        if(!bound.has(goal.geometry)){bindPoolRailGeometry(goal.geometry,fixture,source[limb],geometry,cage,inverse[end],anatomy[limb].patch,goal.source);bound.add(goal.geometry);}
        resolvePoolLimbState({...control!,from:control!.state,to:control!.state},0,{action,phase});
      }
    }
    for(const [index,interval] of track.intervals.entries()){
      const start=track.keys[index].phase*scale,end=track.keys[index+1].phase*scale;
      requirePoolPolicyEqual(interval.policy,poolSourcePolicy(fixture,action,(start+end)/2));
      for(const observation of interval.observations){
        const phase=observation.fraction===0?start:observation.fraction===1?end:start+(end-start)*observation.fraction;
        const declared=observation.fraction===0?artifact.graph.poses[track.keys[index].pose].policy:observation.fraction===1?artifact.graph.poses[track.keys[index+1].pose].policy:interval.policy;
        requirePoolPolicyEqual(declared,poolSourcePolicy(fixture,action,phase));
      }
      for(const event of poolSourceEvents(fixture,action))if(event>start&&event<end){
        try{requirePoolPolicyEqual(interval.policy,poolSourcePolicy(fixture,action,event));}
        catch{throw new Error('Pool source event requires an explicit graph cut.');}
      }
      for(const limb of ['handL','handR'] as const)if(interval.policy[limb].required){
        const end=geometry.manifest.bones.findIndex(bone=>bone.name==='hand.'+limb.slice(-1)),control=interval.controls.find(control=>control.end===end);
        const from=control?.from.attached,to=control?.to.attached;
        if(!from||!to||from.activeVertex!==to.activeVertex)throw new PoolContactNotReadyError();
        requirePoolRailGeometryPair(from.geometry,to.geometry);
      }
      for(const source of fixture.clips[action].intervals){const low=Math.max(start,source.start),high=Math.min(end,source.end);
        if(low<high)requirePoolPolicyEqual(interval.policy,poolSourcePolicy(fixture,action,(low+high)/2));
      }
    }
  }
  let owners=bindings.get(geometry);if(!owners){owners=new WeakMap();bindings.set(geometry,owners);}if(owners.has(artifact))return;
  owners.set(artifact,{rest,inverse,shapeKey});
}

/** Required prepared trajectories only. No geometry search or fit occurs in sampling. */
export function requirePoolPose(artifact:PoolContactArtifactV1|undefined,geometry:Geometry,shape:ShapeParameters,top:number,action:string,frame:number,reducedMotion=false):Float32Array<ArrayBuffer> {
  if(!artifact)throw new PoolContactNotReadyError();const binding=bindings.get(geometry)?.get(artifact);
  if(!binding||binding.shapeKey!==poolShapeIdentity(shape,top))throw new PoolContactNotReadyError();
  const count=geometry.manifest.actions[action]?.length;if(!count||!Number.isFinite(frame)||frame<0)throw new PoolContactNotReadyError();
  const mode=action==='pool_enter'?'entry':action==='pool_paddle'?'paddle':/^pool_exit_(?:[0-9]|1[01])$/.test(action)?'exit':null;
  if(!mode)throw new PoolContactNotReadyError();
  const phase=mode==='paddle'?(frame%count)/count:Math.min(1,frame/(count-1));
  const sample=samplePoolGraph(artifact.graph,mode,phase,mode==='exit'?Number(action.slice(10)):0,reducedMotion);
  const left=artifact.graph.poses[sample.left],right=artifact.graph.poses[sample.right];
  if(sample.left===sample.right)return poolSkinMatrices(evaluatePoolPoseProgram(geometry.manifest,binding.rest,binding.inverse,left,{action,phase}).world,binding.inverse);
  return poolSkinMatrices(interpolatePoolPoseProgram(geometry.manifest,binding.rest,binding.inverse,left,right,sample.amount,{action,phase}).world,binding.inverse);
}

export function poolSkinMatrices(world:readonly number[][],inverse:readonly number[][]):Float32Array<ArrayBuffer> {
  const output=new Float32Array(world.length*16);world.forEach((matrix,index)=>output.set(multiply(matrix,inverse[index]),index*16));return output;
}

/** The compiler's interval observer uses exactly the same bounded runtime evaluator. */
export function interpolatePoolPose(bundle:Bundle,rest:number[][],inverse:number[][],left:number[][],right:number[][],amount:number,controls:readonly PoolIntervalLimb[]=[]):Float32Array<ArrayBuffer> {
  const candidate=interpolatePoolHierarchy(bundle,rest,inverse,left,right,amount,controls);
  return poolSkinMatrices(candidate.world,inverse);
}

export function evaluatePoolPoseProgram(bundle:Bundle,rest:number[][],inverse:number[][],node:PoolPoseProgram,source?:PoolSourceLocation){
  return interpolatePoolHierarchy(bundle,rest,inverse,node.preferenceBasis,node.preferenceBasis,0,poolNodeProgramControls(node),source);
}

export function interpolatePoolPoseProgram(bundle:Bundle,rest:number[][],inverse:number[][],left:PoolPoseProgram,right:PoolPoseProgram,amount:number,source?:PoolSourceLocation){
  return interpolatePoolHierarchy(bundle,rest,inverse,left.preferenceBasis,right.preferenceBasis,amount,poolIntervalProgramControls(left,right),source);
}

/** Expose the actual supported evaluator hierarchy for preparation's frame observations. */
export function interpolatePoolHierarchy(bundle:Bundle,rest:number[][],inverse:number[][],left:number[][],right:number[][],amount:number,controls:readonly PoolIntervalLimb[]=[],source?:PoolSourceLocation){
  const oriented=controls.some(control=>control.legFrame==='source-entry-0');
  const candidate=poolIntervalPreference(bundle,rest,inverse,left,right,amount,oriented);
  const point=(matrix:readonly number[]):Vec3=>[matrix[12],matrix[13],matrix[14]];
  for(const control of controls){
    const {upper,lower,end,anchor}=control,{state:{orientation,pole,target}}=resolvePoolLimbState(control,amount,source);
    const lengths=[length(point(multiply(inverse[upper],rest[lower]))),length(point(multiply(inverse[lower],rest[end])))] as const;
    const prepared=evaluatePoolLimb({start:point(candidate.world[upper]),target,pole,lengths,orientation,anchor,
      upperReference:candidate.world[upper],lowerReference:candidate.world[lower]});
    if(control.legFrame)evaluatePoolOrientedLeg(candidate,upper,lower,end,prepared.end,orientation);
    else solvePoolHierarchyLimb(candidate,upper,lower,end,prepared.end,pole,orientation);
  }
  return candidate;
}

export function poolIntervalPreference(bundle:Bundle,rest:number[][],inverse:number[][],left:number[][],right:number[][],amount:number,oriented:boolean){
  const basis=left.map((matrix,index)=>{const value=matrix.every((entry,at)=>entry===right[index][at])?[...matrix]:interpolateTransform(matrix,right[index],amount);return oriented?properPoolRotationWithRoot(value,index):value;});
  return {bundle,rest,inverse,basis,world:composeSkeletonPose(bundle.bones,rest,basis)};
}

function properPoolRotationWithRoot(value:number[],bone:number){
  const matrix=properPoolRotation(value);
  if(bone===0){matrix.splice(12,3,...value.slice(12,15));registerPoolRootTravel(matrix);}return matrix;
}

