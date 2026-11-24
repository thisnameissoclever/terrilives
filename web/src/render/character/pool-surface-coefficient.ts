import type {Geometry} from './bundle.js';
import {transform} from './math.js';

export type PoolSurfaceCoefficient=readonly [number,number,number,number];
const selections=new WeakMap<Geometry,ReadonlySet<number>>();

/** Immutable selected geometry may retain index data for parts that are not drawn. */
export function poolSelectedVertices(geometry:Geometry):ReadonlySet<number> {
  let found=selections.get(geometry);
  if(!found){found=new Set(geometry.description.parts.flatMap(part=>Array.from(geometry.indices.subarray(part.start,part.start+part.count))));selections.set(geometry,found);}
  return found;
}

/** Preserve the skin-then-subdivide equation as one rigid end-bone coefficient. */
export function rigidPoolSurfaceCoefficient(geometry:Geometry,shapedCage:Float32Array<ArrayBuffer>,inverseRest:readonly number[],bone:number,vertex:number):PoolSurfaceCoefficient|null {
  if(!Number.isInteger(vertex)||vertex<0||vertex>=geometry.description.vertexCount
      ||shapedCage.length!==geometry.description.cageCount*16)throw new Error('Invalid pool surface coefficient input.');
  if(!poolSelectedVertices(geometry).has(vertex))throw new Error('Pool contact vertex is outside the selected draw ranges.');
  const ids=new Uint32Array(geometry.stencilWeights),weights=new Float32Array(geometry.stencilWeights);
  const offset=geometry.stencilRanges[vertex*4],count=geometry.stencilRanges[vertex*4+1],result=[0,0,0,0];
  for(let row=offset;row<offset+count;row++){
    const cage=ids[row*2]*16,point=transform(inverseRest,[shapedCage[cage],shapedCage[cage+1],shapedCage[cage+2]]);
    for(let slot=0;slot<4;slot++){
      const weight=weights[row*2+1]*shapedCage[cage+10+slot];if(weight===0)continue;
      if(shapedCage[cage+6+slot]!==bone)return null;
      for(let axis=0;axis<3;axis++)result[axis]+=weight*point[axis];
      result[3]+=weight;
    }
  }
  return result[3]>0&&result.every(Number.isFinite)?result as unknown as PoolSurfaceCoefficient:null;
}
