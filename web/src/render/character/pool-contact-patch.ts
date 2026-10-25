import type {Geometry} from './bundle.js';
import {cross,inverseAffine,length,sub,type Vec3} from './math.js';
import {rigidPoolSurfaceCoefficient,type PoolSurfaceCoefficient} from './pool-surface-coefficient.js';

export interface PoolPatchRegion {part:string;triangles:readonly number[]}
export interface PreparedPoolPatch {
  readonly part:string;readonly bone:number;readonly sourceTriangles:readonly number[];
  readonly vertices:readonly {readonly id:number;readonly coefficient:PoolSurfaceCoefficient}[];
  readonly triangles:readonly (readonly [number,number,number])[];readonly area:number;
}

/** Resolve authored part-relative triangles before compilation; rendering receives coefficients only. */
export function preparePoolContactPatch(geometry:Geometry,cage:Float32Array<ArrayBuffer>,rest:number[][],boneName:string,region:PoolPatchRegion):PreparedPoolPatch {
  const parts=geometry.description.parts.filter(part=>part.name===region.part),bone=geometry.manifest.bones.findIndex(b=>b.name===boneName);
  if(parts.length!==1||bone<0||!rest[bone]||region.triangles.length<1||region.triangles.length>128
      ||new Set(region.triangles).size!==region.triangles.length)throw new Error('Invalid finite pool contact patch.');
  const part=parts[0],inverse=inverseAffine(rest[bone]),vertices:{id:number;coefficient:PoolSurfaceCoefficient}[]=[],ids=new Map<number,number>();
  const triangles:[number,number,number][]=[],sourceTriangles:number[]=[];
  for(const index of region.triangles){
    if(!Number.isInteger(index)||index<0||index*3>=part.count)throw new Error('Pool contact triangle is outside its named source part.');
    const at=part.start+index*3;sourceTriangles.push(at/3);
    const triangle=[0,1,2].map(offset=>{
      const id=geometry.indices[at+offset];let vertex=ids.get(id);
      if(vertex===undefined){
        const coefficient=rigidPoolSurfaceCoefficient(geometry,cage,inverse,bone,id);
        if(!coefficient)throw new Error('Pool contact patch is not rigid on its end bone.');
        vertex=vertices.length;ids.set(id,vertex);vertices.push({id,coefficient:Object.freeze([...coefficient]) as PoolSurfaceCoefficient});
      }
      return vertex;
    }) as [number,number,number];
    if(new Set(triangle).size!==3)throw new Error('Pool contact patch has a degenerate triangle.');
    triangles.push(triangle);
  }
  const points=vertices.map(({coefficient:c})=>{
    const coordinate=(axis:number)=>rest[bone][axis]*c[0]+rest[bone][4+axis]*c[1]+rest[bone][8+axis]*c[2]+rest[bone][12+axis]*c[3];
    return [coordinate(0),coordinate(1),coordinate(2)] as Vec3;
  });
  let area=0;for(const [a,b,c] of triangles)area+=length(cross(sub(points[b],points[a]),sub(points[c],points[a])))/2;
  if(!Number.isFinite(area)||area<=0)throw new Error('Pool contact patch has no finite surface area.');
  const visited=new Set([0]);
  for(let changed=true;changed;){
    changed=false;
    triangles.forEach((triangle,index)=>{
      if(!visited.has(index)&&[...visited].some(other=>triangle.filter(vertex=>triangles[other].includes(vertex)).length>=2)){
        visited.add(index);changed=true;
      }
    });
  }
  if(visited.size!==triangles.length)throw new Error('Pool contact patch must be connected through source edges.');
  return Object.freeze({part:region.part,bone,sourceTriangles:Object.freeze(sourceTriangles),
    vertices:Object.freeze(vertices.map(vertex=>Object.freeze(vertex))),triangles:Object.freeze(triangles.map(triangle=>Object.freeze(triangle))),area});
}
