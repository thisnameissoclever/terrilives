import type {Geometry} from './bundle.js';
import {queryConfiguredSurface} from './surface-query.js';
import {type ShapeParameters} from './shape.js';
import {add,cross,dot,length,scale,sub,unit,type Vec3} from './math.js';

/** Candidate points lie on the upper surface of the configured, posed thigh. */
export function thighContactPatches(geometry:Geometry,appearance:ShapeParameters,top:number,pose:number[][],inverse:number[][]):[Vec3[],Vec3[]] {
  const parts=geometry.description.parts.filter(part=>part.name==='Creator bare leg L'||part.name==='Creator bare leg R');
  const surface=queryConfiguredSurface(geometry,parts,appearance,top,pose,inverse),point=(i:number):Vec3=>[surface[i*3],surface[i*3+1],surface[i*3+2]];
  return ['L','R'].map(side=>{
    const part=geometry.description.parts.find(part=>part.name==='Creator bare leg '+side);
    if(!part)throw new Error('Bath contact requires the configured bare thigh surface.');
    const bone=(name:string)=>pose[geometry.manifest.bones.findIndex(bone=>bone.name===name)];
    const hip=bone('thigh.'+side).slice(12,15) as unknown as Vec3,knee=bone('shin.'+side).slice(12,15) as unknown as Vec3;
    const axis=sub(knee,hip),square=dot(axis,axis),points:Vec3[]=[];
    for(let at=part.start;at<part.start+part.count;at+=3){
      const a=point(geometry.indices[at]),b=point(geometry.indices[at+1]),c=point(geometry.indices[at+2]);
      const normal=cross(sub(b,a),sub(c,a));if(length(normal)<1e-10||unit(normal)[2]<.35)continue;
      const center=scale(add(add(a,b),c),1/3),fraction=dot(sub(center,hip),axis)/square;
      if(fraction>=.15&&fraction<=.75)points.push(center);
    }
    if(!points.length)throw new Error('No upper-thigh surface is available for the resting hand.');
    return points;
  }) as [Vec3[],Vec3[]];
}

export function nearestReachableContact(points:readonly Vec3[],preferred:Vec3,offset:Vec3,shoulder:Vec3,upper:number,lower:number):Vec3|null {
  let best:Vec3|null=null,distance=Infinity;
  for(const point of points){
    const reach=length(sub(sub(point,offset),shoulder));
    if(reach>=upper+lower-.001||reach<=Math.abs(upper-lower)+.001)continue;
    const score=length(sub(point,preferred));if(score<distance){distance=score;best=point;}
  }
  return best;
}
