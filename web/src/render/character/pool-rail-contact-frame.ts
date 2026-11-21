import {PoolTrialRefusal} from './pool-trial-work.js';
import type {Geometry} from './bundle.js';
import type {PreparedPoolPatch} from './pool-contact-patch.js';
import type {PoolFixtureV1,PoolSupport} from './pool-contact-types.js';
import {poolSourceSupport,requirePoolSourceSupport,type PoolSupportLocation} from './pool-source-policy.js';
import type {Vec3} from './math.js';
import {derivePoolRailRegion,type PoolRailEdge} from './pool-rail-region.js';
import {canonicalPoolValue,poolByteViewsEqual} from './pool-contact-identity.js';
import {countPoolOwnedWork,poolOwnedConfiguredIdentity,poolOwnedParts,poolOwnedStaticIdentity} from './pool-owned-compilation.js';
import {poolExact as number,poolExactAdd as add,poolExactSubtract as sub,poolExactMultiply as mul,poolExactCompare as compare,
  poolRatioCompare,poolRatioNumber,poolRatioRoundingError,type PoolDyadic,type PoolRatio} from './pool-exact-number.js';

export interface PoolRailContactFrame {
  readonly part:string;readonly bone:number;readonly surface:string;readonly side:1|-1;readonly planeX:number;
  readonly orientation:readonly number[];readonly orientationError:readonly number[];readonly rotationQuaternion:readonly number[];
  readonly translation:Vec3;readonly translationError:Vec3;readonly activeVertex:number;readonly patchVertices:readonly number[];
  readonly edge:PoolRailEdge;readonly edgeAmount:number;readonly incidentFacets:readonly number[];
  readonly targetPoint:Vec3;readonly targetPointError:Vec3;readonly vertexCount:number;
  readonly exactEdgePoint:readonly {numerator:string;exponent:number}[];
  readonly exactTranslation:readonly {numerator:string;denominator:string;exponent:number}[];
}
export interface PoolPreparedRailGeometry {
  readonly version:'pool-rail-goal-v1';readonly part:string;readonly bone:number;readonly surface:string;readonly side:1|-1;readonly planeX:number;
  readonly sourceKey:string;readonly support:PoolSupport;readonly inverse:readonly number[];readonly patch:PreparedPoolPatch;
  readonly vertices:readonly number[];readonly coefficients:readonly (readonly {numerator:string;exponent:number}[])[];
  readonly edges:readonly {readonly edge:PoolRailEdge;readonly from:Vec3;readonly to:Vec3;readonly incidentFacets:readonly number[]}[];
}
interface Certificate {fixture:PoolFixtureV1;support:PoolSupport;supportKey:string;railKey:string;railMetaKey:string;revisions:string;geometry:Geometry;cage:Float32Array<ArrayBuffer>;
  patch:PreparedPoolPatch;patchKey:string;inverse:readonly number[];partKey:string;rigKey:string;snapshots:Uint8Array[];edgePoint:PoolDyadic[];targets:PoolRatio[];owned?:object}
interface PreparedOwner {certificate:Omit<Certificate,'edgePoint'|'targets'>;coefficients:PoolDyadic[][];limb:'handL'|'handR'}
const preparedOwners=new WeakMap<PoolPreparedRailGeometry,PreparedOwner>();
const certificates=new WeakMap<PoolRailContactFrame,Certificate>();
const exactCoefficients=new WeakMap<Geometry,Map<number,Map<number,PoolDyadic[]>>>();
const bytes=(view:ArrayBufferView)=>new Uint8Array(view.buffer,view.byteOffset,view.byteLength);
const inputs=(geometry:Geometry,cage:Float32Array<ArrayBuffer>)=>[cage,geometry.indices,geometry.stencilRanges,new Uint8Array(geometry.stencilWeights)];

/** The rational quaternion defines the intended proper rotation before matrix serialization. */
function intendedRotation(matrix:readonly number[]) {
  if(matrix.length!==16||matrix.some(value=>!Number.isFinite(value)))throw new Error('Pool rail orientation is not finite.');
  if([3,7,11,12,13,14].some(at=>matrix[at]!==0)||matrix[15]!==1)throw new Error('Pool rail orientation is not an origin rotation.');
  const m=matrix.map(number),determinant=add(sub(mul(m[0],sub(mul(m[5],m[10]),mul(m[9],m[6]))),mul(m[4],sub(mul(m[1],m[10]),mul(m[9],m[2])))),mul(m[8],sub(mul(m[1],m[6]),mul(m[5],m[2]))));
  if(compare(determinant,number(0))<=0)throw new Error('Pool rail orientation is singular or reverses its frame.');
  const trace=matrix[0]+matrix[5]+matrix[10];let x:number,y:number,z:number,w:number;
  if(trace>0){const s=2*Math.sqrt(trace+1);w=s/4;x=(matrix[6]-matrix[9])/s;y=(matrix[8]-matrix[2])/s;z=(matrix[1]-matrix[4])/s;}
  else if(matrix[0]>matrix[5]&&matrix[0]>matrix[10]){const s=2*Math.sqrt(1+matrix[0]-matrix[5]-matrix[10]);w=(matrix[6]-matrix[9])/s;x=s/4;y=(matrix[4]+matrix[1])/s;z=(matrix[8]+matrix[2])/s;}
  else if(matrix[5]>matrix[10]){const s=2*Math.sqrt(1+matrix[5]-matrix[0]-matrix[10]);w=(matrix[8]-matrix[2])/s;x=(matrix[4]+matrix[1])/s;y=s/4;z=(matrix[9]+matrix[6])/s;}
  else {const s=2*Math.sqrt(1+matrix[10]-matrix[0]-matrix[5]);w=(matrix[1]-matrix[4])/s;x=(matrix[8]+matrix[2])/s;y=(matrix[9]+matrix[6])/s;z=s/4;}
  const q=[x,y,z,w];if(q.some(value=>!Number.isFinite(value)))throw new Error('Pool rail quaternion is not finite.');
  const [xx,yy,zz,ww]=q.map(value=>mul(number(value),number(value))),denominator=add(add(xx,yy),add(zz,ww));
  if(denominator.numerator<=0n)throw new Error('Pool rail quaternion has no rotation.');
  const twice=(a:number,b:number)=>mul(number(2),mul(number(q[a]),number(q[b]))),xy=twice(0,1),xz=twice(0,2),xw=twice(0,3),yz=twice(1,2),yw=twice(1,3),zw=twice(2,3);
  const numerators=[sub(add(ww,xx),add(yy,zz)),add(xy,zw),sub(xz,yw),number(0),sub(xy,zw),sub(add(ww,yy),add(xx,zz)),add(yz,xw),number(0),
    add(xz,yw),sub(yz,xw),sub(add(ww,zz),add(xx,yy)),number(0),number(0),number(0),number(0),denominator];
  const ratios=numerators.map(numerator=>({numerator,denominator})),orientation=ratios.map(poolRatioNumber),errors=ratios.map((ratio,index)=>poolRatioRoundingError(ratio,orientation[index]));
  return {q,numerators,denominator,orientation,errors};
}

function coefficient(geometry:Geometry,cage:Float32Array<ArrayBuffer>,inverse:readonly number[],bone:number,vertex:number):PoolDyadic[] {
  const ids=new Uint32Array(geometry.stencilWeights),weights=new Float32Array(geometry.stencilWeights),result=Array.from({length:4},()=>number(0));
  const start=geometry.stencilRanges[vertex*4],count=geometry.stencilRanges[vertex*4+1];
  for(let at=start;at<start+count;at++){
    const source=ids[at*2]*16,position=[0,1,2].map(axis=>add(add(add(mul(number(inverse[axis]),number(cage[source])),mul(number(inverse[4+axis]),number(cage[source+1]))),mul(number(inverse[8+axis]),number(cage[source+2]))),number(inverse[12+axis])));
    for(let slot=0;slot<4;slot++){
      const weight=mul(number(weights[at*2+1]),number(cage[source+10+slot]));if(weight.numerator===0n)continue;
      if(cage[source+6+slot]!==bone)throw new Error('Pool rail contact requires rigid complete-palm ownership.');
      for(let axis=0;axis<3;axis++)result[axis]=add(result[axis],mul(weight,position[axis]));result[3]=add(result[3],weight);
    }
  }
  if(result[3].numerator<=0n)throw new Error('Pool rail contact requires positive homogeneous weights.');return result;
}

/** Capture the actual selected palm and finite rail geometry once before sampling. */
export function preparePoolRailGeometry(fixture:PoolFixtureV1,support:PoolSupport,geometry:Geometry,cage:Float32Array<ArrayBuffer>,inverse:readonly number[],patch:PreparedPoolPatch):PoolPreparedRailGeometry {
  if(!support.surface||support.region?.kind!=='rail')throw new Error('Pool rail frame requires its actual finite rail support.');
  const railIndex=fixture.rails.findIndex(rail=>rail.id===support.surface),side:1|-1=railIndex===0?1:-1;
  const hand=geometry.manifest.bones[patch.bone]?.name;
  if(railIndex<0||railIndex>1||hand!=='hand.L'&&hand!=='hand.R')throw new Error('Pool rail frame names a different hand or rail.');
  const limb=hand==='hand.L'?'handL':'handR';
  const solid=fixture.solids.find(solid=>solid.id===support.surface)!,region=derivePoolRailRegion(fixture,support.surface,support.region.parameter,side);
  const planeX=side*Math.max(...solid.vertices.map(point=>side*point[0]));
  if(solid.vertices.some(point=>side*compare(number(point[0]),number(planeX))>0))throw new Error('Pool rail edge has no global inner supporting plane.');
  const edges=region.edges.map(edge=>{
    const from=solid.vertices[edge.from],to=solid.vertices[edge.to];
    if(from[0]!==planeX||to[0]!==planeX)throw new Error('Pool rail edge has no global inner supporting plane.');
    const incidentFacets=region.triangles.filter(index=>solid.triangles[index].includes(edge.from)&&solid.triangles[index].includes(edge.to));
    if(!incidentFacets.length)throw new Error('Pool rail edge has no actual allowed incident facet.');
    return Object.freeze({edge,from:Object.freeze([...from]) as unknown as Vec3,to:Object.freeze([...to]) as unknown as Vec3,incidentFacets:Object.freeze(incidentFacets)});
  });
  const parts=geometry.description.parts.filter(part=>part.name===patch.part),part=parts[0];
  if(parts.length!==1||part.name!==(limb==='handL'?'Relaxed palm':'Relaxed palm.001'))throw new Error('Pool rail contact has no unique complete selected palm.');
  const owned=poolOwnedConfiguredIdentity(geometry,cage,inverse,patch.bone,patch);
  if(owned&&poolOwnedStaticIdentity(fixture,geometry,cage,patch)!==owned)throw new Error('Pool rail contact uses another physical dataset.');
  const vertices=(owned?poolOwnedParts(geometry)?.find(row=>row.name===patch.part)?.vertices:undefined)??[...new Set(geometry.indices.subarray(part.start,part.start+part.count))];
  const patchVertices=new Set(patch.vertices.map(vertex=>vertex.id)),actualPatch=new Set<number>();
  for(const triangle of patch.sourceTriangles){if(triangle*3<part.start||triangle*3+3>part.start+part.count)throw new Error('Pool rail patch leaves its selected palm.');for(let offset=0;offset<3;offset++)actualPatch.add(geometry.indices[triangle*3+offset]);}
  if(actualPatch.size!==patchVertices.size||[...actualPatch].some(vertex=>!patchVertices.has(vertex)))throw new Error('Pool rail patch vertices differ from the unchanged source fan.');
  let cached:Map<number,PoolDyadic[]>|undefined;
  if(owned){
    let byBone=exactCoefficients.get(geometry);
    if(!byBone){byBone=new Map();exactCoefficients.set(geometry,byBone);}
    cached=byBone.get(patch.bone);
    if(!cached){cached=new Map();byBone.set(patch.bone,cached);}
  }
  const coefficients=vertices.map(vertex=>{
    let value=cached?.get(vertex);
    if(!value){value=coefficient(geometry,cage,inverse,patch.bone,vertex);cached?.set(vertex,value);countPoolOwnedWork(geometry,'exactCoefficientBuilds');}
    return value;
  });
  const certificate={fixture,support,supportKey:canonicalPoolValue(support),railKey:canonicalPoolValue(solid),railMetaKey:canonicalPoolValue(fixture.rails),revisions:canonicalPoolValue(fixture.revisions),geometry,cage,patch,patchKey:canonicalPoolValue(patch),inverse:owned?inverse:[...inverse],
    partKey:canonicalPoolValue(geometry.description.parts),rigKey:canonicalPoolValue(geometry.manifest.bones),snapshots:owned?[]:inputs(geometry,cage).map(view=>bytes(view).slice()),owned};
  const data=Object.freeze({version:'pool-rail-goal-v1' as const,part:patch.part,bone:patch.bone,surface:support.surface!,side,planeX,
    sourceKey:canonicalPoolValue({source:geometry.manifest.sourceSha256,parts:certificate.partKey,rig:certificate.rigKey,rail:certificate.railKey,rails:certificate.railMetaKey,revisions:certificate.revisions}),
    support:freezeRailData(structuredClone(support)),inverse:Object.freeze([...inverse]),patch:freezeRailData(structuredClone(patch)),vertices:Object.freeze(vertices),
    coefficients:Object.freeze(coefficients.map(c=>Object.freeze(c.map(value=>Object.freeze({numerator:value.numerator.toString(),exponent:value.exponent}))))),edges:Object.freeze(edges)});
  preparedOwners.set(data,{certificate,coefficients,limb});return data;
}

function freezeRailData<T>(value:T):T {
  if(value&&typeof value==='object'){for(const child of Object.values(value))freezeRailData(child);Object.freeze(value);}return value;
}

/** Program ownership accepts only a frozen, physically prepared or independently bound record. */
export function requirePoolPreparedRailGeometry(data:PoolPreparedRailGeometry):void {
  const certificate=preparedOwners.get(data)?.certificate;
  if(!certificate||!Object.isFrozen(data))throw new Error('Pool attached goal has no owned immutable physical geometry.');
  if(certificate.owned&&poolOwnedStaticIdentity(certificate.fixture,certificate.geometry,certificate.cage,certificate.patch)!==certificate.owned)throw new Error('Pool attached goal belongs to another dataset.');
}

const physicalRailData=(data:PoolPreparedRailGeometry)=>({...data,support:{surface:data.support.surface,region:data.support.region}});
const compatibleGeometry=new WeakMap<PoolPreparedRailGeometry,WeakSet<PoolPreparedRailGeometry>>();
/** Compare immutable physical rail ownership once for each endpoint pair. */
export function requirePoolRailGeometryPair(a:PoolPreparedRailGeometry,b:PoolPreparedRailGeometry):void {
  const left=preparedOwners.get(a)?.certificate.owned,right=preparedOwners.get(b)?.certificate.owned;
  if(left!==right&&(left||right))throw new Error('Pool attached interval uses different physical datasets.');
  if(a===b||compatibleGeometry.get(a)?.has(b))return;
  if(canonicalPoolValue(physicalRailData(a))!==canonicalPoolValue(physicalRailData(b)))throw new Error('Pool attached interval has incompatible physical ownership.');
  let set=compatibleGeometry.get(a);if(!set){set=new WeakSet();compatibleGeometry.set(a,set);}set.add(b);
}

/** Bind serialized goal data against independently prepared actual geometry before rendering. */
export function bindPoolRailGeometry(data:PoolPreparedRailGeometry,fixture:PoolFixtureV1,support:PoolSupport,geometry:Geometry,cage:Float32Array<ArrayBuffer>,inverse:readonly number[],patch:PreparedPoolPatch,origin:PoolSupportLocation):void {
  requirePoolSourceSupport(fixture,origin,data.support);
  const actual=preparePoolRailGeometry(fixture,support,geometry,cage,inverse,patch);
  const owner=preparedOwners.get(actual)!;
  if(origin.limb!==owner.limb)throw new Error('Pool attached binding has a different anatomical owner.');
  if(canonicalPoolValue(physicalRailData(data))!==canonicalPoolValue(physicalRailData(actual)))throw new Error('Pool attached goal differs from its actual physical geometry.');
  freezeRailData(data);preparedOwners.set(data,{...owner,certificate:{...owner.certificate,support:data.support,supportKey:canonicalPoolValue(data.support)}});
}

/** The shared point producer follows actual mesh edges; no cage or topology scan occurs here. */
export function resolvePoolRailContactFrame(data:PoolPreparedRailGeometry,orientation:readonly number[],parameter:number,requiredActiveVertex?:number,location?:PoolSupportLocation):PoolRailContactFrame {
  const owner=preparedOwners.get(data);if(!owner)throw new Error('Pool attached goal has no bound actual rail geometry.');
  const {certificate,coefficients}=owner,{patch}=certificate,{side,planeX,vertices}=data;
  if(certificate.owned&&poolOwnedStaticIdentity(certificate.fixture,certificate.geometry,certificate.cage,patch)!==certificate.owned)throw new Error('Pool attached goal belongs to another dataset.');
  const support=location?poolSourceSupport(certificate.fixture,location).support:certificate.support;
  if(location&&(location.limb!==owner.limb||canonicalPoolValue({surface:support.surface,region:support.region})!==canonicalPoolValue({surface:data.surface,region:data.support.region})))throw new Error('Pool rail goal differs from its actual observation source context.');
  if(!Number.isFinite(parameter))throw new Error('Pool rail frame requires its actual finite rail support.');
  const selected=data.edges.find(({edge})=>parameter>=edge.fromParameter&&parameter<=edge.toParameter);
  if(!selected)throw new Error('Pool rail contact is outside the allowed edge domain.');
  const {edge,from,to,incidentFacets}=selected,edgeAmount=(parameter-edge.fromParameter)/(edge.toParameter-edge.fromParameter);
  if(compare(number(edgeAmount),number(0))<0||compare(number(edgeAmount),number(1))>0)throw new Error('Pool rail edge amount is outside its finite segment.');
  const edgePoint=from.map((value,axis)=>add(number(value),mul(number(edgeAmount),sub(number(to[axis]),number(value))))),patchVertices=new Set(data.patch.vertices.map(vertex=>vertex.id));
  const rotation=intendedRotation(orientation);
  const rotated=(c:PoolDyadic[],axis:number)=>add(add(mul(rotation.numerators[axis],c[0]),mul(rotation.numerators[4+axis],c[1])),mul(rotation.numerators[8+axis],c[2]));
  const ratios=coefficients.map(c=>({numerator:sub(mul(number(planeX),rotation.denominator),rotated(c,0)),denominator:mul(c[3],rotation.denominator)}));
  let active=0;for(let index=1;index<vertices.length;index++)if(side*poolRatioCompare(ratios[index],ratios[active])>0)active=index;
  const activeVertex=vertices[active];
  if(requiredActiveVertex!==undefined&&!patchVertices.has(requiredActiveVertex))throw new Error('Pool attached path has an unresolved active-extremum transition.');
  if(requiredActiveVertex!==undefined&&activeVertex!==requiredActiveVertex)throw new PoolTrialRefusal('Pool attached path has an unresolved active-extremum transition.');if(!patchVertices.has(activeVertex))throw new PoolTrialRefusal('Complete palm extremum is outside the unchanged required patch.');
  const activeCoefficient=coefficients[active],targets=edgePoint.map((point,axis)=>({numerator:sub(mul(point,rotation.denominator),rotated(activeCoefficient,axis)),denominator:mul(activeCoefficient[3],rotation.denominator)}));
  for(const c of coefficients){const t=targets[0],denominator=mul(rotation.denominator,t.denominator),gap=sub(add(mul(rotated(c,0),t.denominator),mul(mul(c[3],t.numerator),rotation.denominator)),mul(number(planeX),denominator));
    if(side*compare(gap,number(0))<0)throw new Error('Complete palm leaves its exact rail supporting half-space.');
  }
  for(let axis=0;axis<3;axis++){const t=targets[axis],actual=add(mul(rotated(activeCoefficient,axis),t.denominator),mul(mul(activeCoefficient[3],t.numerator),rotation.denominator));
    if(compare(actual,mul(edgePoint[axis],mul(rotation.denominator,t.denominator)))!==0)throw new Error('Pool palm does not meet its exact finite rail point.');
  }
  const translation=targets.map(poolRatioNumber),translationError=targets.map((ratio,axis)=>poolRatioRoundingError(ratio,translation[axis])),pointRatios=edgePoint.map(numerator=>({numerator,denominator:number(1)})),targetPoint=pointRatios.map(poolRatioNumber);
  const targetPointError=pointRatios.map((ratio,axis)=>poolRatioRoundingError(ratio,targetPoint[axis]));
  const frame=Object.freeze({part:patch.part,bone:patch.bone,surface:support.surface!,side,planeX,orientation:Object.freeze(rotation.orientation),orientationError:Object.freeze(rotation.errors),rotationQuaternion:Object.freeze(rotation.q),
    translation:Object.freeze(translation) as unknown as Vec3,translationError:Object.freeze(translationError) as unknown as Vec3,activeVertex,patchVertices:Object.freeze([...patchVertices]),edge,edgeAmount,
    incidentFacets:Object.freeze(incidentFacets),targetPoint:Object.freeze(targetPoint) as unknown as Vec3,targetPointError:Object.freeze(targetPointError) as unknown as Vec3,vertexCount:vertices.length,
    exactEdgePoint:Object.freeze(edgePoint.map(value=>Object.freeze({numerator:value.numerator.toString(),exponent:value.exponent}))),
    exactTranslation:Object.freeze(targets.map(value=>Object.freeze({numerator:value.numerator.numerator.toString(),denominator:value.denominator.numerator.toString(),exponent:value.numerator.exponent-value.denominator.exponent})))});
  certificates.set(frame,{...certificate,support,supportKey:canonicalPoolValue(support),edgePoint,targets});return frame;
}

/** Compatibility entry for preparation callers that need one isolated physical frame. */
export function preparePoolRailContactFrame(fixture:PoolFixtureV1,support:PoolSupport,geometry:Geometry,cage:Float32Array<ArrayBuffer>,inverse:readonly number[],patch:PreparedPoolPatch,orientation:readonly number[],parameter:number):PoolRailContactFrame {
  return resolvePoolRailContactFrame(preparePoolRailGeometry(fixture,support,geometry,cage,inverse,patch),orientation,parameter);
}

export function requirePoolRailContactFrame(frame:PoolRailContactFrame,fixture:PoolFixtureV1,geometry:Geometry,cage:Float32Array<ArrayBuffer>,patch:PreparedPoolPatch,inverse:readonly number[],support:PoolSupport){
  const owner=certificates.get(frame),solid=fixture.solids.find(solid=>solid.id===support.surface);
  if(!owner||owner.fixture!==fixture||owner.geometry!==geometry||owner.cage!==cage||owner.patch!==patch||owner.inverse.some((value,index)=>value!==inverse[index])||inverse.length!==16
      ||owner.supportKey!==canonicalPoolValue(support))throw new Error('Pool rail certificate does not own these unchanged physical inputs.');
  if(owner.owned){
    if(poolOwnedStaticIdentity(fixture,geometry,cage,patch)!==owner.owned)throw new Error('Pool rail contact certificate belongs to another dataset.');
    return;
  }
  if(owner.railKey!==canonicalPoolValue(solid)||owner.railMetaKey!==canonicalPoolValue(fixture.rails)||owner.revisions!==canonicalPoolValue(fixture.revisions)
    ||owner.patchKey!==canonicalPoolValue(patch)||owner.partKey!==canonicalPoolValue(geometry.description.parts)||owner.rigKey!==canonicalPoolValue(geometry.manifest.bones))throw new Error('Pool rail certificate does not own these unchanged physical inputs.');
  countPoolOwnedWork(geometry,'fullBufferChecks',4);
  inputs(geometry,cage).forEach((view,index)=>{const current=bytes(view),saved=owner.snapshots[index];if(!poolByteViewsEqual(current,saved))throw new Error('Pool rail physical coefficients changed after construction.');});
  if(canonicalPoolValue(patch.vertices.map(vertex=>vertex.id))!==canonicalPoolValue(frame.patchVertices))throw new Error('Pool rail source patch changed after construction.');
}

export function requirePoolRailFrameInstance(frame:PoolRailContactFrame,inverse:readonly number[]){
  const owner=certificates.get(frame);if(!owner)throw new Error('Pool rail frame has no exact physical construction.');
  requirePoolRailContactFrame(frame,owner.fixture,owner.geometry,owner.cage,owner.patch,inverse,owner.support);
}
