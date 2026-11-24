import type {Geometry} from './bundle.js';
import {configuredRestSetup} from './pose-joints.js';
import {shapeVertices,type ShapeParameters} from './shape.js';
import {posedCageSurface} from './geometry-proof.js';
import {identity,type Vec3} from './math.js';
import {preparePoolContactPatch,type PreparedPoolPatch} from './pool-contact-patch.js';
import {rigidPoolSurfaceCoefficient,type PoolSurfaceCoefficient} from './pool-surface-coefficient.js';
import type {PoolLimb} from './pool-contact-types.js';

export interface PoolLimbAnatomy {
  upper:number;lower:number;end:number;anchor:PoolSurfaceCoefficient;patch:PreparedPoolPatch;
  front?:PreparedPoolPatch;back?:PreparedPoolPatch;surfaceCoefficients:PoolSurfaceCoefficient[];
  thumb?:PoolSurfaceCoefficient;
  completeHandCoefficients?:PoolSurfaceCoefficient[];
}
export type PoolEntryAnatomy=Record<PoolLimb,PoolLimbAnatomy>;

export function poolSurfacePoint(matrix:readonly number[],coefficient:PoolSurfaceCoefficient):Vec3 {
  const at=(axis:number)=>matrix[axis]*coefficient[0]+matrix[4+axis]*coefficient[1]+matrix[8+axis]*coefficient[2]+matrix[12+axis]*coefficient[3];
  return [at(0),at(1),at(2)];
}

/** Patches are named selected skin regions, with anchors derived from their evaluated geometry. */
export function preparePoolEntryAnatomy(geometry:Geometry,shape:ShapeParameters,top:number):PoolEntryAnatomy {
  const {rest,inverse}=configuredRestSetup(geometry.manifest,shape,top),cage=shapeVertices(geometry.cage,shape,top);
  const neutral=new Float32Array(geometry.manifest.bones.length*16);
  geometry.manifest.bones.forEach((_,bone)=>neutral.set(identity(),bone*16));
  const points=posedCageSurface(geometry,cage,neutral),point=(id:number):Vec3=>[points[id*3],points[id*3+1],points[id*3+2]];
  const result={} as PoolEntryAnatomy;
  for(const side of ['L','R'] as const)for(const hand of [false,true]){
    const name:PoolLimb=(hand?'hand':'foot')+side as PoolLimb;
    const partName=hand?'Relaxed palm'+(side==='R'?'.001':''):'Creator bare foot '+side;
    const part=geometry.description.parts.find(part=>part.name===partName);
    if(!part)throw new Error('Pool body has no selected contact part: '+partName);
    const bone=(name:string)=>{const index=geometry.manifest.bones.findIndex(b=>b.name===name);if(index<0)throw new Error('Missing pool anatomy joint: '+name);return index;};
    const upper=bone((hand?'upper_arm.':'thigh.')+side),lower=bone((hand?'forearm.':'shin.')+side),end=bone((hand?'hand.':'foot.')+side);
    const vertices=[...new Set(geometry.indices.subarray(part.start,part.start+part.count))],axis=hand?1:2;
    const minimum=Math.min(...vertices.map(id=>point(id)[axis])),candidates=vertices.filter(id=>point(id)[axis]===minimum);
    const center=candidates.reduce((sum,id)=>sum.map((v,i)=>v+point(id)[i]/candidates.length),[0,0,0]);
    const distance=(id:number)=>Math.hypot(...point(id).map((v,i)=>v-center[i]));
    const anchorVertex=candidates.sort((a,b)=>distance(a)-distance(b)||a-b)[0];
    const triangles:number[]=[],front:number[]=[],back:number[]=[];
    for(let at=part.start;at<part.start+part.count;at+=3){
      const ids=Array.from(geometry.indices.subarray(at,at+3));if(!ids.includes(anchorVertex))continue;
      const index=(at-part.start)/3;triangles.push(index);
      if(ids.every(id=>point(id)[1]<=point(anchorVertex)[1]))front.push(index);
      if(ids.every(id=>point(id)[1]>=point(anchorVertex)[1]))back.push(index);
    }
    const coefficient=(vertex:number)=>{
      const value=rigidPoolSurfaceCoefficient(geometry,cage,inverse[end],end,vertex);
      if(!value)throw new Error('Selected pool contact part has non-rigid end-bone ownership: '+partName);
      return value;
    };
    const patch=preparePoolContactPatch(geometry,cage,rest,geometry.manifest.bones[end].name,{part:partName,triangles});
    let thumb:PoolSurfaceCoefficient|undefined,completeHandCoefficients:PoolSurfaceCoefficient[]|undefined;
    if(hand){
      const thumbPart=geometry.description.parts.find(part=>part.name==='Resting thumb'+(side==='R'?'.001':''));
      if(!thumbPart)throw new Error('Selected hand has no thumb geometry for grip roll.');
      const thumbVertices=[...new Set(geometry.indices.subarray(thumbPart.start,thumbPart.start+thumbPart.count))];
      const lowest=thumbVertices.sort((a,b)=>point(a)[1]-point(b)[1]||a-b)[0];thumb=coefficient(lowest);
      completeHandCoefficients=[...vertices,...thumbVertices].map(coefficient);
    }
    result[name]={upper,lower,end,anchor:coefficient(anchorVertex),patch,surfaceCoefficients:vertices.map(coefficient),thumb,completeHandCoefficients,
      ...(!hand?{front:preparePoolContactPatch(geometry,cage,rest,geometry.manifest.bones[end].name,{part:partName,triangles:front}),
        back:preparePoolContactPatch(geometry,cage,rest,geometry.manifest.bones[end].name,{part:partName,triangles:back})}:{})};
  }
  return result;
}
