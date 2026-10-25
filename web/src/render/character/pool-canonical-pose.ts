import type {Bundle,Geometry} from './bundle.js';
import {add,boneFrame,cross,dot,identity,inverseAffine,length,multiply,scale,solveLimb,sub,transform,unit,type Vec3} from './math.js';
import {sampleMotion} from './motion.js';
import {composeSkeletonPose,configuredRestSetup} from './pose-joints.js';
import type {ShapeParameters} from './shape.js';
import {poolSelectedVertices} from './pool-surface-coefficient.js';
import {registerPoolRestMatrix,registerPoolProperRotation,registerPoolRootTravel} from './pool-matrix-producer.js';

const position=(matrix:readonly number[]):Vec3=>[matrix[12],matrix[13],matrix[14]];
type SourceSample=Pick<ReturnType<typeof sampleMotion>,'basis'|'source'>;
export interface PoolHierarchy {
  bundle:Bundle;rest:number[][];inverse:number[][];basis:number[][];world:number[][];
}
export interface CanonicalPoolPose extends PoolHierarchy {
  source:SourceSample;rawTranslations:{bone:string;value:Vec3}[];positionDeviations:{bone:string;distance:number}[];
}

/** Gram-Schmidt keeps the source bone Y direction and projected X roll, with positive determinant. */
export function properPoolRotation(matrix:readonly number[]):number[] {
  if(matrix.length!==16||matrix.some(v=>!Number.isFinite(v)))throw new Error('Invalid pool rotation preference.');
  const a:Vec3=[matrix[0],matrix[1],matrix[2]],b:Vec3=[matrix[4],matrix[5],matrix[6]],c:Vec3=[matrix[8],matrix[9],matrix[10]];
  if(dot(cross(a,b),c)<=0)throw new Error('Pool rotation preference is degenerate or reflected.');
  const y=unit(b),x=unit(sub(a,scale(y,dot(a,y)))),z=cross(x,y);
  return registerPoolProperRotation([...x,0,...y,0,...z,0,0,0,0,1],matrix);
}

export function configuredPoolRestSetup(bundle:Bundle,shape:ShapeParameters,top:number){
  const setup=configuredRestSetup(bundle,shape,top);
  setup.rest.forEach((matrix,index)=>registerPoolRestMatrix(matrix,setup.heads[index],setup.tails[index],bundle.bones[index].rest));
  return setup;
}

const inactiveChecked=new WeakMap<Geometry,Set<number>>();
export function requireInactivePoolBone(geometry:readonly Geometry[],bone:number):void {
  for(const mesh of geometry){
    if(inactiveChecked.get(mesh)?.has(bone))continue;
    const indices=new Uint32Array(mesh.stencilWeights),weights=new Float32Array(mesh.stencilWeights);
    const vertices=poolSelectedVertices(mesh);
    for(const vertex of vertices){
      const start=mesh.stencilRanges[vertex*4],count=mesh.stencilRanges[vertex*4+1];
      for(let at=start;at<start+count;at++)for(let slot=0;slot<4;slot++){
        const cage=indices[at*2]*16;
        if(mesh.cage[cage+6+slot]===bone&&mesh.cage[cage+10+slot]*weights[at*2+1]!==0)
          throw new Error('Selected pool surface has effective influence from its inactive book bone.');
      }
    }
    const checked=inactiveChecked.get(mesh)??new Set<number>();checked.add(bone);inactiveChecked.set(mesh,checked);
  }
}

/** Source positions are preferences. Every candidate is a fixed configured hierarchy from birth. */
export function canonicalPoolSample(bundle:Bundle,shape:ShapeParameters,top:number,sample:SourceSample,geometry:readonly Geometry[]):CanonicalPoolPose {
  const {rest,inverse}=configuredPoolRestSetup(bundle,shape,top),root=bundle.bones.findIndex(b=>b.name==='root'),hips=bundle.bones.findIndex(b=>b.name==='hips'),book=bundle.bones.findIndex(b=>b.name==='book');
  if(root<0||hips<0||book<0||bundle.bones[hips].parent!==root)throw new Error('Pool source has no supported root, hips and book layout.');
  requireInactivePoolBone(geometry,book);
  const basis=sample.basis.map(properPoolRotation),rootWorld=properPoolRotation(sample.source[root]);
  const localHip=multiply(inverse[root],rest[hips]);
  rootWorld.splice(12,3,...sub(position(sample.source[hips]),transform(rootWorld,position(localHip))));
  const rootDelta=multiply(inverse[root],rootWorld),rootRotation=properPoolRotation(rootDelta);
  rootRotation.splice(12,3,...position(rootDelta));registerPoolRootTravel(rootRotation);basis[root]=rootRotation;
  basis[hips]=properPoolRotation(multiply(inverseAffine(localHip),multiply(inverseAffine(rootWorld),properPoolRotation(sample.source[hips]))));
  basis[book]=properPoolRotation(identity());
  const world=composeSkeletonPose(bundle.bones,rest,basis);
  return {bundle,rest,inverse,basis,world,source:sample,
    rawTranslations:sample.basis.map((matrix,i)=>({bone:bundle.bones[i].name,value:position(matrix)})),
    positionDeviations:world.map((matrix,i)=>({bone:bundle.bones[i].name,distance:length(sub(position(matrix),position(sample.source[i])))}))};
}

export function canonicalPoolPreference(bundle:Bundle,shape:ShapeParameters,top:number,action:string,frame:number,geometry:readonly Geometry[]):CanonicalPoolPose {
  return canonicalPoolSample(bundle,shape,top,sampleMotion(bundle,action,frame),geometry);
}

export function composePoolCandidate(candidate:PoolHierarchy):void {
  candidate.world=composeSkeletonPose(candidate.bundle.bones,candidate.rest,candidate.basis);
}

export function translatePoolRoot(candidate:PoolHierarchy,delta:Vec3):void {
  const root=candidate.bundle.bones.findIndex(b=>b.name==='root'),inverse=[...candidate.inverse[root]];inverse.splice(12,3,0,0,0);
  candidate.basis[root].splice(12,3,...add(position(candidate.basis[root]),transform(inverse,delta)));registerPoolRootTravel(candidate.basis[root]);composePoolCandidate(candidate);
}

/** Change a joint rotation, then recompose every descendant through its unchanged rest offset. */
export function setPoolWorldRotation(candidate:PoolHierarchy,bone:number,rotation:readonly number[]):void {
  const parent=candidate.bundle.bones[bone].parent;
  if(parent<0)throw new Error('Pool root rotation has its own travel authority.');
  const parentFrame=multiply(candidate.world[parent],multiply(candidate.inverse[parent],candidate.rest[bone]));
  candidate.basis[bone]=properPoolRotation(multiply(inverseAffine(parentFrame),rotation));composePoolCandidate(candidate);
}

/** Solve using actual configured child offsets, including their rest roll and non-Y components. */
export function solvePoolHierarchyLimb(candidate:PoolHierarchy,upper:number,lower:number,end:number,target:Vec3,pole:Vec3,orientation:readonly number[]):void {
  if(candidate.bundle.bones[lower].parent!==upper||candidate.bundle.bones[end].parent!==lower)throw new Error('Pool limb is not a connected configured chain.');
  const upperOffset=position(multiply(candidate.inverse[upper],candidate.rest[lower]));
  const lowerOffset=position(multiply(candidate.inverse[lower],candidate.rest[end]));
  const start=position(candidate.world[upper]),joint=solveLimb(start,target,length(upperOffset),length(lowerOffset),pole);
  const align=(bone:number,offset:Vec3,from:Vec3,to:Vec3)=>{
    const local=boneFrame([0,0,0],offset,identity()),preferred=multiply(candidate.world[bone],local);
    const world=multiply(boneFrame(from,to,preferred),inverseAffine(local));
    setPoolWorldRotation(candidate,bone,world);
  };
  align(upper,upperOffset,start,joint);align(lower,lowerOffset,position(candidate.world[lower]),target);
  setPoolWorldRotation(candidate,end,orientation);
}
