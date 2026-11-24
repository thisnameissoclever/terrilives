import type {PoolSolid} from './pool-contact-types.js';
import type {PoolSurfaceInput} from './pool-observer.js';
import {projectedTrianglePatch,type Triangle} from './pool-solid.js';
import type {Vec3} from './math.js';

/** Includes boundary contact. A disjoint foot cannot use this tread as its supporting plane. */
export function poolFootOverlapsTread(body:PoolSurfaceInput,partName:string,tread:PoolSolid,faces:readonly number[]):boolean {
  const parts=body.geometry.description.parts.filter(p=>p.name===partName);
  if(parts.length!==1||!faces.length)throw new Error('A finite tread check needs its full selected foot and top facets.');
  const tops=faces.map(index=>{
    const face=tread.triangles[index];
    if(!face||face.some(id=>tread.vertices[id][2]!==tread.bounds[1][2]))throw new Error('Invalid finite tread top facet.');
    return face.map(id=>tread.vertices[id]) as unknown as Triangle;
  });
  const p=(id:number):Vec3=>[body.points[id*3],body.points[id*3+1],body.points[id*3+2]];
  const part=parts[0],indices=body.geometry.indices;
  for(let k=part.start;k<part.start+part.count;k+=3){
    const tri:Triangle=[p(indices[k]),p(indices[k+1]),p(indices[k+2])];
    if([0,1].some(axis=>tri.every(v=>v[axis]<tread.bounds[0][axis])||tri.every(v=>v[axis]>tread.bounds[1][axis])))continue;
    if(tops.some(face=>projectedTrianglePatch(tri,face).length>0))return true;
  }
  return false;
}
