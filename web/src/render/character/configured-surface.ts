import type {Geometry} from './bundle.js';
import {shapePoint,type ShapeParameters} from './shape.js';
import {add,multiply,scale,transform,type Vec3} from './math.js';
import {evaluateSurface} from './surface.js';

/** Evaluate configured visible surfaces with the same skin-then-subdivide order as the GPU. */
export function configuredSurface(geometry:Geometry,appearance:ShapeParameters,top:number,pose:number[][],inverse:number[][]):Float32Array<ArrayBuffer> {
  const cage=new Float32Array(geometry.description.cageCount*3),skinning=pose.map((matrix,i)=>multiply(matrix,inverse[i]));
  for(let at=0;at<geometry.cage.length;at+=16){
    const vertex=geometry.cage,p=shapePoint([vertex[at],vertex[at+1],vertex[at+2]],vertex[at+15],appearance,top);
    let point:Vec3=[0,0,0];
    if(vertex[at+15]===10)point=p;
    else for(let k=0;k<4;k++)if(vertex[at+10+k])point=add(point,scale(transform(skinning[vertex[at+6+k]],p),vertex[at+10+k]));
    cage.set(point,at/16*3);
  }
  return evaluateSurface(geometry,cage);
}
