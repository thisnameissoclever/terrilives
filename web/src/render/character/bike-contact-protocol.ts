import {BIKE_CONTACT_SOLVER_REVISION,type BikeContactArtifactV1,type BikeContactInputDataV1,type BikeContactInputV1,type BikeFit} from './bike-contact-types.js';

function record(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid bike contact record.');return value as Record<string,unknown>;}
function text(value:unknown):asserts value is string {if(typeof value!=='string'||value.length===0||value.length>4096)throw new Error('Invalid bike contact identifier.');}
function finite(value:unknown):asserts value is number {if(typeof value!=='number'||!Number.isFinite(value))throw new Error('Bike contact values must be finite.');}
function numbers(value:unknown,count:number):asserts value is number[]{
  if(!Array.isArray(value)||value.length!==count)throw new Error('Invalid bike contact vector.');
  for(let i=0;i<count;i++){if(!Object.hasOwn(value,i))throw new Error('Sparse bike contact vectors are invalid.');finite(value[i]);}
}
function points(value:unknown):asserts value is number[][] {
  if(!Array.isArray(value)||value.length<1||value.length>65536)throw new Error('Invalid bike contact point count.');
  for(const point of value)numbers(point,3);
}
function surface(value:unknown):void {
  const row=record(value);points(row.points);
  if(!Array.isArray(row.triangles)||row.triangles.length<1||row.triangles.length>131072)throw new Error('Invalid bike contact triangle count.');
  const count=row.points.length;
  for(const triangle of row.triangles){numbers(triangle,3);if(triangle.some(index=>!Number.isInteger(index)||index<0||index>=count))throw new Error('Invalid bike contact triangle index.');}
}
function header(value:unknown):Record<string,unknown>{
  const row=record(value);if(row.version!==1||row.solverRevision!==BIKE_CONTACT_SOLVER_REVISION)throw new Error('Unsupported bike contact version.');
  const revisions=record(row.revisions);text(revisions.source);text(revisions.fixture);text(revisions.shoes);text(row.shapeKey);text(row.shoeKey);return row;
}
export function validateBikeContactInputData(value:unknown):asserts value is BikeContactInputDataV1 {
  const row=header(value);finite(row.sourcePhase);numbers(row.hip,3);surface(row.hipSurface);surface(row.saddle);
  if(!Array.isArray(row.soles)||row.soles.length!==2)throw new Error('Bike contacts require two soles.');
  for(const value of row.soles){const sole=record(value);points(sole.points);numbers(sole.source,16);}
  if(!Array.isArray(row.thighOffsets)||row.thighOffsets.length!==2)throw new Error('Bike contacts require two thighs.');
  for(const point of row.thighOffsets)numbers(point,3);numbers(row.legLengths,2);
  if(row.legLengths.some(value=>value<=0))throw new Error('Bike leg lengths must be positive.');
  const dimensions=record(row.dimensions);numbers(dimensions.axle,3);
  for(const key of ['radius','halfSpacing','pedalTop','flywheelFace'])finite(dimensions[key]);
  if((dimensions.radius as number)<=0||(dimensions.halfSpacing as number)<=0)throw new Error('Invalid bike dimensions.');
}
function key(value:unknown):asserts value is string {if(typeof value!=='string'||!/^bike-v1:[a-f0-9]{64}$/.test(value))throw new Error('Invalid bike contact key.');}
export function validateBikeContactInput(value:unknown):asserts value is BikeContactInputV1 {
  validateBikeContactInputData(value);if(value.sourcePhase!==0)throw new Error('Admitted bike contacts require authored phase zero.');key(record(value).key);
}
export function validateBikeFit(value:unknown):asserts value is BikeFit {
  const row=record(value);numbers(row.hip,3);numbers(row.pelvisRotation,16);finite(row.pitch);finite(row.reachMargin);
  if(!Number.isInteger(row.supportSamples)||(row.supportSamples as number)<8)throw new Error('Invalid bike support count.');
  if(row.hipCycle!==undefined){if(!Array.isArray(row.hipCycle)||row.hipCycle.length!==64)throw new Error('Invalid bike contact cycle.');for(const point of row.hipCycle)numbers(point,3);}
  if(!Array.isArray(row.feet)||row.feet.length!==2)throw new Error('Bike contacts require two feet.');
  for(const value of row.feet){const foot=record(value);numbers(foot.rotation,16);numbers(foot.offset,3);numbers(foot.contact,3);}
}
export function validateBikeContactArtifact(value:unknown):asserts value is BikeContactArtifactV1 {
  const row=header(value);if(row.sourcePhase!==0)throw new Error('Admitted bike contacts require authored phase zero.');key(row.key);validateBikeFit(row.fit);
}
function canonical(value:unknown):string {
  if(typeof value==='number'){finite(value);return Object.is(value,-0)?'-0':String(value);}
  if(typeof value==='string'||typeof value==='boolean'||value===null)return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  const row=record(value);return '{'+Object.keys(row).sort().map(key=>JSON.stringify(key)+':'+canonical(row[key])).join(',')+'}';
}
/** Stable content addressing includes signed zero, all geometry, and declared source revisions. */
export async function makeBikeContactInput(data:BikeContactInputDataV1):Promise<BikeContactInputV1> {
  validateBikeContactInputData(data);
  if(data.sourcePhase!==0)throw new Error('Admitted bike contacts require authored phase zero.');
  const bytes=new TextEncoder().encode(canonical(data)),digest=await crypto.subtle.digest('SHA-256',bytes);
  const key='bike-v1:'+Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');
  return {...data,sourcePhase:0,key};
}
export async function verifyBikeContactInput(input:BikeContactInputV1):Promise<void> {
  validateBikeContactInput(input);const {key,...data}=input;
  if((await makeBikeContactInput(data)).key!==key)throw new Error('Bike contact input key does not match its contents.');
}
export function freezeBikeContactArtifact(artifact:BikeContactArtifactV1):BikeContactArtifactV1 {
  validateBikeContactArtifact(artifact);
  const freeze=(value:unknown):void=>{if(!value||typeof value!=='object'||Object.isFrozen(value))return;for(const child of Object.values(value))freeze(child);Object.freeze(value);};
  freeze(artifact);return artifact;
}

export interface BikeContactWorkerRequest {version:1;id:number;input:BikeContactInputV1}
export type BikeContactWorkerResponse={version:1;id:number;ok:true;artifact:BikeContactArtifactV1}|{version:1;id:number;ok:false;error:string};
export function validateBikeContactRequest(value:unknown):asserts value is BikeContactWorkerRequest {
  const row=record(value);if(row.version!==1||!Number.isSafeInteger(row.id)||(row.id as number)<1)throw new Error('Invalid bike contact request.');validateBikeContactInput(row.input);
}
export function validateBikeContactResponse(value:unknown):asserts value is BikeContactWorkerResponse {
  const row=record(value);if(row.version!==1||!Number.isSafeInteger(row.id)||(row.id as number)<1||typeof row.ok!=='boolean')throw new Error('Invalid bike contact response.');
  if(row.ok)validateBikeContactArtifact(row.artifact);else text(row.error);
}
