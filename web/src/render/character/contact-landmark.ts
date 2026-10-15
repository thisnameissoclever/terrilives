import type {Bone} from './bundle.js';
import type {ContactLandmark} from './contact-types.js';
import {add,multiply,scale,transform,type Vec3} from './math.js';
import {shapePoint,type ShapeParameters} from './shape.js';

/** Evaluate exactly the same landmark in authored or configured rest space. */
export function evaluateContactLandmark(bones:readonly Bone[],landmark:ContactLandmark,pose:number[][],inverse:readonly number[][],
  appearance:ShapeParameters|undefined,top:number):Vec3 {
  const p=appearance?shapePoint(landmark.point,landmark.region,appearance,top):landmark.point;
  let result:Vec3=[0,0,0];
  for(const [name,weight] of landmark.weights){
    const id=bones.findIndex(bone=>bone.name===name);if(id<0)throw new Error(`Missing contact bone: ${name}`);
    result=add(result,scale(transform(multiply(pose[id],inverse[id]),p),weight));
  }
  return result;
}
