import type {Bundle,Geometry} from './bundle.js';
import {properPoolRotation} from './pool-canonical-pose.js';
import type {PoolFixtureV1} from './pool-contact-types.js';
import type {PoolIntervalLimb} from './pool-contact-evaluator.js';
import {interpolatePoolPose} from './pool-contact-sample.js';
import {samplePoolTrack,type PoolGraphTrack} from './pool-motion-graph.js';
import {compilePoolPaddlePreference,type CompiledPoolPose} from './pool-pose-compiler.js';
import {composeSkeletonPose} from './pose-joints.js';
import {inverseAffine,type Vec3} from './math.js';
import {shapeVertices,type ShapeParameters} from './shape.js';
import {posedCageSurface} from './geometry-proof.js';
import {observePool,type PoolObservation} from './pool-observer.js';

export interface CompiledPoolPaddle {
  poses:CompiledPoolPose[];track:PoolGraphTrack;intervals:PoolIntervalLimb[][];
  observations:{phase:number;kind:'key'|'interior'|'boundary';airwayMinimum:number;surface:PoolObservation}[];
  boundaryTransforms:{interval:number;endpoint:number;maximumSkinDifference:number}[];
  continuousBound:false;
}
const point=(matrix:readonly number[]):Vec3=>[matrix[12],matrix[13],matrix[14]];

export function poolPaddleInterval(bundle:Bundle,left:CompiledPoolPose,right:CompiledPoolPose):PoolIntervalLimb[] {
  const a=composeSkeletonPose(bundle.bones,left.rest,left.basis),b=composeSkeletonPose(bundle.bones,right.rest,right.basis);
  return ['L','R'].map(side=>{
    const upper=bundle.bones.findIndex(b=>b.name==='thigh.'+side),lower=bundle.bones.findIndex(b=>b.name==='shin.'+side),end=bundle.bones.findIndex(b=>b.name==='foot.'+side);
    return {upper,lower,end,anchor:[0,0,0,1],from:{target:point(a[end]),pole:point(a[lower]),orientation:properPoolRotation(a[end])},
      to:{target:point(b[end]),pole:point(b[lower]),orientation:properPoolRotation(b[end])}};
  });
}

/** Exact shared keys bypass interval-dependent evaluation at joins. */
export function sampleCompiledPaddle(compiled:CompiledPoolPaddle,bundle:Bundle,phase:number):Float32Array<ArrayBuffer> {
  const key=samplePoolTrack(compiled.track,phase);
  if(key.left===key.right)return compiled.poses[key.left].skin.slice();
  const a=compiled.poses[key.left],b=compiled.poses[key.right];
  return interpolatePoolPose(bundle,a.rest,a.rest.map(inverseAffine),a.basis,b.basis,key.amount,compiled.intervals[key.interval]);
}

/** Assemble and observe the complete loop before it can join entry and native exit bridges. */
export function compilePoolPaddleTrack(bundle:Bundle,shape:ShapeParameters,top:number,geometry:readonly Geometry[],fixture:PoolFixtureV1):CompiledPoolPaddle {
  const floor=fixture.solids.find(s=>s.kind==='floor');if(!floor)throw new Error('Pool fixture has no basin floor.');
  const count=bundle.actions.pool_paddle.length;
  if(count!==12)throw new Error('Pool paddle no longer matches its twelve native exit origins.');
  const poses=Array.from({length:count},(_,frame)=>compilePoolPaddlePreference(bundle,shape,top,frame,geometry,fixture.waterHeight,floor.bounds[1][2]));
  const track={keys:[...poses.map((_,pose)=>({phase:pose/count,pose})),{phase:1,pose:0}]};
  const intervals=poses.map((pose,index)=>poolPaddleInterval(bundle,pose,poses[(index+1)%count]));
  const compiled:CompiledPoolPaddle={poses,track,intervals,observations:[],boundaryTransforms:[],continuousBound:false};
  const cages=geometry.map(g=>shapeVertices(g.cage,shape,top));
  const observe=(phase:number,skin:Float32Array<ArrayBuffer>,kind:'key'|'interior'|'boundary')=>{
    const surfaces=geometry.map((g,index)=>({geometry:g,points:posedCageSurface(g,cages[index],skin)}));
    const observation=observePool(fixture,surfaces),airway=observation.parts.filter(part=>/nose|smile/i.test(part.name));
    if(!airway.length)throw new Error('Pool trajectory has no selected airway surface.');
    compiled.observations.push({phase,kind,airwayMinimum:Math.min(...airway.map(part=>part.minimum[2])),surface:observation});
  };
  for(let sample=0;sample<count*2;sample++){
    const phase=sample/(count*2),skin=sampleCompiledPaddle(compiled,bundle,phase);
    observe(phase,skin,sample%2?'interior':'key');
  }
  for(let interval=0;interval<count;interval++)for(const endpoint of [0,1]){
    const a=poses[interval],b=poses[(interval+1)%count],amount=endpoint?1-Number.EPSILON:Number.EPSILON;
    const skin=interpolatePoolPose(bundle,a.rest,a.rest.map(inverseAffine),a.basis,b.basis,amount,intervals[interval]);
    const exact=endpoint?b.skin:a.skin;
    compiled.boundaryTransforms.push({interval,endpoint,maximumSkinDifference:Math.max(...skin.map((value,i)=>Math.abs(value-exact[i])))});
    observe((interval+amount)/count,skin,'boundary');
  }
  return compiled;
}
