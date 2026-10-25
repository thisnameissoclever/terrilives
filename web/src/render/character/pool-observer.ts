import type {Geometry} from './bundle.js';
import type {PoolFixtureV1,PoolLimb,PoolSupport} from './pool-contact-types.js';
import {poolSourceRecord,requirePoolSourceSupport,type PoolSourceLocation} from './pool-source-policy.js';
import {canonicalPoolValue} from './pool-contact-identity.js';
import {PoolSolidIndex,PoolVertexIndex,projectedTrianglePatch,type Triangle} from './pool-solid.js';
import {cross,sub,type Vec3} from './math.js';

export interface PoolSurfaceInput {geometry:Geometry;points:Float32Array<ArrayBuffer>}
export interface PoolObserverProfile {fixtureIndex:number;vertexQueries:number;triangleQueries:number;supportQueries:number;total:number}
export interface PoolWitness {surface:string;point:Vec3|null;signedClearance:number;bodyVertex:number|null;bodyTriangle:number|null;surfaceTriangle:number;part?:string;
  clearanceKind?:'exterior-lower-bound';boundBox?:readonly [Vec3,Vec3]}
export interface PoolPartObservation {
  name:string;vertices:number;triangles:number;minimum:Vec3;maximum:Vec3;
  worstObserved:PoolWitness|null;penetratingVertices:number;crossingTriangles:number;
}
export interface PoolContactObservation {
  limb:PoolLimb;mode:PoolSupport['mode'];surface:string|null;patchVertices:number;
  projectedOverlap:number;minimumObservedGap:number|null;maximumObservedGap:number|null;
}
export interface PoolObservation {
  frame:'pool-local-metres';units:'metres';sign:'negative means inside a fixture solid';parts:PoolPartObservation[];
  contacts:PoolContactObservation[];violations:PoolWitness[];
  coverage:{allSelectedVertices:true;allSelectedTriangles:true;triangleDepth:'observed interior witnesses, not maximum penetration depth'};
}
const sourceObservations=new WeakMap<PoolObservation,{fixture:PoolFixtureV1;location:PoolSourceLocation;sourceKey:string}>();
interface ObservedPart {name:string;start:number;count:number;indices:Uint32Array<ArrayBuffer>}
interface ObservedSurface {geometry:Geometry;points:Float32Array<ArrayBuffer>;snapshot:Float32Array<ArrayBuffer>;vertexCount:number;parts:ObservedPart[];bones?:string[];ownership?:Float32Array<ArrayBuffer>}
interface ObservedWitness {row:ObservedSurface;part:ObservedPart;key:string}
const observedSurfaces=new WeakMap<PoolObservation,{fixture:PoolFixtureV1;fixtureKey:string;rows:ObservedSurface[];witnesses:WeakMap<PoolWitness,ObservedWitness>}>();
const fixtureKey=(fixture:Pick<PoolFixtureV1,'ground'|'solids'|'revisions'>)=>canonicalPoolValue({ground:fixture.ground,solids:fixture.solids,revisions:fixture.revisions});

/** Authenticate the actual evaluated array observed for this selected geometry. */
export function requirePoolObservedSurface(fixture:PoolFixtureV1,observation:PoolObservation,surface:PoolSurfaceInput,partName?:string):void {
  const owner=observedSurfaces.get(observation),row=owner?.rows.find(row=>row.geometry===surface.geometry&&row.points===surface.points);
  if(!owner||owner.fixture!==fixture||!row||row.snapshot.length!==surface.points.length||row.snapshot.some((value,at)=>value!==surface.points[at]))throw new Error('Pool arithmetic does not match the actual observed unchanged surface points.');
  const {geometry}=surface,parts=geometry.description.parts;
  if(owner.fixtureKey!==fixtureKey(fixture))throw new Error('Pool observation fixture differs from its actual acceleration source.');
  if(row.vertexCount!==geometry.description.vertexCount||row.parts.length!==parts.length||row.parts.some((part,at)=>part.name!==parts[at].name||part.start!==parts[at].start||part.count!==parts[at].count
      ||part.indices.some((vertex,index)=>vertex!==geometry.indices[part.start+index])))throw new Error('Pool observation selection or consumed topology changed.');
  if(partName!==undefined&&row.parts.filter(part=>part.name===partName).length!==1)throw new Error('Pool certificate requires one actual observed named part.');
  if(row.bones&&(row.bones.length!==geometry.manifest.bones.length||row.bones.some((name,at)=>name!==geometry.manifest.bones[at].name)))throw new Error('Pool observation diagnostic bone ownership changed.');
  if(row.ownership)for(const vertex of new Set(row.parts.flatMap(part=>Array.from(part.indices))))for(let slot=0;slot<8;slot++){
    if(row.ownership[vertex*8+slot]!==geometry.vertices[vertex*16+6+slot])throw new Error('Pool observation diagnostic vertex ownership changed.');
  }
}

/** Part names alone cannot distinguish independent selected surfaces or point arrays. */
export function poolObservationOwnsWitness(fixture:PoolFixtureV1,observation:PoolObservation,surface:PoolSurfaceInput,witness:PoolWitness):boolean {
  try{requirePoolObservedSurface(fixture,observation,surface,witness.part);}catch{return false;}
  const owner=observedSurfaces.get(observation)!,entry=owner.witnesses.get(witness);
  return Boolean(entry&&entry.row.geometry===surface.geometry&&entry.row.points===surface.points&&entry.part===entry.row.parts.filter(part=>part.name===witness.part)[0]&&entry.key===canonicalPoolValue(witness));
}

/** Own the actual source lookup with the observed surfaces, before contact classification. */
export function observePoolSource(fixture:PoolFixtureV1,surfaces:readonly PoolSurfaceInput[],location:PoolSourceLocation,profile?:PoolObserverProfile):PoolObservation {
  const record=poolSourceRecord(fixture,location),sourceKey=canonicalPoolValue(record),observation=observePool(fixture,surfaces,record.limbs,profile);
  sourceObservations.set(observation,{fixture,location:Object.freeze({action:location.action,phase:location.phase}),sourceKey});return observation;
}

export function poolObservationSource(fixture:PoolFixtureV1,observation:PoolObservation):PoolSourceLocation|undefined {
  const owner=sourceObservations.get(observation);if(!owner)return undefined;
  if(owner.fixture!==fixture||owner.sourceKey!==canonicalPoolValue(poolSourceRecord(fixture,owner.location)))throw new Error('Pool observation source context changed.');return owner.location;
}

export function requirePoolObservationSupport(fixture:PoolFixtureV1,observation:PoolObservation,limb:PoolLimb,support:PoolSupport):PoolSourceLocation {
  const location=poolObservationSource(fixture,observation);if(!location)throw new Error('Pool contact observation has no independently owned source context.');
  requirePoolSourceSupport(fixture,{...location,limb},support);return location;
}

const minimumWitness=(previous:PoolWitness|null,next:PoolWitness):PoolWitness=>!previous||next.signedClearance<previous.signedClearance?next:previous;
interface FixtureIndex {key:string;source:Pick<PoolFixtureV1,'ground'|'solids'|'revisions'>;items:PoolSolidIndex[]}
const indexCache=new WeakMap<PoolFixtureV1,FixtureIndex>();
const vertexCache=new WeakMap<Geometry,Map<string,PoolVertexIndex>>();
const point=(points:Float32Array<ArrayBuffer>,id:number):Vec3=>[points[id*3],points[id*3+1],points[id*3+2]];
const insideBounds=(p:Vec3,[low,high]:readonly [Vec3,Vec3])=>[0,1,2].every(axis=>p[axis]>=low[axis]&&p[axis]<=high[axis]);
function indices(fixture:PoolFixtureV1):FixtureIndex {
  const key=fixtureKey(fixture),found=indexCache.get(fixture);if(found?.key===key)return found;
  const source=structuredClone({ground:fixture.ground,solids:fixture.solids,revisions:fixture.revisions});
  if(fixtureKey(source)!==key)throw new Error('Pool fixture changed while capturing acceleration inputs.');
  const [low,high]=source.ground.bounds;
  const ground={id:source.ground.id,kind:'floor' as const,bounds:source.ground.bounds,
    vertices:[low,[high[0],low[1],high[2]],high,[low[0],high[1],high[2]]] as Vec3[],triangles:[[0,1,2],[0,2,3]] as [number,number,number][]};
  const record={key,source,items:[...source.solids,ground].map(s=>new PoolSolidIndex(s))};indexCache.set(fixture,record);return record;
}

/** Observe final selected surfaces. Fitter targets and contact reconstruction are not inputs. */
export function observePool(fixture:PoolFixtureV1,surfaces:readonly PoolSurfaceInput[],supports?:Record<PoolLimb,PoolSupport>,profile?:PoolObserverProfile):PoolObservation {
  const started=performance.now();
  const fixtureIndex=indices(fixture),solids=fixtureIndex.items,parts:PoolPartObservation[]=[],violations:PoolWitness[]=[];
  const rows:ObservedSurface[]=[],witnesses=new WeakMap<PoolWitness,ObservedWitness>();
  if(profile)Object.assign(profile,{fixtureIndex:performance.now()-started,vertexQueries:0,triangleQueries:0,supportQueries:0,total:0});
  for(const {geometry,points} of surfaces){
    if(points.length!==geometry.description.vertexCount*3||points.some(v=>!Number.isFinite(v)))throw new Error('Invalid evaluated pool body surface.');
    const row:ObservedSurface={geometry,points,snapshot:points.slice(),vertexCount:geometry.description.vertexCount,parts:geometry.description.parts.map(part=>{
      if(!Number.isInteger(part.start)||!Number.isInteger(part.count)||part.start<0||part.count<0||part.count%3||part.start+part.count>geometry.indices.length)throw new Error('Pool observation has an invalid selected triangle range.');
      return {name:part.name,start:part.start,count:part.count,indices:geometry.indices.slice(part.start,part.start+part.count)};
    })};rows.push(row);
    if(supports){
      row.bones=geometry.manifest.bones.map(bone=>bone.name);row.ownership=new Float32Array(row.vertexCount*8);
      for(const vertex of new Set(row.parts.flatMap(part=>Array.from(part.indices))))for(let slot=0;slot<8;slot++)row.ownership[vertex*8+slot]=geometry.vertices[vertex*16+6+slot];
    }
    for(const part of row.parts){
      const seen=new Set<number>(),minimum=[Infinity,Infinity,Infinity],maximum=[-Infinity,-Infinity,-Infinity];
      let worst:PoolWitness|null=null,crossingTriangles=0;
      const surfaceViolations=new Map<string,PoolWitness>(),vertexOrder=new Map<number,number>(),penetrating=new Set<number>();
      const rank=(witness:PoolWitness)=>witness.bodyVertex===null?seen.size+(witness.bodyTriangle??0):vertexOrder.get(witness.bodyVertex)!;
      const choose=(previous:PoolWitness|null,next:PoolWitness):PoolWitness=>!previous||next.signedClearance<previous.signedClearance
        ||next.signedClearance===previous.signedClearance&&(rank(next)<rank(previous)
          ||rank(next)===rank(previous)&&solids.findIndex(s=>s.solid.id===next.surface)<solids.findIndex(s=>s.solid.id===previous.surface))?next:previous;
      const recordViolation=(witness:PoolWitness)=>{if(witness.signedClearance<0){const previous=surfaceViolations.get(witness.surface);surfaceViolations.set(witness.surface,choose(previous??null,witness));}};
      let stageStarted=performance.now();
      const vertices=[];
      for(let at=0;at<part.count;at++){
        const id=part.indices[at];if(seen.has(id))continue;
        const p=point(row.snapshot,id),order=seen.size;seen.add(id);vertexOrder.set(id,order);vertices.push({id,rank:order,point:p});
        for(let axis=0;axis<3;axis++){minimum[axis]=Math.min(minimum[axis],p[axis]);maximum[axis]=Math.max(maximum[axis],p[axis]);}
      }
      let partIndices=vertexCache.get(geometry);if(!partIndices){partIndices=new Map();vertexCache.set(geometry,partIndices);}
      const partKey=part.name+':'+part.start+':'+part.count;
      let vertexIndex=partIndices.get(partKey);
      if(vertexIndex)vertexIndex.update(vertices);else{vertexIndex=new PoolVertexIndex(vertices);partIndices.set(partKey,vertexIndex);}
      for(const solid of solids){
        const scan=solid.scanVertices(vertexIndex,worst?.signedClearance??Infinity);if(!scan)continue;
        for(const id of scan.penetrating)penetrating.add(id);
        const witness:PoolWitness={surface:solid.solid.id,point:scan.point?.point??null,signedClearance:scan.distance,bodyVertex:scan.point?.id??null,bodyTriangle:null,surfaceTriangle:scan.triangle,
          ...(scan.exteriorBounds?{clearanceKind:'exterior-lower-bound' as const,boundBox:scan.exteriorBounds}:{})};
        worst=choose(worst,witness);recordViolation(witness);
      }
      if(profile)profile.vertexQueries+=performance.now()-stageStarted;
      stageStarted=performance.now();
      const crossingSolids=solids.filter(solid=>{
        const [low,high]=solid.solid.bounds;
        if(solid.solid.kind==='floor')return minimum[2]<high[2]&&[0,1].every(axis=>minimum[axis]<=high[axis]&&maximum[axis]>=low[axis]);
        return solid.boundaryOverlaps([minimum as unknown as Vec3,maximum as unknown as Vec3]);
      });
      for(let at=0;at<part.count&&crossingSolids.length;at+=3){
        const triangle=[0,1,2].map(offset=>point(row.snapshot,part.indices[at+offset])) as unknown as Triangle;let crossed=false;
        for(const solid of crossingSolids){const witness=solid.triangleWitness(triangle);if(!witness)continue;crossed=true;
          const result={surface:solid.solid.id,point:witness.point,signedClearance:witness.distance,bodyVertex:null,bodyTriangle:(part.start+at)/3,surfaceTriangle:witness.triangle};
          worst=choose(worst,result);recordViolation(result);}
        if(crossed)crossingTriangles++;
      }
      if(profile)profile.triangleQueries+=performance.now()-stageStarted;
      const result:PoolPartObservation={name:part.name,vertices:seen.size,triangles:part.count/3,minimum:minimum as unknown as Vec3,maximum:maximum as unknown as Vec3,
        worstObserved:worst,penetratingVertices:penetrating.size,crossingTriangles};parts.push(result);
      for(const witness of surfaceViolations.values()){const emitted={...witness,part:part.name};violations.push(emitted);witnesses.set(emitted,{row,part,key:canonicalPoolValue(emitted)});}
    }
  }
  const supportStarted=performance.now(),contacts=supports?observeSupports(fixtureIndex,rows,structuredClone(supports)):[];
  const observation:PoolObservation={frame:'pool-local-metres',units:'metres',sign:'negative means inside a fixture solid',parts,violations,
    contacts,coverage:{allSelectedVertices:true,allSelectedTriangles:true,triangleDepth:'observed interior witnesses, not maximum penetration depth'}};
  observedSurfaces.set(observation,{fixture,fixtureKey:fixtureIndex.key,rows,witnesses});
  if(profile){profile.supportQueries=performance.now()-supportStarted;profile.total=performance.now()-started;}
  return observation;
}

function observeSupports(index:FixtureIndex,surfaces:readonly ObservedSurface[],supports:Record<PoolLimb,PoolSupport>):PoolContactObservation[]{
  return (Object.entries(supports) as [PoolLimb,PoolSupport][]).map(([limb,support])=>{
    const output:PoolContactObservation={limb,mode:support.mode,surface:support.surface,patchVertices:0,projectedOverlap:0,minimumObservedGap:null,maximumObservedGap:null};
    if(support.mode==='free')return output;
    const solid=index.items.find(s=>s.solid.id===support.surface),ground=support.surface===index.source.ground.id?index.source.ground:null;
    if(!solid&&!ground)throw new Error('Pool contact names a missing surface: '+support.surface);
    const hand=limb.startsWith('hand'),boneName=(hand?'hand.':'foot.')+limb.at(-1),gaps:number[]=[];
    let minimumHandGap=Infinity;
    const box=ground?.bounds??solid!.solid.bounds;
    const topFaces:Triangle[]=hand?[]:ground?[
      [[box[0][0],box[0][1],box[1][2]],[box[1][0],box[0][1],box[1][2]],[box[1][0],box[1][1],box[1][2]]],
      [[box[0][0],box[0][1],box[1][2]],[box[1][0],box[1][1],box[1][2]],[box[0][0],box[1][1],box[1][2]]],
    ]:(support.region?.kind==='top-face'?support.region.triangles??[]:[]).map(index=>solid!.solid.triangles[index].map(id=>solid!.solid.vertices[id]) as unknown as Triangle);
    for(const row of surfaces){
      const bone=row.bones!.indexOf(boneName),seen=new Set<number>(),points=row.snapshot;
      const owned=(id:number)=>{let weight=0;for(let slot=0;slot<4;slot++)if(row.ownership![id*8+slot]===bone)weight+=row.ownership![id*8+4+slot];return weight>=.99;};
      for(const part of row.parts)for(let at=0;at<part.count;at+=3){
        const ids=[0,1,2].map(offset=>part.indices[at+offset]);if(!ids.every(owned))continue;
        const triangle=ids.map(id=>point(points,id)) as unknown as Triangle;
        for(const id of ids)if(!seen.has(id)){seen.add(id);output.patchVertices++;if(hand){const gap=solid!.nearest(point(points,id)).distance;gaps.push(gap);minimumHandGap=Math.min(minimumHandGap,gap);}}
        if(hand){if(minimumHandGap>0)minimumHandGap=solid!.minimumTriangleGap(triangle,minimumHandGap);continue;}
        if(cross(sub(triangle[1],triangle[0]),sub(triangle[2],triangle[0]))[2]>=0)continue;
        for(const face of topFaces){
          const polygon=projectedTrianglePatch(triangle,face);if(polygon.length<3)continue;
          let area=0;for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length];area+=a[0]*b[1]-a[1]*b[0];}
          output.projectedOverlap+=Math.abs(area)/2;
          const normal=cross(sub(face[1],face[0]),sub(face[2],face[0]));
          for(const p of polygon){const z=face[0][2]-(normal[0]*(p[0]-face[0][0])+normal[1]*(p[1]-face[0][1]))/normal[2];gaps.push(p[2]-z);}
        }
      }
    }
    if(gaps.length){output.minimumObservedGap=hand?minimumHandGap:Math.min(...gaps);output.maximumObservedGap=Math.max(...gaps);}
    return output;
  });
}

/** Independent height-band probe used by the observer's negative controls. */
export function poolPointClearance(fixture:PoolFixtureV1,p:Vec3):PoolWitness {
  let result:PoolWitness|null=null;
  for(const solid of indices(fixture).items){const c=solid.clearance(p);if(!result||c.distance<result.signedClearance)result={surface:solid.solid.id,point:p,signedClearance:c.distance,bodyVertex:null,bodyTriangle:null,surfaceTriangle:c.triangle};}
  if(!result)throw new Error('Pool fixture has no solids.');return result;
}

export function poolTriangleCrossing(fixture:PoolFixtureV1,triangle:Triangle):PoolWitness|null {
  let result:PoolWitness|null=null;
  for(const solid of indices(fixture).items){const witness=solid.triangleWitness(triangle);if(witness&&(!result||witness.distance<result.signedClearance))result={surface:solid.solid.id,point:witness.point,signedClearance:witness.distance,bodyVertex:null,bodyTriangle:0,surfaceTriangle:witness.triangle};}
  return result;
}
