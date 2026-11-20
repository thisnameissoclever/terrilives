import type {PoolFixtureV1,PoolSupport,PoolLimb} from './pool-contact-types.js';
import type {PreparedPoolPatch} from './pool-contact-patch.js';
import type {PoolObservation,PoolSurfaceInput} from './pool-observer.js';
import {derivePoolRailRegion} from './pool-rail-region.js';
import {projectedTrianglePatch,triangleDistance,type Triangle} from './pool-solid.js';
import {cross,sub,type Vec3} from './math.js';
import {poolObservationSource,requirePoolObservationSupport,requirePoolObservedSurface} from './pool-observer.js';
import {poolSourceSupport} from './pool-source-policy.js';
import {poolPatchProjectionStatus} from './pool-exact-projection.js';
import {poolSupportArithmeticBound,poolViolationsBeyondArithmetic,type PoolContactArithmetic} from './pool-support-arithmetic.js';
import {poolOwnedObservationIdentity} from './pool-owned-compilation.js';

export interface PoolSupportResult {
  required:boolean;satisfied:boolean;surface:string|null;patchPart:string;
  projectedArea:number;coveredArea:number;minimumGap:number;arithmeticBound:number;
  reasons:string[];surfaceTriangles:number[];
}
export interface PoolPatchSupportRequest {patch:PreparedPoolPatch;support:PoolSupport;phase:number}
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

interface SupportFacets {readonly faces:readonly Triangle[];readonly indices:readonly number[]}
const ownedFacets=new WeakMap<PoolFixtureV1,WeakMap<PoolSupport,SupportFacets>>();

function supportFacets(fixture:PoolFixtureV1,support:PoolSupport,owned:boolean):SupportFacets {
  let cache=owned?ownedFacets.get(fixture):undefined;
  if(owned&&!cache){cache=new WeakMap();ownedFacets.set(fixture,cache);}
  const saved=cache?.get(support);if(saved)return saved;
  const solid=fixture.solids.find(s=>s.id===support.surface),ground=fixture.ground.id===support.surface?fixture.ground:null;
  if(!solid&&!ground)throw new Error('Pool support names no fixture surface.');
  let faces:Triangle[]=[],indices:readonly number[]=[];
  if(support.region?.kind==='rail'){
    if(!solid)throw new Error('Pool rail support has no evaluated solid.');
    const side=fixture.rails.findIndex(rail=>rail.id===support.surface)===0?1:-1;
    indices=derivePoolRailRegion(fixture,support.surface!,support.region.parameter,side).triangles;
    faces=indices.map(index=>solid.triangles[index].map(id=>solid.vertices[id]) as unknown as Triangle);
  }else if(support.region?.kind==='top-face'){
    const box=ground?.bounds;
    indices=support.region.triangles??[];
    faces=box?[
      [[box[0][0],box[0][1],box[1][2]],[box[1][0],box[0][1],box[1][2]],[box[1][0],box[1][1],box[1][2]]],
      [[box[0][0],box[0][1],box[1][2]],[box[1][0],box[1][1],box[1][2]],[box[0][0],box[1][1],box[1][2]]],
    ]:indices.map(index=>{
      const triangle=solid!.triangles[index];if(!triangle)throw new Error('Pool support names an invalid fixture triangle.');
      return triangle.map(id=>solid!.vertices[id]) as unknown as Triangle;
    });
  }
  const result={faces,indices};
  cache?.set(support,result);
  return result;
}

/** Independent finite-patch acceptance uses observed surfaces and actual fixture facets. */
function observePoolPatchSupportCore(fixture:PoolFixtureV1,surfaces:readonly PoolSurfaceInput[],patch:PreparedPoolPatch,
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
  if(!result.required)return result;
  const selected=surfaces.filter(({geometry})=>geometry.description.parts.some(part=>part.name===patch.part));
  if(selected.length!==1)throw new Error('Pool support patch must have exactly one selected surface owner.');
  const {geometry,points}=selected[0],part=geometry.description.parts.find(part=>part.name===patch.part)!;
  const consumedSurface={geometry,points};
  const owned=Boolean(poolOwnedObservationIdentity(fixture,wholeBody));
  if(owned)requirePoolObservedSurface(fixture,wholeBody,consumedSurface,patch.part);
  result.arithmeticBound=Math.max(0,...arithmetic.map(proof=>poolSupportArithmeticBound(proof,patch.part,support.surface??'',geometry,wholeBody,undefined,consumedSurface)));
  const bodyTriangles=patch.sourceTriangles.map(index=>{
    if(index*3<part.start||index*3+3>part.start+part.count)throw new Error('Pool support patch is outside its selected part.');
    return [0,1,2].map(offset=>point(points,geometry.indices[index*3+offset])) as unknown as Triangle;
  });
  // Exact admission until a producer supplies a proved operation envelope.
  // A small observed gap is still a lost contact at this boundary.
  const {faces,indices}=supportFacets(fixture,support,owned);
  if(support.region?.kind==='rail'){
    result.surfaceTriangles=[...indices];
    for(const body of bodyTriangles)for(const triangle of faces){
      result.minimumGap=Math.min(result.minimumGap,triangleDistance(body,triangle));
    }
  }else if(support.region?.kind==='top-face'){
    result.surfaceTriangles=[...indices];
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
  return result;
}

/** Admit the supplied patch requests against their actual observation and proofs. */
export function observePoolPatchSupports(fixture:PoolFixtureV1,surfaces:readonly PoolSurfaceInput[],requests:readonly PoolPatchSupportRequest[],
  wholeBody:PoolObservation,arithmetic:readonly PoolContactArithmetic[]=[]){
  const descriptors=requests.map(({patch,support,phase})=>({patch,support,phase}));
  const supports=descriptors.map(({patch,support,phase})=>observePoolPatchSupportCore(fixture,surfaces,patch,support,phase,wholeBody,arithmetic));
  const unresolved=poolViolationsBeyondArithmetic(wholeBody,arithmetic);
  for(const result of supports){
    if(result.required){if(unresolved.length)result.reasons.push('selected body intersects a fixture solid');result.satisfied=result.reasons.length===0;}
    else result.satisfied=unresolved.length===0;
  }
  return {supports,unresolved};
}

/** Single callers retain the same source, row, construction and witness authentication. */
export function observePoolPatchSupport(fixture:PoolFixtureV1,surfaces:readonly PoolSurfaceInput[],patch:PreparedPoolPatch,
  support:PoolSupport,phase:number,wholeBody:PoolObservation,arithmetic:readonly PoolContactArithmetic[]=[]):PoolSupportResult {
  return observePoolPatchSupports(fixture,surfaces,[{patch,support,phase}],wholeBody,arithmetic).supports[0];
}
