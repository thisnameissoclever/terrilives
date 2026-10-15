import type {Geometry,MeshPart} from './bundle.js';
import {shapePoint,type ShapeParameters} from './shape.js';
import {add,multiply,scale,transform,type Vec3} from './math.js';

interface SurfaceQuery {vertices:number[];cages:number[]}
const queries=new WeakMap<Geometry,Map<string,SurfaceQuery>>();
function query(geometry:Geometry,parts:readonly MeshPart[]):SurfaceQuery {
  let entries=queries.get(geometry);if(!entries){entries=new Map();queries.set(geometry,entries);}
  const key=parts.map(part=>part.start).join(','),saved=entries.get(key);if(saved)return saved;
  const selected=new Set<number>();
  for(const part of parts)for(let at=part.start;at<part.start+part.count;at++)selected.add(geometry.indices[at]);
  const vertices=[...selected].sort((a,b)=>a-b),cages=new Set<number>(),ids=new Uint32Array(geometry.stencilWeights);
  for(const vertex of vertices){const start=geometry.stencilRanges[vertex*4],count=geometry.stencilRanges[vertex*4+1];for(let k=start;k<start+count;k++)cages.add(ids[k*2]);}
  const result={vertices,cages:[...cages].sort((a,b)=>a-b)};entries.set(key,result);return result;
}

/** Sparse contacts preserve every Float32 store and coefficient accumulation in the full evaluator. */
export function queryConfiguredSurface(geometry:Geometry,parts:readonly MeshPart[],appearance:ShapeParameters,top:number,
  pose?:number[][],inverse?:number[][]):Float32Array<ArrayBuffer> {
  const selected=query(geometry,parts),cage=new Float32Array(geometry.description.cageCount*3);
  const skinning=pose?.map((matrix,i)=>multiply(matrix,inverse![i]));
  for(const id of selected.cages){
    const at=id*16,vertex=geometry.cage,p=shapePoint([vertex[at],vertex[at+1],vertex[at+2]],vertex[at+15],appearance,top);
    let point:Vec3=p;
    if(skinning&&vertex[at+15]!==10){point=[0,0,0];for(let k=0;k<4;k++)if(vertex[at+10+k])point=add(point,scale(transform(skinning[vertex[at+6+k]],p),vertex[at+10+k]));}
    cage.set(point,id*3);
  }
  const out=new Float32Array(geometry.description.vertexCount*3),ids=new Uint32Array(geometry.stencilWeights),weights=new Float32Array(geometry.stencilWeights);
  for(const vertex of selected.vertices){
    const start=geometry.stencilRanges[vertex*4],count=geometry.stencilRanges[vertex*4+1];
    for(let k=start;k<start+count;k++){const source=ids[k*2]*3,weight=weights[k*2+1];for(let axis=0;axis<3;axis++)out[vertex*3+axis]+=cage[source+axis]*weight;}
  }
  return out;
}
