import type {Geometry,MeshPart} from './bundle.js';
import {sameShape,shapePoint,snapshotShape,type ShapeParameters} from './shape.js';
import {add,multiply,multiplyInto,scale,transform,type Vec3} from './math.js';

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

interface SurfaceScratch {cage:Float32Array<ArrayBuffer>;out:Float32Array<ArrayBuffer>;skinning:Float64Array<ArrayBuffer>;ids:Uint32Array<ArrayBuffer>;weights:Float32Array<ArrayBuffer>}
interface ShapedCages {query:SurfaceQuery;shape:ShapeParameters;top:number;points:Float64Array<ArrayBuffer>}
const scratches=new WeakMap<Geometry,SurfaceScratch>();
const shapedCages=new WeakMap<Geometry,ShapedCages>();

/** The selected cages' shaped rest positions, kept while the body shape and top are unchanged. */
function shapedSelectedCages(geometry:Geometry,selected:SurfaceQuery,appearance:ShapeParameters,top:number):Float64Array<ArrayBuffer> {
  const saved=shapedCages.get(geometry);
  if(saved&&saved.query===selected&&saved.top===top&&sameShape(saved.shape,appearance))return saved.points;
  const points=new Float64Array(selected.cages.length*3),vertex=geometry.cage;
  selected.cages.forEach((id,j)=>{const at=id*16;points.set(shapePoint([vertex[at],vertex[at+1],vertex[at+2]],vertex[at+15],appearance,top),j*3);});
  shapedCages.set(geometry,{query:selected,shape:snapshotShape(appearance),top,points});return points;
}

/**
 * `queryConfiguredSurface` with a pose, for code that runs every frame. It
 * performs the same Float32 stores and accumulations in the same order, so
 * the selected vertices are bit-identical, but it writes into buffers reused
 * for this geometry. Only the selected vertices of the result are valid, and
 * only until the next call for the same geometry.
 */
export function configuredSurfaceScratch(geometry:Geometry,parts:readonly MeshPart[],appearance:ShapeParameters,top:number,
  pose:readonly (readonly number[])[],inverse:readonly (readonly number[])[]):Float32Array<ArrayBuffer> {
  const selected=query(geometry,parts),vertex=geometry.cage;
  let scratch=scratches.get(geometry);
  if(!scratch){
    scratch={cage:new Float32Array(geometry.description.cageCount*3),out:new Float32Array(geometry.description.vertexCount*3),skinning:new Float64Array(pose.length*16),
      ids:new Uint32Array(geometry.stencilWeights),weights:new Float32Array(geometry.stencilWeights)};
    scratches.set(geometry,scratch);
  }
  if(scratch.skinning.length<pose.length*16)scratch.skinning=new Float64Array(pose.length*16);
  const {cage,out,skinning,ids,weights}=scratch;
  for(let i=0;i<pose.length;i++)multiplyInto(skinning,pose[i],inverse[i],i*16);
  const shaped=shapedSelectedCages(geometry,selected,appearance,top);
  for(let j=0;j<selected.cages.length;j++){
    const id=selected.cages[j],at=id*16,p0=shaped[j*3],p1=shaped[j*3+1],p2=shaped[j*3+2];
    let x=p0,y=p1,z=p2;
    if(vertex[at+15]!==10){
      x=0;y=0;z=0;
      for(let k=0;k<4;k++){
        const weight=vertex[at+10+k];if(!weight)continue;
        const m=vertex[at+6+k]*16;
        x=x+(skinning[m]*p0+skinning[m+4]*p1+skinning[m+8]*p2+skinning[m+12])*weight;
        y=y+(skinning[m+1]*p0+skinning[m+5]*p1+skinning[m+9]*p2+skinning[m+13])*weight;
        z=z+(skinning[m+2]*p0+skinning[m+6]*p1+skinning[m+10]*p2+skinning[m+14])*weight;
      }
    }
    cage[id*3]=x;cage[id*3+1]=y;cage[id*3+2]=z;
  }
  for(const vertex of selected.vertices){
    const start=geometry.stencilRanges[vertex*4],count=geometry.stencilRanges[vertex*4+1];
    out[vertex*3]=0;out[vertex*3+1]=0;out[vertex*3+2]=0;
    for(let k=start;k<start+count;k++){const source=ids[k*2]*3,weight=weights[k*2+1];for(let axis=0;axis<3;axis++)out[vertex*3+axis]+=cage[source+axis]*weight;}
  }
  return out;
}
