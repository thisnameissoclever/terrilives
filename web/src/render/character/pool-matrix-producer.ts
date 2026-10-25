import {boneFrame,properRotation,matrix,vector,type M} from './pool-matrix-arithmetic.js';
import type {Vec3} from './math.js';
import {canonicalPoolPreference,properPoolRotation,type PoolHierarchy} from './pool-canonical-pose.js';
import type {Bundle,Geometry} from './bundle.js';
import {shapeVertices,type ShapeParameters} from './shape.js';
import type {PoolFixtureV1} from './pool-contact-types.js';
import {POOL_INTERPOLATION_REVISION} from './pool-contact-types.js';
import type {PreparedPoolPatch} from './pool-contact-patch.js';
import type {PoolPoseControl,PoolIntervalLimb} from './pool-contact-evaluator.js';
import {poolSourceSupport,poolSourceEvents,type PoolSupportLocation} from './pool-source-policy.js';
import {canonicalPoolValue,poolByteViewsEqual} from './pool-contact-identity.js';
import {interpolateTransform} from './motion.js';
import {poolExact as exact,poolExactAdd as exactAdd,poolExactSubtract as exactSub,poolExactMultiply as exactMul,poolRatioUpper,type PoolDyadic} from './pool-exact-number.js';
import {composeSkeletonPose} from './pose-joints.js';
import {preparePoolFootContactFrame,requirePoolFootContactFrameInstance,type PoolFootContactFrame} from './pool-foot-contact-frame.js';
import {inverse,multiply,point,type V} from './pool-matrix-arithmetic.js';
import {orientedPoolLegMath} from './pool-oriented-leg-math.js';

interface Producer {kind:'configured-rest'|'proper-rotation'|'root-travel'|'oriented-leg';values:readonly number[];errors:readonly number[]}
const producers=new WeakMap<readonly number[],Producer>();
function retain(output:number[],expected:M,kind:Producer['kind']):number[] {
  if(output.length!==16||expected.some((value,index)=>value.value!==output[index]||!Number.isFinite(value.error)||value.error<0))throw new Error('Pool matrix differs from its declared legitimate producer.');
  producers.set(output,{kind,values:Object.freeze([...output]),errors:Object.freeze(expected.map(value=>value.error))});return output;
}

/** Capture the actual configured bone-frame operations, rather than infer error from a matrix. */
export function registerPoolRestMatrix(output:number[],head:Vec3,tail:Vec3,reference:readonly number[]):number[] {
  return retain(output,boneFrame(vector(head),vector(tail),matrix(reference)),'configured-rest');
}
export function registerPoolProperRotation(output:number[],source:readonly number[]):number[] {
  return retain(output,properRotation(matrix(source)),'proper-rotation');
}
export function requirePoolMatrixRepresentation(values:readonly number[]):readonly number[] {
  const producer=producers.get(values);
  if(!producer||producer.values.some((value,index)=>value!==values[index]))throw new Error('Pool matrix has no unchanged legitimate producer.');
  return producer.errors;
}
export function clonePoolMatrix(values:readonly number[]):number[] {
  requirePoolMatrixRepresentation(values);const producer=producers.get(values)!,copy=[...values];
  producers.set(copy,{...producer,values:Object.freeze([...copy])});return copy;
}
/** Root translation is intentional travel; its existing rotation producer remains authoritative. */
export function registerPoolRootTravel(values:number[]):void {
  const producer=producers.get(values);
  if(!producer||!['proper-rotation','root-travel'].includes(producer.kind)||producer.values.some((value,index)=>(index<12||index===15)&&value!==values[index])||values.some(value=>!Number.isFinite(value)))throw new Error('Pool root travel changed an unowned matrix or its rotation.');
  producers.set(values,{kind:'root-travel',values:Object.freeze([...values]),errors:Object.freeze(producer.errors.map((value,index)=>index>=12&&index<15?0:value))});
}

export interface PoolFootRotationEndpointInput {
  readonly bundle:Bundle;readonly geometry:readonly Geometry[];readonly shape:ShapeParameters;readonly top:number;
  readonly fixture:PoolFixtureV1;readonly patch:PreparedPoolPatch;readonly location:PoolSupportLocation;
  readonly control:PoolPoseControl;readonly rootBasis:readonly number[];
}
export interface PoolFootRotationEndpoint {readonly kind:'pool-foot-rotation-endpoint'}
export interface PoolInterpolatedFootRotation {readonly kind:'pool-interpolated-foot-rotation'}
interface FootEndpointOwner {input:PoolFootRotationEndpointInput;key:string;orientation:readonly number[];target:readonly number[];quaternion:readonly number[];inverse:readonly number[];frame?:PoolFootContactFrame;views:{read:()=>ArrayBufferView;bytes:Uint8Array}[]}
const footEndpoints=new WeakMap<PoolFootRotationEndpoint,FootEndpointOwner>();
const bytes=(view:ArrayBufferView)=>new Uint8Array(view.buffer,view.byteOffset,view.byteLength);
const sameValues=(a:readonly number[],b:readonly number[])=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const endpointKey=(input:PoolFootRotationEndpointInput)=>canonicalPoolValue({source:input.bundle.sourceSha256,bones:input.bundle.bones,standing:input.bundle.basisActions.pool_enter?.[0],
  basis:input.bundle.basisActions[input.location.action],world:input.bundle.actions[input.location.action],metadata:{stepSamples:input.bundle.clipMetadata?.[input.location.action]?.stepSamples??false,playback:input.bundle.clipMetadata?.[input.location.action]?.playback??'loop'},
  selected:input.geometry.map(g=>({source:g.manifest.sourceSha256,bones:g.manifest.bones,parts:g.description.parts.map(p=>({name:p.name,start:p.start,count:p.count}))})),
  shape:input.shape,top:input.top,location:input.location,control:input.control,root:input.rootBasis,patch:input.patch,support:poolSourceSupport(input.fixture,input.location),revisions:input.fixture.revisions});
function rotationQuaternion(m:readonly number[]):number[] {
  const trace=m[0]+m[5]+m[10];
  if(trace>0){const s=Math.sqrt(trace+1)*2;return [(m[6]-m[9])/s,(m[8]-m[2])/s,(m[1]-m[4])/s,s/4];}
  if(m[0]>m[5]&&m[0]>m[10]){const s=Math.sqrt(1+m[0]-m[5]-m[10])*2;return [s/4,(m[4]+m[1])/s,(m[8]+m[2])/s,(m[6]-m[9])/s];}
  if(m[5]>m[10]){const s=Math.sqrt(1+m[5]-m[0]-m[10])*2;return [(m[4]+m[1])/s,s/4,(m[9]+m[6])/s,(m[8]-m[2])/s];}
  const s=Math.sqrt(1+m[10]-m[0]-m[5])*2;return [(m[8]+m[2])/s,(m[9]+m[6])/s,s/4,(m[1]-m[4])/s];
}

/** Recover a genuine configured source or required-frame endpoint after deserialization. */
export function preparePoolFootRotationEndpoint(candidate:PoolFootRotationEndpointInput):PoolFootRotationEndpoint {
  const input:PoolFootRotationEndpointInput=Object.freeze({...candidate,geometry:Object.freeze([...candidate.geometry]),location:Object.freeze({...candidate.location}),
    control:Object.freeze({...candidate.control,anchor:Object.freeze([...candidate.control.anchor]) as typeof candidate.control.anchor,state:candidate.control.state})});
  const {bundle,geometry,shape,top,fixture,patch,location,control,rootBasis}=input,{upper,lower,end}=control,side=location.limb.slice(-1);
  if(location.action!=='pool_enter'||!['footL','footR'].includes(location.limb)||control.legFrame!=='source-entry-0'||!sameValues(control.anchor,[0,0,0,1])||control.state.attached
      ||bundle.bones[upper]?.name!=='thigh.'+side||bundle.bones[lower]?.name!=='shin.'+side||bundle.bones[end]?.name!=='foot.'+side||bundle.bones[bundle.bones[upper].parent]?.name!=='hips'||bundle.bones[lower].parent!==upper||bundle.bones[end].parent!==lower||patch.bone!==end)throw new Error('Pool foot rotation endpoint has another source chain.');
  const seed=canonicalPoolPreference(bundle,shape,top,location.action,location.phase*(bundle.actions[location.action].length-1),geometry),root=bundle.bones.findIndex(b=>b.name==='root');
  if(!sameValues(rootBasis,seed.basis[root]))throw new Error('Pool foot rotation endpoint has unreconstructed root travel.');
  const source=poolSourceSupport(fixture,location);let frame:PoolFootContactFrame|undefined,orientation:readonly number[],target:readonly number[];
  if(source.required){const cage=shapeVertices(geometry[0].cage,shape,top);frame=preparePoolFootContactFrame(fixture,source.support,geometry[0],cage,seed.inverse[end],patch,properPoolRotation(seed.rest[end]),control.state.target.slice(0,2) as [number,number]);orientation=frame.orientation;target=frame.translation;}
  else {orientation=properPoolRotation(seed.world[end]);target=seed.world[end].slice(12,15);}
  if(!sameValues(control.state.orientation,orientation)||!sameValues(control.state.target,target))throw new Error('Pool foot endpoint differs from its actual configured source producer.');
  const views=geometry.flatMap(g=>[()=>g.cage,()=>g.indices,()=>g.stencilRanges,()=>new Uint8Array(g.stencilWeights)]).map(read=>({read,bytes:bytes(read()).slice()}));
  const token=Object.freeze({kind:'pool-foot-rotation-endpoint' as const});footEndpoints.set(token,{input,key:endpointKey(input),orientation:Object.freeze([...orientation]),target:Object.freeze([...target]),quaternion:Object.freeze(frame?[...frame.rotationQuaternion]:rotationQuaternion(orientation)),inverse:Object.freeze([...seed.inverse[end]]),frame,views});return token;
}
function requireFootEndpoint(token:PoolFootRotationEndpoint):FootEndpointOwner {
  const owner=footEndpoints.get(token);
  if(!owner||owner.key!==endpointKey(owner.input)||owner.views.some(view=>{const actual=bytes(view.read());return !poolByteViewsEqual(actual,view.bytes);}))throw new Error('Pool foot rotation endpoint has no unchanged source owner.');
  if(owner.frame)requirePoolFootContactFrameInstance(owner.frame,owner.inverse,owner.input.bundle);return owner;
}
interface FootRotationOwner {from:PoolFootRotationEndpoint;to:PoolFootRotationEndpoint;control:PoolIntervalLimb;controlKey:string;location:PoolSupportLocation;locationKey:string;
  orientation:readonly number[];target:readonly number[];numerators:readonly PoolDyadic[];denominator:PoolDyadic;errors:readonly number[];branch:string;amount:number}
const footRotations=new WeakMap<PoolInterpolatedFootRotation,FootRotationOwner>();
function properQuaternionReference(q:readonly number[],orientation:readonly number[]){
  if(q.some(v=>!Number.isFinite(v)))throw new Error('Pool interpolated foot quaternion is not finite.');
  const square=q.map(v=>exactMul(exact(v),exact(v))),[xx,yy,zz,ww]=square,norm=exactAdd(exactAdd(xx,yy),exactAdd(zz,ww));if(norm.numerator<=0n)throw new Error('Pool interpolated foot quaternion is singular.');
  const twice=(a:number,b:number)=>exactMul(exact(2),exactMul(exact(q[a]),exact(q[b]))),xy=twice(0,1),xz=twice(0,2),xw=twice(0,3),yz=twice(1,2),yw=twice(1,3),zw=twice(2,3);
  const numerators=[exactSub(exactAdd(ww,xx),exactAdd(yy,zz)),exactAdd(xy,zw),exactSub(xz,yw),exact(0),exactSub(xy,zw),exactSub(exactAdd(ww,yy),exactAdd(xx,zz)),exactAdd(yz,xw),exact(0),exactAdd(xz,yw),exactSub(yz,xw),exactSub(exactAdd(ww,zz),exactAdd(xx,yy)),exact(0),exact(0),exact(0),exact(0),norm];
  const errors=numerators.map((value,i)=>{const d=exactSub(exactMul(exact(orientation[i]),norm),value);return poolRatioUpper({numerator:{...d,numerator:d.numerator<0n?-d.numerator:d.numerator},denominator:norm});});
  return {numerators:Object.freeze(numerators.map(v=>Object.freeze({...v}))),denominator:Object.freeze({...norm}),errors:Object.freeze(errors)};
}

/** Mirror the named generic operation and fail if its implementation or endpoint ownership drifts. */
export function preparePoolInterpolatedFootRotation(from:PoolFootRotationEndpoint,to:PoolFootRotationEndpoint,control:PoolIntervalLimb,location:PoolSupportLocation):PoolInterpolatedFootRotation {
  const a=requireFootEndpoint(from),b=requireFootEndpoint(to),start=a.input.location.phase,end=b.input.location.phase;
  if(a.input.bundle!==b.input.bundle||a.input.fixture!==b.input.fixture||a.input.geometry[0]!==b.input.geometry[0]||a.input.patch!==b.input.patch||a.input.location.action!==location.action||b.input.location.action!==location.action||a.input.location.limb!==location.limb||b.input.location.limb!==location.limb
      ||a.input.control.state!==control.from||b.input.control.state!==control.to||control.end!==a.input.control.end||control.upper!==a.input.control.upper||control.lower!==a.input.control.lower||control.legFrame!=='source-entry-0'||!sameValues(control.anchor,[0,0,0,1])||!(start<end)||location.phase<start||location.phase>end
      ||poolSourceEvents(a.input.fixture,location.action).some(phase=>phase>start&&phase<end))throw new Error('Pool interpolated foot has different endpoint or source-interval ownership.');
  const amount=(location.phase-start)/(end-start);let orientation:number[],q:readonly number[],branch:string;
  if(amount===0||amount===1){const endpoint=amount===0?a:b;orientation=[...endpoint.orientation];q=endpoint.quaternion;branch='endpoint';}
  else if(sameValues(a.orientation,b.orientation)){orientation=[...a.orientation];q=a.quaternion;branch='stationary';}
  else {
    const qa=rotationQuaternion(a.orientation),qb=rotationQuaternion(b.orientation);let dot=qa.reduce((sum,v,i)=>sum+v*qb[i],0);
    if(dot<0){for(let i=0;i<4;i++)qb[i]*=-1;dot=-dot;}dot=Math.min(1,Math.max(-1,dot));
    const theta=Math.acos(dot),sine=Math.sin(theta),left=sine<.001?1-amount:Math.sin((1-amount)*theta)/sine,right=sine<.001?amount:Math.sin(amount*theta)/sine;
    q=qa.map((v,i)=>v*left+qb[i]*right);const size=Math.hypot(...q);if(!Number.isFinite(size)||size<=0)throw new Error('Pool interpolated foot has no finite quaternion normalization.');
    const [x,y,z,w]=q.map(v=>v/size);orientation=[1-2*(y*y+z*z),2*(x*y+z*w),2*(x*z-y*w),0,2*(x*y-z*w),1-2*(x*x+z*z),2*(y*z+x*w),0,2*(x*z+y*w),2*(y*z-x*w),1-2*(x*x+y*y),0,a.orientation[12]*(1-amount)+b.orientation[12]*amount,a.orientation[13]*(1-amount)+b.orientation[13]*amount,a.orientation[14]*(1-amount)+b.orientation[14]*amount,1];
    const generic=interpolateTransform(a.orientation,b.orientation,amount);if(!orientation.every((v,i)=>Object.is(v,generic[i])))throw new Error('Pool foot rotation trace differs from the generic interpolation implementation.');branch=sine<.001?'moving-linear':'moving-spherical';
  }
  const target=amount===0?a.target:amount===1?b.target:sameValues(a.target,b.target)?a.target:a.target.map((v,i)=>v+(b.target[i]-v)*amount),reference=properQuaternionReference(q,orientation);
  const token=Object.freeze({kind:'pool-interpolated-foot-rotation' as const});footRotations.set(token,{from,to,control,controlKey:canonicalPoolValue(control),location:Object.freeze({...location}),locationKey:canonicalPoolValue(location),orientation:Object.freeze(orientation),target:Object.freeze([...target]),...reference,branch,amount});return token;
}
export function requirePoolInterpolatedFootRotation(token:PoolInterpolatedFootRotation,bundle:Bundle,geometry:Geometry,fixture:PoolFixtureV1,patch:PreparedPoolPatch,location:PoolSupportLocation,target:readonly number[],orientation:readonly number[],actualInverse:readonly number[]){
  const owner=footRotations.get(token);if(!owner)throw new Error('Pool foot rotation has no private interpolation producer.');
  const from=requireFootEndpoint(owner.from),to=requireFootEndpoint(owner.to);
  if(from.input.bundle!==bundle||to.input.bundle!==bundle||from.input.geometry[0]!==geometry||from.input.fixture!==fixture||from.input.patch!==patch||owner.locationKey!==canonicalPoolValue(location)||owner.controlKey!==canonicalPoolValue(owner.control)||owner.control.from!==from.input.control.state||owner.control.to!==to.input.control.state
      ||!sameValues(target,owner.target)||orientation.length!==owner.orientation.length||orientation.some((v,i)=>!Object.is(v,owner.orientation[i]))||!sameValues(actualInverse,from.inverse)||!sameValues(actualInverse,to.inverse))throw new Error('Pool interpolated foot producer differs from the actual source, controls or metrics.');
  return Object.freeze({numerators:Object.freeze(owner.numerators.map(v=>Object.freeze({...v}))),denominator:Object.freeze({...owner.denominator}),orientationError:Object.freeze([...owner.errors]),branch:owner.branch,amount:owner.amount,interpolationRevision:POOL_INTERPOLATION_REVISION});
}

export interface PoolOrientedLegPlan {
  readonly upper:number;readonly lower:number;readonly end:number;readonly body:number;
  readonly pole:Vec3;readonly localAxis:Vec3;readonly axisInBody:Vec3;
  readonly flexion:number;readonly branch:1|-1;readonly referenceFrame:0;
}
interface LegOwner {pose:PoolHierarchy;frame:PoolFootContactFrame;pole:V;upper:number[];lower:number[];expectedLower:M;initialUpper:M;initialLower:M}
const legOwners=new WeakMap<PoolOrientedLegPlan,LegOwner>();
const detachedTrackedValues=(values:M|V)=>Object.freeze(values.map(entry=>Object.freeze({...entry})));
function trackedHierarchy(pose:PoolHierarchy,rest:M[],inverses:M[],basis:M[]):M[] {
  const world:M[]=[];for(let bone=0;bone<rest.length;bone++){
    const parent=pose.bundle.bones[bone].parent,local=parent<0?rest[bone]:multiply(inverses[parent],rest[bone]),animated=multiply(local,basis[bone]);
    world.push(parent<0?animated:multiply(world[parent],animated));
  }return world;
}

/** A source-derived, oriented leg is a legitimate producer of both coupled joint rotations. */
export function preparePoolOrientedLeg(pose:PoolHierarchy,upper:number,lower:number,end:number,frame:PoolFootContactFrame):PoolOrientedLegPlan {
  requirePoolFootContactFrameInstance(frame,pose.inverse[end],pose.bundle);
  const body=pose.bundle.bones.findIndex(bone=>bone.name==='hips'),side=pose.bundle.bones[lower]?.name.slice(-1);
  if(body<0||pose.bundle.bones[upper]?.name!=='thigh.'+side||pose.bundle.bones[lower]?.name!=='shin.'+side||pose.bundle.bones[end]?.name!=='foot.'+side
      ||pose.bundle.bones[upper].parent!==body||pose.bundle.bones[lower].parent!==upper||pose.bundle.bones[end].parent!==lower||frame.bone!==end)throw new Error('Pool oriented leg requires its actual configured hip, knee and ankle chain.');
  const owned=(values:readonly number[]):M=>{const errors=requirePoolMatrixRepresentation(values);return values.map((value,index)=>({value,error:errors[index]}));};
  const rest=pose.rest.map(owned),inverses=rest.map(inverse),basis=pose.basis.map(owned),world=trackedHierarchy(pose,rest,inverses,basis);
  if(inverses.some((matrix,bone)=>matrix.some((value,index)=>value.value!==pose.inverse[bone][index])))throw new Error('Pool oriented leg has a different configured inverse.');
  if(world.some((matrix,bone)=>matrix.some((value,index)=>value.value!==pose.world[bone][index])))throw new Error('Pool oriented leg has a stale initial hierarchy.');
  const source=pose.bundle.basisActions.pool_enter?.[0];if(!source)throw new Error('Pool oriented leg has no clean standing source frame.');
  const target=frame.translation.map((value,axis)=>({value,error:frame.translationError[axis]})) as unknown as V;
  const result=orientedPoolLegMath({upper,lower,end,body,rest,inverses,basis,world,target,sourceUpper:matrix(source[upper]),sourceLower:matrix(source[lower])});
  pose.basis[upper]=retain(result.upperBasis.map(value=>value.value),result.upperBasis,'oriented-leg');
  pose.basis[lower]=retain(result.lowerBasis.map(value=>value.value),result.lowerBasis,'oriented-leg');
  const expectedWorld=trackedHierarchy(pose,rest,inverses,result.basis);
  pose.world=composeSkeletonPose(pose.bundle.bones,pose.rest,pose.basis);
  if(expectedWorld.some((matrix,bone)=>matrix.some((value,index)=>value.value!==pose.world[bone][index])))throw new Error('Pool oriented leg differs from actual fixed-hierarchy composition.');
  const pole=point(expectedWorld[lower]),values=(vector:V)=>Object.freeze(vector.map(value=>value.value)) as unknown as Vec3;
  const plan=Object.freeze({upper,lower,end,body,pole:values(pole),localAxis:values(result.localAxis),axisInBody:values(result.axisInBody),flexion:result.flexion,branch:result.branch,referenceFrame:0 as const});
  legOwners.set(plan,{pose,frame,pole,upper:[...pose.basis[upper]],lower:[...pose.basis[lower]],expectedLower:result.lowerBasis,initialUpper:result.upperBasis,initialLower:result.lowerBasis});return plan;
}

export function requirePoolOrientedLeg(plan:PoolOrientedLegPlan,pose:PoolHierarchy,frame:PoolFootContactFrame,pole:Vec3) {
  const owner=legOwners.get(plan);
  if(!owner||owner.pose!==pose||owner.frame!==frame||plan.pole.some((value,index)=>value!==pole[index])
      ||owner.upper.some((value,index)=>value!==pose.basis[plan.upper][index])||owner.lower.some((value,index)=>value!==pose.basis[plan.lower][index]))throw new Error('Pool leg has no matching oriented-frame producer.');
  return Object.freeze({pole:detachedTrackedValues(owner.pole) as unknown as V});
}
export function requirePoolOrientedLegReference(plan:PoolOrientedLegPlan,pose:PoolHierarchy,frame:PoolFootContactFrame) {
  const owner=legOwners.get(plan);if(!owner||owner.pose!==pose||owner.frame!==frame)throw new Error('Pool leg has no source-derived oriented frame.');
  return Object.freeze({expectedLower:detachedTrackedValues(owner.expectedLower)});
}

export interface PoolFreeLegPlan extends PoolOrientedLegPlan {readonly target:Vec3}
interface FreeLegOwner {
  pose:PoolHierarchy;source:string;target:Vec3;pole:V;expectedLower:M;
  inputs:{rest:number[];inverse:number[];basis:number[];world:number[]}[];
}
const freeLegOwners=new WeakMap<PoolFreeLegPlan,FreeLegOwner>();
const freeLegSource=(pose:PoolHierarchy)=>JSON.stringify({source:pose.bundle.sourceSha256,bones:pose.bundle.bones,standing:pose.bundle.basisActions.pool_enter?.[0]});

/** A free leg has an explicit source goal and no nominal support-plane authority. */
export function preparePoolFreeLeg(pose:PoolHierarchy,upper:number,lower:number,end:number,target:Vec3):PoolFreeLegPlan {
  const body=pose.bundle.bones.findIndex(bone=>bone.name==='hips'),side=pose.bundle.bones[lower]?.name.slice(-1);
  if(body<0||pose.bundle.bones[upper]?.name!=='thigh.'+side||pose.bundle.bones[lower]?.name!=='shin.'+side||pose.bundle.bones[end]?.name!=='foot.'+side
      ||pose.bundle.bones[upper].parent!==body||pose.bundle.bones[lower].parent!==upper||pose.bundle.bones[end].parent!==lower||target.length!==3||target.some(value=>!Number.isFinite(value)))throw new Error('Pool free leg requires its actual configured source chain and finite goal.');
  const owned=(values:readonly number[]):M=>{const errors=requirePoolMatrixRepresentation(values);return values.map((value,index)=>({value,error:errors[index]}));};
  const rest=pose.rest.map(owned),inverses=rest.map(inverse),basis=pose.basis.map(owned),world=trackedHierarchy(pose,rest,inverses,basis);
  if(inverses.some((matrix,bone)=>matrix.some((value,index)=>value.value!==pose.inverse[bone][index]))||world.some((matrix,bone)=>matrix.some((value,index)=>value.value!==pose.world[bone][index])))throw new Error('Pool free leg has a stale configured hierarchy.');
  const source=pose.bundle.basisActions.pool_enter?.[0];if(!source)throw new Error('Pool free leg has no clean standing source frame.');
  const result=orientedPoolLegMath({upper,lower,end,body,rest,inverses,basis,world,target:vector(target),sourceUpper:matrix(source[upper]),sourceLower:matrix(source[lower])});
  pose.basis[upper]=retain(result.upperBasis.map(value=>value.value),result.upperBasis,'oriented-leg');
  pose.basis[lower]=retain(result.lowerBasis.map(value=>value.value),result.lowerBasis,'oriented-leg');
  const expectedWorld=trackedHierarchy(pose,rest,inverses,result.basis);pose.world=composeSkeletonPose(pose.bundle.bones,pose.rest,pose.basis);
  if(expectedWorld.some((matrix,bone)=>matrix.some((value,index)=>value.value!==pose.world[bone][index])))throw new Error('Pool free leg differs from actual fixed-hierarchy composition.');
  const values=(value:V)=>Object.freeze(value.map(entry=>entry.value)) as unknown as Vec3,pole=point(expectedWorld[lower]);
  const plan=Object.freeze({upper,lower,end,body,pole:values(pole),target:Object.freeze([...target]) as unknown as Vec3,localAxis:values(result.localAxis),axisInBody:values(result.axisInBody),flexion:result.flexion,branch:result.branch,referenceFrame:0 as const});
  freeLegOwners.set(plan,{pose,source:freeLegSource(pose),target:[...target],pole,expectedLower:result.lowerBasis,inputs:pose.rest.map((rest,bone)=>({rest:[...rest],inverse:[...pose.inverse[bone]],basis:[...pose.basis[bone]],world:[...pose.world[bone]]}))});return plan;
}

/** Expose detached immutable arithmetic values, never the writable private owner record. */
export function requirePoolFreeLegPlan(plan:PoolFreeLegPlan,pose:PoolHierarchy,target:Vec3) {
  const owner=freeLegOwners.get(plan);
  if(!owner||owner.pose!==pose||owner.source!==freeLegSource(pose)||owner.target.some((value,axis)=>value!==target[axis])
      ||owner.inputs.some((input,bone)=>input.rest.some((value,at)=>value!==pose.rest[bone][at])||input.inverse.some((value,at)=>value!==pose.inverse[bone][at])||input.basis.some((value,at)=>value!==pose.basis[bone][at])||input.world.some((value,at)=>value!==pose.world[bone][at])))throw new Error('Pool free leg has no unchanged source-goal producer.');
  const copy=(value:M|V)=>Object.freeze(value.map(entry=>Object.freeze({...entry})));
  return Object.freeze({pole:copy(owner.pole),expectedLower:copy(owner.expectedLower)});
}
