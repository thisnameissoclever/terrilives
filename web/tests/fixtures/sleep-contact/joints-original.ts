import type {Bone,Bundle} from '../../../src/render/character/bundle.js';
import {boneFrame,inverseAffine,multiply} from '../../../src/render/character/math.js';
import {shapePoint,type ShapeParameters} from '../../../src/render/character/shape.js';
import {sampleMotion} from '../../../src/render/character/motion.js';

function region(name:string):number {
  if(name==='root'||name==='book'||name.startsWith('prop:'))return 7;
  if(name==='head')return 1;
  if(name.startsWith('foot'))return 6;
  if(/arm|hand/.test(name))return 4;
  if(/hips|thigh|shin/.test(name))return 3;
  return 2;
}

export function composeSkeletonPose(bones:readonly Bone[],rest:readonly number[][],basis:readonly number[][]):number[][] {
  const inverse=rest.map(inverseAffine),poses:number[][]=[];
  for(let i=0;i<bones.length;i++){
    const parent=bones[i].parent;
    if(parent>=i||parent< -1)throw new Error('Skeleton must be in parent-first order');
    const local=parent<0?rest[i]:multiply(inverse[parent],rest[i]);
    const animated=multiply(local,basis[i]);
    poses.push(parent<0?animated:multiply(poses[parent],animated));
  }
  return poses;
}

/** Shared rest joints and sampled source transforms for rendering and contact preparation. */
export function configuredJointSetup(bundle:Bundle,a:ShapeParameters,action:string,frame:number,top:number){
  const sample=sampleMotion(bundle,action,frame),bones=bundle.bones;
  const heads=bones.map(b=>shapePoint(b.head,region(b.name),a,top));
  const tails=bones.map(b=>shapePoint(b.tail,b.name.startsWith('shin')?6:region(b.name),a,top));
  const rest=bones.map((b,i)=>boneFrame(heads[i],tails[i],b.rest));
  const inverse=rest.map(inverseAffine),matrices=composeSkeletonPose(bones,rest,sample.basis);
  return {sample,source:sample.source,heads,tails,rest,inverse,matrices};
}
