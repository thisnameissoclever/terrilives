/// <reference lib="webworker" />
import {compileBikeContact} from './bike-contact-compile.js';
import {verifyBikeContactInput} from './bike-contact-protocol.js';
import {prepareSleepContact} from './sleep-contact-preparation.js';
import {validatePreparationRequest,type PreparationResponse} from './preparation-protocol.js';
const worker=self as unknown as DedicatedWorkerGlobalScope;
let busy=false;
worker.onmessage=async(event:MessageEvent<unknown>)=>{
  let id=0,kind:'bike'|'sleep'='bike',ownsRequest=false;
  try{
    validatePreparationRequest(event.data);({id,kind}=event.data);
    if(busy)throw new Error('Character preparation already has an active request.');busy=true;ownsRequest=true;
    let artifact;
    if(event.data.kind==='bike'){await verifyBikeContactInput(event.data.input);artifact=compileBikeContact(event.data.input);}
    else artifact=await prepareSleepContact(event.data.input);
    worker.postMessage({version:1,id,kind,ok:true,artifact} satisfies PreparationResponse);
  }catch(error){worker.postMessage({version:1,id,kind,ok:false,error:error instanceof Error?error.message:String(error),
    errorName:error instanceof Error?error.name.slice(0,256):undefined,workerStack:error instanceof Error?error.stack?.slice(0,65536):undefined} satisfies PreparationResponse);}
  finally{if(ownsRequest)busy=false;}
};
