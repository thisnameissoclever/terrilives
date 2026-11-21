import type {Bundle,Geometry} from './bundle.js';
import type {PoolLimb} from './pool-contact-types.js';
import {POOL_LIMBS} from './pool-source-policy.js';

function validateMesh(geometry:Geometry,bundle:Bundle):void {
 const {vertexCount,indexCount,cageCount,coefficientCount}=geometry.description;
 if(![vertexCount,indexCount,cageCount,coefficientCount].every(count=>Number.isSafeInteger(count)&&count>0)
   ||!(geometry.vertices instanceof Float32Array)||!(geometry.cage instanceof Float32Array)||!(geometry.stencilWeights instanceof ArrayBuffer)
   ||![geometry.indices,geometry.stencilRanges,geometry.normalRanges,geometry.normalTriangles].every(view=>view instanceof Uint32Array)
   ||geometry.vertices.length!==vertexCount*16||geometry.indices.length!==indexCount||geometry.cage.length!==cageCount*16
   ||geometry.stencilRanges.length!==vertexCount*4||geometry.stencilWeights.byteLength!==coefficientCount*8
   ||geometry.normalRanges.length!==vertexCount*2||geometry.normalTriangles.length!==indexCount
   ||geometry.vertices.some(value=>!Number.isFinite(value))||geometry.cage.some(value=>!Number.isFinite(value))
   ||geometry.indices.some(vertex=>vertex>=vertexCount))throw new Error('Pool capture has invalid selected mesh buffers.');
 for(let at=0;at<geometry.cage.length;at+=16){
  if(geometry.cage[at+15]===10)continue;
  for(let slot=0;slot<4;slot++){
   const bone=geometry.cage[at+6+slot];
   if(!Number.isInteger(bone)||bone<0||bone>=bundle.bones.length)throw new Error('Pool capture cage references a missing skin matrix.');
  }
 }
 const ids=new Uint32Array(geometry.stencilWeights),weights=new Float32Array(geometry.stencilWeights);
 for(let at=0;at<ids.length;at+=2)if(ids[at]>=cageCount||!Number.isFinite(weights[at+1]))throw new Error('Pool capture has invalid stencil coefficients.');
 for(let vertex=0;vertex<vertexCount;vertex++){
  const at=vertex*4,start=geometry.stencilRanges[at],count=geometry.stencilRanges[at+1];
  if(!count||count>256||start+count>coefficientCount||geometry.stencilRanges[at+2]>=cageCount)throw new Error('Pool capture has an invalid stencil row.');
 }
}

export interface PoolOwnedPartPlan {
 readonly name:string;readonly start:number;readonly count:number;
 readonly indices:readonly number[];readonly vertices:readonly number[];
 readonly legacy:Readonly<Record<PoolLimb,readonly number[]>>;
}
export function prepareOwnedPoolMeshPlan(geometry:Geometry,bundle:Bundle,counters:{topologyTriangles:number}):readonly PoolOwnedPartPlan[] {
  validateMesh(geometry,bundle);
  const bones=POOL_LIMBS.map(limb=>geometry.manifest.bones.findIndex(bone=>bone.name===limb.slice(0,-1)+'.'+limb.at(-1)));
  const vertexOwnership=new Uint8Array(geometry.description.vertexCount);
  for(let vertex=0;vertex<vertexOwnership.length;vertex++)bones.forEach((bone,limb)=>{
   let weight=0;
   for(let slot=0;slot<4;slot++)if(geometry.vertices[vertex*16+6+slot]===bone)weight+=geometry.vertices[vertex*16+10+slot];
   if(weight>=.99)vertexOwnership[vertex]|=1<<limb;
  });
  return Object.freeze(geometry.description.parts.map(({name,start,count})=>{
   if(!Number.isInteger(start)||!Number.isInteger(count)||start<0||count<0||count%3||start+count>geometry.indices.length)throw new Error('Pool observation has an invalid selected triangle range.');
   const indices=Object.freeze(Array.from(geometry.indices.subarray(start,start+count))),vertices=Object.freeze([...new Set(indices)]);
   const offsets=POOL_LIMBS.map(()=>[] as number[]);
   for(let at=0;at<count;at+=3){
    const mask=vertexOwnership[indices[at]]&vertexOwnership[indices[at+1]]&vertexOwnership[indices[at+2]];
    offsets.forEach((selected,limb)=>{if(mask&(1<<limb))selected.push(at);});
   }
   counters.topologyTriangles+=count/3;
   const legacy=Object.freeze(Object.fromEntries(POOL_LIMBS.map((limb,index)=>[limb,Object.freeze(offsets[index])])) as Record<PoolLimb,readonly number[]>);
   return Object.freeze({name,start,count,indices,vertices,legacy});
  }));
 }

