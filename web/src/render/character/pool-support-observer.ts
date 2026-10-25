import type {PoolFixtureV1,PoolSupport,PoolLimb} from './pool-contact-types.js';
import type {PreparedPoolPatch} from './pool-contact-patch.js';
import type {PoolObservation,PoolSurfaceInput} from './pool-observer.js';
import {derivePoolRailRegion} from './pool-rail-region.js';
import {projectedTrianglePatch,triangleDistance,type Triangle} from './pool-solid.js';
import {cross,sub,type Vec3} from './math.js';
import {poolObservationSource,requirePoolObservationSupport} from './pool-observer.js';
import {poolSourceSupport} from './pool-source-policy.js';
import {poolPatchProjectionStatus} from './pool-exact-projection.js';
import {poolSupportArithmeticBound,poolViolationsBeyondArithmetic,type PoolContactArithmetic} from './pool-support-arithmetic.js';

export interface PoolSupportResult {
  required:boolean;satisfied:boolean;surface:string|null;patchPart:string;
  projectedArea:number;coveredArea:number;minimumGap:number;arithmeticBound:number;
  reasons:string[];surfaceTriangles:number[];
}
const point=(points:Float32Array<ArrayBuffer>,id:number):Vec3=>[points[id*3],points[id*3+1],points[id*3+2]];
const area=(polygon:readonly Vec3[])=>{
  if(polygon.length<3)return 0;
  // Translate before products so small patches do not lose area to fixture coordinates.
  const origin=polygon[0];let result=0;
  for(let i=1;i+1<polygon.length;i++)result+=cross(sub(polygon[i],origin),sub(polygon[i+1],origin))[2]/2;
  return Math.abs(result);
};

export function poolSupportRequired(support:PoolSupport,phase:number):boolean {
  return support.mode==='support'||support.mode==='approach'&&phase===support.interval?.[1]
    ||support.mode==='release'&&phase===support.interval?.[0];
}

/** Independent finite-patch acceptance uses observed surfaces and actual fixture facets. */
export function observePoolPatchSupport(fixture:PoolFixtureV1,surfaces:readonly PoolSurfaceInput[],patch:PreparedPoolPatch,
  support:PoolSupport,phase:number,wholeBody:PoolObservation,arithmetic:readonly PoolContactArithmetic[]=[]):PoolSupportResult {
  const location=poolObservationSource(fixture,wholeBody);let required=poolSupportRequired(support,phase);
  if(location){
    if(location.phase!==phase)throw new Error('Pool support phase differs from its observed source context.');
    const owner=surfaces.find(surface=>surface.geometry.description.parts.some(part=>part.name===patch.part)),name=owner?.geometry.manifest.bones[patch.bone]?.name;
    const limb=(name?.startsWith('hand.')?'hand':name?.startsWith('foot.')?'foot':'')+name?.slice(-1) as PoolLimb;
    requirePoolObservationSupport(fixture,wholeBody,limb,support);required=poolSourceSupport(fixture,{...location,limb}).required;
  }
  const result:PoolSupportResult={required,satisfied:false,surface:support.surface,patchPart:patch.part,
    projectedArea:0,coveredArea:0,minimumGap:Infinity,arithmeticBound:0,reasons:[],surfaceTriangles:[]};
  if(!result.required){result.satisfied=poolViolationsBeyondArithmetic(wholeBody,arithmetic).length===0;return result;}
  const selected=surfaces.filter(({geometry})=>geometry.description.parts.some(part=>part.name===patch.part));
  if(selected.length!==1)throw new Error('Pool support patch must have exactly one selected surface owner.');
  const {geometry,points}=selected[0],part=geometry.description.parts.find(part=>part.name===patch.part)!;
  const consumedSurface={geometry,points};
  result.arithmeticBound=Math.max(0,...arithmetic.map(proof=>poolSupportArithmeticBound(proof,patch.part,support.surface??'',geometry,wholeBody,undefined,consumedSurface)));
  const bodyTriangles=patch.sourceTriangles.map(index=>{
    if(index*3<part.start||index*3+3>part.start+part.count)throw new Error('Pool support patch is outside its selected part.');
    return [0,1,2].map(offset=>point(points,geometry.indices[index*3+offset])) as unknown as Triangle;
  });
  // Exact admission until a producer supplies a proved operation envelope.
  // A small observed gap is still a lost contact at this boundary.
  const solid=fixture.solids.find(s=>s.id===support.surface),ground=fixture.ground.id===support.surface?fixture.ground:null;
  if(!solid&&!ground)throw new Error('Pool support names no fixture surface.');
  if(support.region?.kind==='rail'){
    if(!solid)throw new Error('Pool rail support has no evaluated solid.');
    const side=fixture.rails.findIndex(rail=>rail.id===support.surface)===0?1:-1;
    const region=derivePoolRailRegion(fixture,support.surface!,support.region.parameter,side);
    result.surfaceTriangles=[...region.triangles];
    for(const body of bodyTriangles)for(const index of region.triangles){
      const triangle=solid.triangles[index].map(id=>solid.vertices[id]) as unknown as Triangle;
      result.minimumGap=Math.min(result.minimumGap,triangleDistance(body,triangle));
    }
  }else if(support.region?.kind==='top-face'){
    const box=ground?.bounds;
    const faces:Triangle[]=box?[
      [[box[0][0],box[0][1],box[1][2]],[box[1][0],box[0][1],box[1][2]],[box[1][0],box[1][1],box[1][2]]],
      [[box[0][0],box[0][1],box[1][2]],[box[1][0],box[1][1],box[1][2]],[box[0][0],box[1][1],box[1][2]]],
    ]:(support.region.triangles??[]).map(index=>{
      const triangle=solid!.triangles[index];if(!triangle)throw new Error('Pool support names an invalid fixture triangle.');
      return triangle.map(id=>solid!.vertices[id]) as unknown as Triangle;
    });
    result.surfaceTriangles=[...(support.region.triangles??[])];
    for(const body of bodyTriangles){
      result.projectedArea+=area(body);
      for(const face of faces){
        const normal=cross(sub(face[1],face[0]),sub(face[2],face[0]));
        if(normal[2]<=0)throw new Error('Pool foot support must use upward fixture facets.');
        const polygon=projectedTrianglePatch(body,face);result.coveredArea+=area(polygon);
      }
    }
    const plane=faces[0]?.[0][2];
    if(plane===undefined||faces.some(face=>face.some(point=>point[2]!==plane)))throw new Error('Pool foot support requires its certified horizontal plane.');
    for(const vertex of bodyTriangles.flat())result.minimumGap=Math.min(result.minimumGap,vertex[2]-plane);
    const projection=poolPatchProjectionStatus(bodyTriangles,faces);
    if(result.projectedArea<=0||projection==='outside')result.reasons.push('finite patch leaves its support');
    else if(projection==='unsupported-union')result.reasons.push('finite patch support spans an unsupported facet union');
  }else result.reasons.push('support has no finite region');
  if(!Number.isFinite(result.minimumGap)||Math.abs(result.minimumGap)>result.arithmeticBound)result.reasons.push('support contact is lost');
  if(poolViolationsBeyondArithmetic(wholeBody,arithmetic).length)result.reasons.push('selected body intersects a fixture solid');
  result.satisfied=result.reasons.length===0;return result;
}
