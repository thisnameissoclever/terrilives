import type {Geometry,Bundle} from './bundle.js';
import type {PreparedPoolPatch} from './pool-contact-patch.js';
import type {PoolFixtureV1,PoolSupport} from './pool-contact-types.js';
import type {Vec3} from './math.js';
import {canonicalPoolValue,poolByteViewsEqual} from './pool-contact-identity.js';
import {poolSourceSupport,requirePoolSourceSupport,type PoolSupportLocation} from './pool-source-policy.js';
import {requirePoolInterpolatedFootRotation,type PoolInterpolatedFootRotation} from './pool-matrix-producer.js';
import {poolExact as number,poolExactAdd as add,poolExactSubtract as sub,poolExactMultiply as mul,poolExactCompare as compare,
  poolRatioCompare,poolRatioNumber,poolRatioRoundingError,type PoolDyadic,type PoolRatio} from './pool-exact-number.js';

export interface PoolFootContactFrame {
  readonly part:string;readonly bone:number;readonly surface:string;readonly planeHeight:number;
  readonly orientation:readonly number[];readonly translation:Vec3;readonly translationError:Vec3;
  readonly orientationError:readonly number[];readonly rotationQuaternion:readonly number[];
  readonly activeVertex:number;readonly patchVertices:readonly number[];
  readonly exactVerticalTarget:{readonly numerator:string;readonly denominator:string;readonly exponent:number};
}
interface Certificate {geometry:Geometry;cage:Float32Array<ArrayBuffer>;inverse:readonly number[];fixture:PoolFixtureV1;patch:PreparedPoolPatch;target:PoolRatio;
  support:PoolSupport;supportKey:string;revision:string;solidKey:string;rigKey:string|undefined;partRange:readonly [number,number];snapshots:Uint8Array[]}
const certificates=new WeakMap<PoolFootContactFrame,Certificate>();
const rigKey=(bundle:Bundle|undefined)=>bundle?canonicalPoolValue({sourceSha256:bundle.sourceSha256,bones:bundle.bones}):undefined;

/** A rational quaternion rotation is exactly proper before its matrix is serialized. */
function intendedRotation(matrix:readonly number[]) {
  const trace=matrix[0]+matrix[5]+matrix[10];let x:number,y:number,z:number,w:number;
  if(trace>0){const s=2*Math.sqrt(trace+1);w=s/4;x=(matrix[6]-matrix[9])/s;y=(matrix[8]-matrix[2])/s;z=(matrix[1]-matrix[4])/s;}
  else if(matrix[0]>matrix[5]&&matrix[0]>matrix[10]){const s=2*Math.sqrt(1+matrix[0]-matrix[5]-matrix[10]);w=(matrix[6]-matrix[9])/s;x=s/4;y=(matrix[4]+matrix[1])/s;z=(matrix[8]+matrix[2])/s;}
  else if(matrix[5]>matrix[10]){const s=2*Math.sqrt(1+matrix[5]-matrix[0]-matrix[10]);w=(matrix[8]-matrix[2])/s;x=(matrix[4]+matrix[1])/s;y=s/4;z=(matrix[9]+matrix[6])/s;}
  else {const s=2*Math.sqrt(1+matrix[10]-matrix[0]-matrix[5]);w=(matrix[1]-matrix[4])/s;x=(matrix[8]+matrix[2])/s;y=(matrix[9]+matrix[6])/s;z=s/4;}
  const q=[x,y,z,w];if(q.some(value=>!Number.isFinite(value)))throw new Error('Pool intended rotation has no finite quaternion.');
  const [xx,yy,zz,ww]=q.map(value=>mul(number(value),number(value))),norm=add(add(xx,yy),add(zz,ww));
  if(norm.numerator<=0n)throw new Error('Pool intended quaternion has no rotation.');
  const twice=(a:number,b:number)=>mul(number(2),mul(number(q[a]),number(q[b]))),xy=twice(0,1),xz=twice(0,2),xw=twice(0,3),yz=twice(1,2),yw=twice(1,3),zw=twice(2,3);
  const numerators=[sub(add(ww,xx),add(yy,zz)),add(xy,zw),sub(xz,yw),number(0),sub(xy,zw),sub(add(ww,yy),add(xx,zz)),add(yz,xw),number(0),
    add(xz,yw),sub(yz,xw),sub(add(ww,zz),add(xx,yy)),number(0),number(0),number(0),number(0),norm];
  const ratios=numerators.map(numerator=>({numerator,denominator:norm})),orientation=ratios.map(poolRatioNumber),errors=ratios.map((ratio,index)=>poolRatioRoundingError(ratio,orientation[index]));
  return {q,numerators,denominator:norm,orientation,errors,ratios};
}


/** Exact coefficients preserve every stencil/skin weight and its positive homogeneous term. */
function coefficient(geometry:Geometry,cage:Float32Array<ArrayBuffer>,inverse:readonly number[],bone:number,vertex:number):PoolDyadic[] {
  const ids=new Uint32Array(geometry.stencilWeights),weights=new Float32Array(geometry.stencilWeights),result=Array.from({length:4},()=>number(0));
  const start=geometry.stencilRanges[vertex*4],count=geometry.stencilRanges[vertex*4+1];
  for(let at=start;at<start+count;at++){
    const source=ids[at*2]*16,position=[0,1,2].map(axis=>add(add(add(mul(number(inverse[axis]),number(cage[source])),mul(number(inverse[4+axis]),number(cage[source+1]))),mul(number(inverse[8+axis]),number(cage[source+2]))),number(inverse[12+axis])));
    for(let slot=0;slot<4;slot++){
      const weight=mul(number(weights[at*2+1]),number(cage[source+10+slot]));if(weight.numerator===0n)continue;
      if(cage[source+6+slot]!==bone)throw new Error('Exact pool foot contact requires rigid full-foot ownership.');
      for(let axis=0;axis<3;axis++)result[axis]=add(result[axis],mul(weight,position[axis]));result[3]=add(result[3],weight);
    }
  }
  if(result[3].numerator<=0n)throw new Error('Pool foot contact requires positive homogeneous weight.');return result;
}

/** Construct the physical premise before IK or any rounded surface observation exists. */
export function preparePoolFootContactFrame(fixture:PoolFixtureV1,support:PoolSupport,geometry:Geometry,cage:Float32Array<ArrayBuffer>,inverse:readonly number[],patch:PreparedPoolPatch,orientation:readonly number[],translationXY:readonly [number,number]):PoolFootContactFrame {
  if(!support.surface||support.region?.kind!=='top-face')throw new Error('Pool foot contact needs a named horizontal finite support.');
  if(translationXY.some(value=>!Number.isFinite(value)))throw new Error('Pool foot contact needs finite plane coordinates.');
  if(orientation.length!==16||orientation.some(value=>!Number.isFinite(value)))throw new Error('Pool foot contact needs a finite intended orientation.');
  const solid=fixture.solids.find(solid=>solid.id===support.surface),ground=fixture.ground.id===support.surface?fixture.ground:null;
  const heights=ground?[ground.bounds[1][2]]:(support.region.triangles??[]).flatMap(index=>solid!.triangles[index].map(id=>solid!.vertices[id][2]));
  if(!heights.length||heights.some(height=>height!==heights[0]))throw new Error('Pool foot contact needs one actual horizontal plane.');
  const parts=geometry.description.parts.filter(part=>part.name===patch.part),part=parts[0];if(parts.length!==1)throw new Error('Pool foot contact has no unique selected full-foot owner.');
  const vertices=[...new Set(geometry.indices.subarray(part.start,part.start+part.count))],patchVertices=new Set(patch.vertices.map(vertex=>vertex.id));
  const rotation=intendedRotation(orientation);
  let target:PoolRatio|undefined,activeVertex=-1;
  const targets=vertices.map(vertex=>{
    const c=coefficient(geometry,cage,inverse,patch.bone,vertex),height=add(add(mul(rotation.numerators[2],c[0]),mul(rotation.numerators[6],c[1])),mul(rotation.numerators[10],c[2]));
    const ratio={numerator:sub(mul(number(heights[0]),rotation.denominator),height),denominator:mul(c[3],rotation.denominator)};
    if(!target||poolRatioCompare(ratio,target)>0||poolRatioCompare(ratio,target)===0&&patchVertices.has(vertex)&&!patchVertices.has(activeVertex)){target=ratio;activeVertex=vertex;}
    return ratio;
  });
  if(!target||!patchVertices.has(activeVertex))throw new Error('The full-foot tangent vertex is outside the unchanged required patch.');
  // Exact comparison, independently repeated over the complete selected foot.
  if(targets.some(ratio=>poolRatioCompare(ratio,target!)>0))throw new Error('Pool foot tangent target leaves a nominal vertex below its plane.');
  const z=poolRatioNumber(target),error=poolRatioRoundingError(target,z);
  const frame=Object.freeze({part:patch.part,bone:patch.bone,surface:support.surface,planeHeight:heights[0],orientation:Object.freeze(rotation.orientation),
    orientationError:Object.freeze(rotation.errors),rotationQuaternion:Object.freeze(rotation.q),
    translation:Object.freeze([translationXY[0],translationXY[1],z]) as Vec3,translationError:Object.freeze([0,0,error]) as Vec3,activeVertex,
    patchVertices:Object.freeze([...patchVertices]),exactVerticalTarget:Object.freeze({numerator:target.numerator.numerator.toString(),denominator:target.denominator.numerator.toString(),exponent:target.numerator.exponent-target.denominator.exponent})});
  const snapshots=[cage,geometry.indices,geometry.stencilRanges,new Uint8Array(geometry.stencilWeights)].map(data=>new Uint8Array(data.buffer,data.byteOffset,data.byteLength).slice());
  certificates.set(frame,{geometry,cage,inverse:[...inverse],fixture,patch,target,support,supportKey:canonicalPoolValue(support),revision:canonicalPoolValue(fixture.revisions),solidKey:canonicalPoolValue(solid??ground),rigKey:rigKey(geometry.manifest),partRange:[part.start,part.count],snapshots});return frame;
}

export function requirePoolFootContactFrame(frame:PoolFootContactFrame,fixture:PoolFixtureV1,geometry:Geometry,cage:Float32Array<ArrayBuffer>,patch:PreparedPoolPatch,actualInverse?:readonly number[],suppliedSupport?:PoolSupport,actualRig?:Bundle):void {
  const certificate=certificates.get(frame);
  if(!certificate||certificate.fixture!==fixture||certificate.geometry!==geometry||certificate.cage!==cage||certificate.patch!==patch)throw new Error('Pool foot contact certificate does not own these physical inputs.');
  if(certificate.rigKey!==rigKey(geometry.manifest))throw new Error('Pool foot actual selected rig changed after reference construction.');
  if(actualRig&&(!certificate.rigKey||certificate.rigKey!==rigKey(actualRig)))throw new Error('Pool foot uses a different actual selected rig.');
  if(actualInverse&&(actualInverse.length!==certificate.inverse.length||certificate.inverse.some((value,index)=>value!==actualInverse[index])))throw new Error('Pool foot contact certificate used a different configured inverse.');
  if(suppliedSupport&&(canonicalPoolValue(suppliedSupport)!==certificate.supportKey||suppliedSupport.surface!==frame.surface))throw new Error('Pool foot contact certificate used a different finite support descriptor.');
  const {support}=certificate,solid=fixture.solids.find(solid=>solid.id===frame.surface),ground=fixture.ground.id===frame.surface?fixture.ground:null;
  const heights=ground?[ground.bounds[1][2]]:(support.region?.kind==='top-face'?support.region.triangles??[]:[]).flatMap(index=>solid!.triangles[index].map(id=>solid!.vertices[id][2]));
  if(!heights.length||heights.some(height=>height!==frame.planeHeight)||certificate.revision!==canonicalPoolValue(fixture.revisions)||certificate.supportKey!==canonicalPoolValue(support))throw new Error('Pool foot contact certificate has stale fixture ownership.');
  const parts=geometry.description.parts.filter(part=>part.name===frame.part),part=parts[0];
  if(parts.length!==1||part.start!==certificate.partRange[0]||part.count!==certificate.partRange[1]||patch.bone!==frame.bone||canonicalPoolValue(patch.vertices.map(vertex=>vertex.id))!==canonicalPoolValue(frame.patchVertices))throw new Error('Pool foot contact certificate has stale patch ownership.');
  const actual=[cage,geometry.indices,geometry.stencilRanges,new Uint8Array(geometry.stencilWeights)];
  actual.forEach((data,index)=>{const bytes=new Uint8Array(data.buffer,data.byteOffset,data.byteLength),snapshot=certificate.snapshots[index];if(!poolByteViewsEqual(bytes,snapshot))throw new Error('Pool foot contact certificate has changed physical coefficients.');});
}
export function requirePoolFootContactFrameInstance(frame:PoolFootContactFrame,actualInverse?:readonly number[],actualRig?:Bundle):void {
  const certificate=certificates.get(frame);if(!certificate)throw new Error('Pool foot frame was not constructed from its exact physical inputs.');
  requirePoolFootContactFrame(frame,certificate.fixture,certificate.geometry,certificate.cage,certificate.patch,actualInverse,undefined,actualRig);
}

/** A literal free goal may use this plane reference without claiming tangent contact. */
export function requirePoolFootClearanceReference(frame:PoolFootContactFrame,target:readonly number[],orientation:readonly number[],actualInverse?:readonly number[],actualRig?:Bundle) {
  requirePoolFootContactFrameInstance(frame,actualInverse,actualRig);
  const certificate=certificates.get(frame)!,solid=certificate.fixture.solids.find(solid=>solid.id===frame.surface);
  if(!certificate.rigKey||actualRig&&certificate.rigKey!==rigKey(actualRig))throw new Error('Pool free foot uses a different actual selected rig.');
  if(!solid||canonicalPoolValue(solid)!==certificate.solidKey)throw new Error('Pool free foot reference solid changed.');
  if(target.length!==3||target.some(value=>!Number.isFinite(value))||target[0]!==frame.translation[0]||target[1]!==frame.translation[1])throw new Error('Pool free foot differs from its reference plane coordinates.');
  if(orientation.length!==16||orientation.some((value,at)=>value!==frame.orientation[at]))throw new Error('Pool free foot differs from its intended reference rotation.');
  const numerator=sub(mul(number(target[2]),certificate.target.denominator),certificate.target.numerator);
  const comparison=compare(numerator,number(0));
  if(comparison<0)throw new Error('Pool free foot is below its exact nominal reference plane.');
  return Object.freeze({comparison,exactTargetMargin:Object.freeze({numerator:numerator.numerator.toString(),denominator:certificate.target.denominator.numerator.toString(),exponent:numerator.exponent-certificate.target.denominator.exponent}),orientationError:frame.orientationError});
}

export interface PoolInterpolatedFootClearanceReference {
  readonly kind:'interpolated-free-foot-approach';readonly part:string;readonly bone:number;readonly surface:string;
  readonly planeHeight:number;readonly orientation:readonly number[];readonly activeVertex:number;
}
export type PoolFreeFootClearanceReference=PoolFootContactFrame|PoolInterpolatedFootClearanceReference;
interface InterpolatedCertificate {
  fixture:PoolFixtureV1;geometry:Geometry;cage:Float32Array<ArrayBuffer>;patch:PreparedPoolPatch;support:PoolSupport;supportKey:string;location:PoolSupportLocation;locationKey:string;
  inverse:readonly number[];bundle:Bundle;rig:string|undefined;solidKey:string;revision:string;partRange:readonly [number,number];patchKey:string;snapshots:Uint8Array[];
  producer:PoolInterpolatedFootRotation;target:readonly number[];orientation:readonly number[];
  premise:{readonly orientationError:readonly number[];readonly exactTargetMargin:{readonly numerator:string;readonly denominator:string;readonly exponent:number};readonly literalMinimum:Readonly<PoolDyadic>;readonly properMinimum:{readonly numerator:Readonly<PoolDyadic>;readonly denominator:Readonly<PoolDyadic>}};
}
const interpolatedCertificates=new WeakMap<PoolInterpolatedFootClearanceReference,InterpolatedCertificate>();

/** An independent collision-only premise for the unchanged output of an authenticated interpolation. */
export function preparePoolInterpolatedFootReference(fixture:PoolFixtureV1,support:PoolSupport,geometry:Geometry,cage:Float32Array<ArrayBuffer>,inverse:readonly number[],patch:PreparedPoolPatch,
  bundle:Bundle,location:PoolSupportLocation,target:readonly number[],orientation:readonly number[],producer:PoolInterpolatedFootRotation):PoolInterpolatedFootClearanceReference {
  requirePoolSourceSupport(fixture,location,support);const actual=poolSourceSupport(fixture,location);
  if(actual.required||support.mode!=='approach'||support.region?.kind!=='top-face'||!support.surface||bundle.bones[patch.bone]?.name!=='foot.'+location.limb.slice(-1)||!location.limb.startsWith('foot')||rigKey(geometry.manifest)!==rigKey(bundle))throw new Error('Pool interpolated clearance requires its actual selected nonrequired foot approach.');
  const rotation=requirePoolInterpolatedFootRotation(producer,bundle,geometry,fixture,patch,location,target,orientation,inverse),solid=fixture.solids.find(s=>s.id===support.surface);
  if(!solid)throw new Error('Pool interpolated approach has no actual solid.');
  const heights=(support.region.triangles??[]).flatMap(index=>solid.triangles[index]?.map(id=>solid.vertices[id][2])??[]),plane=heights[0];
  if(!heights.length||heights.some(h=>h!==plane)||solid.vertices.some(v=>v.some(x=>!Number.isFinite(x))||v[2]>plane)||solid.bounds[1][2]>plane||solid.triangles.some(face=>face.some(id=>!Number.isInteger(id)||id<0||id>=solid.vertices.length)))throw new Error('Pool interpolated approach solid is not wholly below its actual horizontal plane.');
  const parts=geometry.description.parts.filter(p=>p.name===patch.part),part=parts[0];if(parts.length!==1)throw new Error('Pool interpolated approach needs one complete selected foot part.');
  const vertices=[...new Set(geometry.indices.subarray(part.start,part.start+part.count))],patchIds=new Set(patch.vertices.map(v=>v.id)),norm=rotation.denominator,r=rotation.numerators;
  let literalMinimum:PoolDyadic|undefined,properMinimum:PoolRatio|undefined,verticalTarget:PoolRatio|undefined,activeVertex=-1;
  for(const vertex of vertices){
    const c=coefficient(geometry,cage,inverse,patch.bone,vertex),translation=sub(mul(number(target[2]),c[3]),number(plane));
    const literal=add(add(add(mul(number(orientation[2]),c[0]),mul(number(orientation[6]),c[1])),mul(number(orientation[10]),c[2])),translation);
    const height=add(add(mul(r[2],c[0]),mul(r[6],c[1])),mul(r[10],c[2])),proper={numerator:add(height,mul(translation,norm)),denominator:norm};
    const tangent={numerator:sub(mul(number(plane),norm),height),denominator:mul(c[3],norm)};
    if(!literalMinimum||compare(literal,literalMinimum)<0)literalMinimum=literal;
    if(!properMinimum||poolRatioCompare(proper,properMinimum)<0)properMinimum=proper;
    if(!verticalTarget||poolRatioCompare(tangent,verticalTarget)>0||poolRatioCompare(tangent,verticalTarget)===0&&patchIds.has(vertex)&&!patchIds.has(activeVertex)){verticalTarget=tangent;activeVertex=vertex;}
  }
  if(!literalMinimum||!properMinimum||!verticalTarget||compare(literalMinimum,number(0))<0||compare(properMinimum.numerator,number(0))<0)throw new Error('Pool interpolated foot is below its exact literal or proper nominal plane.');
  if(!patchIds.has(activeVertex))throw new Error('Pool interpolated full-foot extremum is outside its actual patch.');
  const margin=sub(mul(number(target[2]),verticalTarget.denominator),verticalTarget.numerator);
  const premise=Object.freeze({orientationError:Object.freeze([...rotation.orientationError]),exactTargetMargin:Object.freeze({numerator:margin.numerator.toString(),denominator:verticalTarget.denominator.numerator.toString(),exponent:margin.exponent-verticalTarget.denominator.exponent}),
    literalMinimum:Object.freeze({...literalMinimum}),properMinimum:Object.freeze({numerator:Object.freeze({...properMinimum.numerator}),denominator:Object.freeze({...properMinimum.denominator})})});
  const reference=Object.freeze({kind:'interpolated-free-foot-approach' as const,part:patch.part,bone:patch.bone,surface:support.surface,planeHeight:plane,orientation:Object.freeze([...orientation]),activeVertex});
  const snapshots=[cage,geometry.indices,geometry.stencilRanges,new Uint8Array(geometry.stencilWeights)].map(v=>new Uint8Array(v.buffer,v.byteOffset,v.byteLength).slice());
  interpolatedCertificates.set(reference,{fixture,geometry,cage,patch,support,supportKey:canonicalPoolValue(support),location:Object.freeze({...location}),locationKey:canonicalPoolValue(location),inverse:Object.freeze([...inverse]),bundle,rig:rigKey(bundle),solidKey:canonicalPoolValue(solid),revision:canonicalPoolValue(fixture.revisions),partRange:[part.start,part.count],patchKey:canonicalPoolValue(patch),snapshots,producer,target:Object.freeze([...target]),orientation:Object.freeze([...orientation]),premise});return reference;
}
function requireInterpolatedCertificate(reference:PoolInterpolatedFootClearanceReference):InterpolatedCertificate {
  const owner=interpolatedCertificates.get(reference);if(!owner)throw new Error('Pool interpolated foot reference was not constructed by its private producer.');
  const {fixture,geometry,cage,patch,support,bundle,location}=owner,part=geometry.description.parts.filter(p=>p.name===patch.part),solid=fixture.solids.find(s=>s.id===support.surface);
  requirePoolSourceSupport(fixture,location,support);const actual=poolSourceSupport(fixture,location);
  if(actual.required||actual.support.mode!=='approach'||owner.supportKey!==canonicalPoolValue(support)||owner.rig!==rigKey(bundle)||owner.rig!==rigKey(geometry.manifest)||owner.solidKey!==canonicalPoolValue(solid)||owner.revision!==canonicalPoolValue(fixture.revisions)||owner.patchKey!==canonicalPoolValue(patch)||part.length!==1||part[0].start!==owner.partRange[0]||part[0].count!==owner.partRange[1])throw new Error('Pool interpolated reference source, geometry or solid changed.');
  [cage,geometry.indices,geometry.stencilRanges,new Uint8Array(geometry.stencilWeights)].forEach((v,i)=>{const current=new Uint8Array(v.buffer,v.byteOffset,v.byteLength),saved=owner.snapshots[i];if(!poolByteViewsEqual(current,saved))throw new Error('Pool interpolated reference coefficients changed.');});
  requirePoolInterpolatedFootRotation(owner.producer,bundle,geometry,fixture,patch,location,owner.target,owner.orientation,owner.inverse);return owner;
}
export function requirePoolInterpolatedFootReference(reference:PoolInterpolatedFootClearanceReference,fixture:PoolFixtureV1,geometry:Geometry,cage:Float32Array<ArrayBuffer>,patch:PreparedPoolPatch,support:PoolSupport,
  location:PoolSupportLocation,actualInverse:readonly number[],actualRig:Bundle):void {
  const owner=requireInterpolatedCertificate(reference);
  if(owner.fixture!==fixture||owner.geometry!==geometry||owner.cage!==cage||owner.patch!==patch||owner.bundle!==actualRig||owner.supportKey!==canonicalPoolValue(support)||owner.locationKey!==canonicalPoolValue(location)||owner.inverse.some((v,i)=>v!==actualInverse[i])||owner.inverse.length!==actualInverse.length)throw new Error('Pool interpolated foot reference has another actual observation owner.');
}
/** Common free-trace accessor preserves strict required-contact guards and exposes no certificate authority. */
export function requirePoolFreeFootClearanceReference(reference:PoolFreeFootClearanceReference,target:readonly number[],orientation:readonly number[],actualInverse:readonly number[],actualRig:Bundle){
  if(!('kind' in reference))return requirePoolFootClearanceReference(reference,target,orientation,actualInverse,actualRig);
  const owner=requireInterpolatedCertificate(reference);
  if(owner.bundle!==actualRig||target.length!==owner.target.length||target.some((v,i)=>v!==owner.target[i])||orientation.length!==owner.orientation.length||orientation.some((v,i)=>!Object.is(v,owner.orientation[i]))||actualInverse.length!==owner.inverse.length||actualInverse.some((v,i)=>v!==owner.inverse[i]))throw new Error('Pool free foot differs from its owned interpolated reference.');
  const premise=owner.premise;return Object.freeze({orientationError:Object.freeze([...premise.orientationError]),exactTargetMargin:Object.freeze({...premise.exactTargetMargin}),literalMinimum:Object.freeze({...premise.literalMinimum}),properMinimum:Object.freeze({numerator:Object.freeze({...premise.properMinimum.numerator}),denominator:Object.freeze({...premise.properMinimum.denominator})})});
}
