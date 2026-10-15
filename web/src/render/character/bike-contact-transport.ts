import {validateBikeContactRequest,validateBikeContactResponse,type BikeContactWorkerRequest,type BikeContactWorkerResponse} from './bike-contact-protocol.js';

export interface BikeContactTransport {
  run(request:BikeContactWorkerRequest):Promise<BikeContactWorkerResponse>;
  dispose():void;
}

/** One worker accepts one job at a time; the owner service coalesces its queue. */
export class WorkerBikeContactTransport implements BikeContactTransport {
  private readonly worker:Worker;
  private pending:{id:number;resolve:(result:BikeContactWorkerResponse)=>void;reject:(error:unknown)=>void}|undefined;
  private closed=false;
  constructor(){
    this.worker=new Worker(new URL('./bike-contact-worker.ts',import.meta.url),{type:'module',name:'bike-contact-compiler'});
    this.worker.onmessage=event=>{
      if(this.closed)return;
      try{
        validateBikeContactResponse(event.data);
        const pending=this.pending;if(!pending||pending.id!==event.data.id)throw new Error('Bike contact response does not match its request.');
        this.pending=undefined;pending.resolve(event.data);
      }catch(error){this.fail(error);}
    };
    this.worker.onerror=event=>{event.preventDefault();this.fail(new Error(event.message||'The bike contact worker failed.'));};
    this.worker.onmessageerror=()=>this.fail(new Error('The bike contact worker returned an unreadable message.'));
  }
  run(request:BikeContactWorkerRequest):Promise<BikeContactWorkerResponse>{
    if(this.closed)return Promise.reject(new Error('The bike contact worker is closed.'));
    if(this.pending)return Promise.reject(new Error('The bike contact worker already has a request.'));
    validateBikeContactRequest(request);
    return new Promise((resolve,reject)=>{
      this.pending={id:request.id,resolve,reject};
      try{this.worker.postMessage(request);}catch(error){this.fail(error);}
    });
  }
  private fail(error:unknown):void {
    const pending=this.pending;this.pending=undefined;this.closed=true;this.worker.terminate();pending?.reject(error);
  }
  dispose():void {if(this.closed)return;const error=new Error('Bike contact compilation was disposed.');error.name='AbortError';this.fail(error);}
}
