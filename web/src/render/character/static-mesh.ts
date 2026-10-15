import type {Geometry,Material} from './bundle.js';
import {add,cross,sub,unit,type Vec3} from './math.js';
import {authoredOutline} from './authored-surfaces.js';

/** Append an owned fixture surface with identity subdivision and complete normal adjacency. */
export function appendStaticMesh(source:Geometry,name:string,points:readonly Vec3[],triangles:readonly (readonly [number,number,number])[],material:Material):Geometry {
  const outline=authoredOutline(name);
  const count=points.length,offset=source.description.vertexCount,cageOffset=source.description.cageCount;
  const vertices=new Float32Array(count*16),cage=new Float32Array(count*16),indices=new Uint32Array(triangles.flatMap(triangle=>triangle.map(id=>id+offset)));
  const incident=points.map(()=>[] as number[]),normals=points.map(()=>[0,0,0] as Vec3);
  triangles.forEach((triangle,id)=>{const normal=cross(sub(points[triangle[1]],points[triangle[0]]),sub(points[triangle[2]],points[triangle[0]]));
    for(const vertex of triangle){incident[vertex].push(id+source.description.indexCount/3);normals[vertex]=add(normals[vertex],normal);}});
  const ranges=new Uint32Array(count*4),weights=new ArrayBuffer(count*8),weightIds=new Uint32Array(weights),weightValues=new Float32Array(weights);
  const normalRanges=new Uint32Array(count*2),normalTriangles=new Uint32Array(incident.flat());let normalAt=source.normalTriangles.length;
  points.forEach((point,i)=>{
    vertices.set([...point,...unit(normals[i]),0,0,0,0,1,0,0,0,source.manifest.materials.length,10],i*16);cage.set(vertices.subarray(i*16,i*16+16),i*16);
    ranges.set([source.description.coefficientCount+i,1,cageOffset+i,1],i*4);weightIds[i*2]=cageOffset+i;weightValues[i*2+1]=1;
    normalRanges.set([normalAt,incident[i].length],i*2);normalAt+=incident[i].length;
  });
  const join=<T extends Float32Array<ArrayBuffer>|Uint32Array<ArrayBuffer>>(a:T,b:T):T=>{const Type=a.constructor as {new(length:number):T},out=new Type(a.length+b.length);out.set(a);out.set(b,a.length);return out;};
  return {fixtureGeometry:source.fixtureGeometry,manifest:{...source.manifest,materials:[...source.manifest.materials,material]},
    description:{vertexCount:offset+count,cageCount:cageOffset+count,indexCount:source.description.indexCount+indices.length,coefficientCount:source.description.coefficientCount+count,
      parts:[...source.description.parts,{name,start:source.description.indexCount,count:indices.length,region:10,outline}]},
    vertices:join(source.vertices,vertices),cage:join(source.cage,cage),indices:join(source.indices,indices),stencilRanges:join(source.stencilRanges,ranges),
    stencilWeights:join(new Uint32Array(source.stencilWeights),new Uint32Array(weights)).buffer,
    normalRanges:join(source.normalRanges,normalRanges),normalTriangles:join(source.normalTriangles,normalTriangles)};
}
