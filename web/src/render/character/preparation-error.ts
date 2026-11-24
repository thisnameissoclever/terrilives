import type {PreparationRequest,PreparationKind} from './preparation-protocol.js';
import {isPreparationCancelled} from './preparation-abort.js';

import {serializeErrorDetails,validateErrorDetails,diagnosticMessage,requireDiagnosticKeys,restoreErrorDetails,copyOriginalError as copyDiagnosticError,type ErrorDetails} from '../../diagnostics/error-details.js';

export type PreparationErrorDetails=ErrorDetails;
export interface PreparationErrorContext {operation:string;requestId?:number;resource?:PreparationKind;inputKey?:string}
const FAILURE='Character preparation failed.',INVALID='Invalid character preparation error diagnostics.',MESSAGE=16384;
const clipped=(value:string,size:number)=>value.slice(0,size);
export function serializePreparationError(value:unknown):PreparationErrorDetails {return serializeErrorDetails(value);}
export function validatePreparationErrorDetails(value:unknown):asserts value is PreparationErrorDetails {validateErrorDetails(value,INVALID);}
export function preparationDiagnosticMessage(details:PreparationErrorDetails):string {return diagnosticMessage(details,FAILURE);}
export function requirePreparationDiagnosticKeys(value:unknown,allowed:readonly string[]):asserts value is Record<string,unknown> {requireDiagnosticKeys(value,allowed,INVALID);}
function restore(value:PreparationErrorDetails):unknown {return restoreErrorDetails(value,FAILURE);}
function setConservedStack(error:Error,stack:string|undefined):void {Object.defineProperty(error,'stack',{value:stack,writable:true,configurable:true});}

export function preparationFailure(error:unknown,context:PreparationErrorContext){
  const errorDetails=serializePreparationError(error);
  return {error:preparationDiagnosticMessage(errorDetails),errorName:errorDetails.kind==='error'?errorDetails.name:undefined,
    workerStack:errorDetails.kind==='error'?errorDetails.stack:undefined,errorDetails,workerContext:context};
}

const contexts=new WeakMap<Error,PreparationErrorContext>();
export function attachPreparationContext(value:unknown,request:PreparationRequest,operation:string):Error {
  let error=value instanceof Error?value:new Error(preparationDiagnosticMessage(serializePreparationError(value)));
  if(isPreparationCancelled(error))return error;
  if(!Object.isExtensible(error))error=copyOriginalError(error);
  const current=contexts.get(error),matches=current?.requestId===request.id&&current.resource===request.kind&&current.inputKey===request.input.key;
  const context={requestId:request.id,resource:request.kind,inputKey:request.input.key,operation:matches?current.operation:operation};
  contexts.set(error,context);Object.assign(error,{preparation:context});return error;
}

export function restorePreparationFailure(response:{error:string;errorName?:string;workerStack?:string;errorDetails?:PreparationErrorDetails;workerContext?:PreparationErrorContext},request:PreparationRequest):Error {
  if(response.workerContext?.inputKey!==undefined&&response.workerContext.inputKey!==request.input.key)throw new Error('Character preparation error diagnostics do not match their input.');
  const restored=response.errorDetails?restore(response.errorDetails):undefined;
  const error=restored instanceof Error?restored:new Error(response.error);
  if(response.errorName!==undefined)error.name=response.errorName;setConservedStack(error,response.workerStack??(response.errorDetails?.kind==='error'?response.errorDetails.stack:undefined));
  Object.assign(error,{workerStack:response.workerStack,workerErrorName:response.errorName,workerKind:request.kind,workerErrorDetails:response.errorDetails});
  if(response.workerContext){Object.assign(error,{preparation:response.workerContext});contexts.set(error,response.workerContext);}
  if(response.errorDetails&&response.errorDetails.kind!=='error')Object.assign(error,{workerThrownValue:restored});
  return attachPreparationContext(error,request,'worker-response');
}

export function preparationErrorEvent(event:ErrorEvent):Error {
  let error=event.error instanceof Error?event.error:new Error(event.message||'The character preparation worker failed.');
  if(!Object.isExtensible(error))error=copyOriginalError(error);
  const metadata={...(event.message?{message:clipped(event.message,MESSAGE)}:{}),...(event.filename?{filename:clipped(event.filename,2048)}:{}),
    ...(Number.isFinite(event.lineno)&&event.lineno>0?{lineno:event.lineno}:{}),...(Number.isFinite(event.colno)&&event.colno>0?{colno:event.colno}:{})};
  Object.assign(error,{workerEvent:metadata,...(event.error!==undefined&&event.error!==null&&!(event.error instanceof Error)?{workerThrownValue:event.error}:{})});return error;
}

function copyOriginalError(original:Error):Error {return copyDiagnosticError(original,FAILURE);}
