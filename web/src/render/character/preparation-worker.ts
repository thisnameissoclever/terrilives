/// <reference lib="webworker" />
import {preparePoolContact} from './pool-contact-preparation.js';
import {compileBikeContact} from './bike-contact-compile.js';
import {verifyBikeContactInput} from './bike-contact-protocol.js';
import {prepareSleepContact} from './sleep-contact-preparation.js';
import {prepareSeatContact} from './seat-contact-preparation.js';
import {validatePreparationRequest,type PreparationRequest,type PreparationResponse,type PreparationKind} from './preparation-protocol.js';
import {preparationFailure} from './preparation-error.js';
const worker=self as unknown as DedicatedWorkerGlobalScope;
let busy=false;
worker.onmessage=async(event:MessageEvent<unknown>)=>{
  let id=0,kind:PreparationKind='bike',ownsRequest=false;
  let request:PreparationRequest|undefined,operation='validatePreparationRequest';
  try{
    validatePreparationRequest(event.data);request=event.data;({id,kind}=request);
    operation='acquirePreparationWorker';
    if(busy)throw new Error('Character preparation already has an active request.');busy=true;ownsRequest=true;
    let artifact;
    if(request.kind==='bike'){operation='verifyBikeContactInput';await verifyBikeContactInput(request.input);operation='compileBikeContact';artifact=compileBikeContact(request.input);}
    else if(request.kind==='sleep'){operation='prepareSleepContact';artifact=await prepareSleepContact(request.input);}
    else if(request.kind==='seat'){operation='prepareSeatContact';artifact=await prepareSeatContact(request.input);}
    else {operation='preparePoolContact';artifact=await preparePoolContact(request.input);}
    operation='postMessage';
    worker.postMessage({version:1,id,kind,ok:true,artifact} satisfies PreparationResponse);
  }catch(error){worker.postMessage({version:1,id,kind,ok:false,...preparationFailure(error,{operation,
    ...(request?{requestId:request.id,resource:request.kind,inputKey:request.input.key}:{})})} satisfies PreparationResponse);}
  finally{if(ownsRequest)busy=false;}
};
