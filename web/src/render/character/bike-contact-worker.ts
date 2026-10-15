/// <reference lib="webworker" />
import {compileBikeContact} from './bike-contact-compile.js';
import {validateBikeContactRequest,verifyBikeContactInput,type BikeContactWorkerResponse} from './bike-contact-protocol.js';

const worker=self as unknown as DedicatedWorkerGlobalScope;
let busy=false;
worker.onmessage=async(event:MessageEvent<unknown>)=>{
  let id=0,ownsRequest=false;
  try{
    validateBikeContactRequest(event.data);id=event.data.id;
    if(busy)throw new Error('The bike contact worker already has a request.');
    busy=true;ownsRequest=true;
    await verifyBikeContactInput(event.data.input);
    const artifact=compileBikeContact(event.data.input);
    worker.postMessage({version:1,id,ok:true,artifact} satisfies BikeContactWorkerResponse);
  }catch(error){
    worker.postMessage({version:1,id,ok:false,error:error instanceof Error?error.message:String(error)});
  }finally{if(ownsRequest)busy=false;}
};
