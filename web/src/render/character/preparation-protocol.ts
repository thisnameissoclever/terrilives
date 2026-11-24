import type {PoolContactInputV1,PoolPlayback} from './pool-contact-types.js';
import {validatePoolContactInput,freezePoolPlayback} from './pool-contact-protocol.js';
import type {BikeContactInputV1,BikeContactArtifactV1} from './bike-contact-types.js';
import type {SleepContactInputV1,SleepContactArtifactV1} from './sleep-contact-types.js';
import {validateBikeContactInput,validateBikeContactArtifact} from './bike-contact-protocol.js';
import {validateSleepContactInput,validateSleepContactArtifact} from './sleep-contact-protocol.js';
import type {SeatContactInputV1,SeatContactArtifactV1} from './seat-contact-types.js';
import {validateSeatContactInput,validateSeatContactArtifact} from './seat-contact-protocol.js';
import {validatePreparationErrorDetails,preparationDiagnosticMessage,requirePreparationDiagnosticKeys,type PreparationErrorDetails,type PreparationErrorContext} from './preparation-error.js';
export type PreparationKind='bike'|'sleep'|'seat'|'pool';
export type PreparationArtifact=BikeContactArtifactV1|SleepContactArtifactV1|SeatContactArtifactV1|PoolPlayback;
export type PreparationRequest={version:1;id:number}&({kind:'bike';input:BikeContactInputV1}|{kind:'sleep';input:SleepContactInputV1}|{kind:'seat';input:SeatContactInputV1}|{kind:'pool';input:PoolContactInputV1});
export type PreparationResponse={version:1;id:number;kind:PreparationKind}&({ok:true;artifact:PreparationArtifact}|{ok:false;error:string;errorName?:string;workerStack?:string;errorDetails?:PreparationErrorDetails;workerContext?:PreparationErrorContext});
function header(value:unknown):Record<string,unknown>{
  if(!value||typeof value!=='object')throw new Error('Invalid character preparation message.');const row=value as Record<string,unknown>;
  if(row.version!==1||!Number.isSafeInteger(row.id)||(row.id as number)<1||(row.kind!=='bike'&&row.kind!=='sleep'&&row.kind!=='seat'&&row.kind!=='pool'))throw new Error('Invalid character preparation header.');return row;
}
export function validatePreparationRequest(value:unknown):asserts value is PreparationRequest {
  const row=header(value);if(row.kind==='bike')validateBikeContactInput(row.input);else if(row.kind==='sleep')validateSleepContactInput(row.input);else if(row.kind==='seat')validateSeatContactInput(row.input);else validatePoolContactInput(row.input);
}
export function validatePreparationResponse(value:unknown):asserts value is PreparationResponse {
  const row=header(value);if(row.ok===true){if(row.kind==='bike')validateBikeContactArtifact(row.artifact);else if(row.kind==='sleep')validateSleepContactArtifact(row.artifact);else if(row.kind==='seat')validateSeatContactArtifact(row.artifact);else freezePoolPlayback(row.artifact);}
  else if(row.ok!==false||typeof row.error!=='string'||!row.error.length&&row.errorDetails===undefined)throw new Error('Invalid character preparation response.');
  else if((row.errorName!==undefined&&(typeof row.errorName!=='string'||row.errorName.length>256))
    ||(row.workerStack!==undefined&&(typeof row.workerStack!=='string'||row.workerStack.length>65536)))throw new Error('Invalid character preparation error diagnostics.');
  if(row.ok===false&&row.errorDetails!==undefined){
    validatePreparationErrorDetails(row.errorDetails);
    if(row.errorDetails.kind==='error'&&(preparationDiagnosticMessage(row.errorDetails)!==row.error
        ||row.errorName!==undefined&&row.errorName!==row.errorDetails.name||row.workerStack!==undefined&&row.workerStack!==row.errorDetails.stack))throw new Error('Inconsistent character preparation error diagnostics.');
  }
  if(row.ok===false&&row.workerContext!==undefined){
    const context=row.workerContext as Record<string,unknown>;
    requirePreparationDiagnosticKeys(context,['operation','requestId','resource','inputKey']);
    if(!context||typeof context!=='object'||Array.isArray(context)||typeof context.operation!=='string'||!context.operation.length||context.operation.length>128
        ||context.requestId!==undefined&&context.requestId!==row.id||context.resource!==undefined&&context.resource!==row.kind
        ||context.inputKey!==undefined&&(typeof context.inputKey!=='string'||context.inputKey.length>32768))throw new Error('Invalid character preparation error diagnostics.');
  }
}
