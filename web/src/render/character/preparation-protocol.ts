import type {BikeContactInputV1,BikeContactArtifactV1} from './bike-contact-types.js';
import type {SleepContactInputV1,SleepContactArtifactV1} from './sleep-contact-types.js';
import {validateBikeContactInput,validateBikeContactArtifact} from './bike-contact-protocol.js';
import {validateSleepContactInput,validateSleepContactArtifact} from './sleep-contact-protocol.js';
import type {SeatContactInputV1,SeatContactArtifactV1} from './seat-contact-types.js';
import {validateSeatContactInput,validateSeatContactArtifact} from './seat-contact-protocol.js';
export type PreparationKind='bike'|'sleep'|'seat';
export type PreparationArtifact=BikeContactArtifactV1|SleepContactArtifactV1|SeatContactArtifactV1;
export type PreparationRequest={version:1;id:number}&({kind:'bike';input:BikeContactInputV1}|{kind:'sleep';input:SleepContactInputV1}|{kind:'seat';input:SeatContactInputV1});
export type PreparationResponse={version:1;id:number;kind:PreparationKind}&({ok:true;artifact:PreparationArtifact}|{ok:false;error:string;errorName?:string;workerStack?:string});
function header(value:unknown):Record<string,unknown>{
  if(!value||typeof value!=='object')throw new Error('Invalid character preparation message.');const row=value as Record<string,unknown>;
  if(row.version!==1||!Number.isSafeInteger(row.id)||(row.id as number)<1||(row.kind!=='bike'&&row.kind!=='sleep'&&row.kind!=='seat'))throw new Error('Invalid character preparation header.');return row;
}
export function validatePreparationRequest(value:unknown):asserts value is PreparationRequest {
  const row=header(value);if(row.kind==='bike')validateBikeContactInput(row.input);else if(row.kind==='sleep')validateSleepContactInput(row.input);else validateSeatContactInput(row.input);
}
export function validatePreparationResponse(value:unknown):asserts value is PreparationResponse {
  const row=header(value);if(row.ok===true){if(row.kind==='bike')validateBikeContactArtifact(row.artifact);else if(row.kind==='sleep')validateSleepContactArtifact(row.artifact);else validateSeatContactArtifact(row.artifact);}
  else if(row.ok!==false||typeof row.error!=='string'||!row.error.length)throw new Error('Invalid character preparation response.');
  else if((row.errorName!==undefined&&(typeof row.errorName!=='string'||row.errorName.length>256))
    ||(row.workerStack!==undefined&&(typeof row.workerStack!=='string'||row.workerStack.length>65536)))throw new Error('Invalid character preparation error diagnostics.');
}
