import {validatePreparationRequest,validatePreparationResponse,type PreparationRequest,type PreparationResponse} from './preparation-protocol.js';
export interface PreparationTransport {run(request:PreparationRequest):Promise<PreparationResponse>;dispose():void}
export class WorkerPreparationTransport implements PreparationTransport {
  private readonly worker:Worker;
  private pending:{request:PreparationRequest;resolve:(value:PreparationResponse)=>void;reject:(error:unknown)=>void}|undefined;
  private closed=false;
  constructor(){
    this.worker=new Worker(new URL('./preparation-worker.ts',import.meta.url),{type:'module',name:'character-preparation'});
    this.worker.onmessage=event=>{
      if(this.closed)return;
      try{validatePreparationResponse(event.data);const pending=this.pending;
        if(!pending||pending.request.id!==event.data.id||pending.request.kind!==event.data.kind)throw new Error('Character preparation response does not match its request.');
        this.pending=undefined;pending.resolve(event.data);
      }catch(error){this.fail(error);}
    };
    this.worker.onerror=event=>{event.preventDefault();this.fail(Object.assign(new Error(event.message||'The character preparation worker failed.'),{
      workerStack:event.error?.stack,workerErrorName:event.error?.name||'WorkerError',workerSource:{path:event.filename,line:event.lineno,column:event.colno},
    }));};
    this.worker.onmessageerror=()=>this.fail(new Error('The character preparation worker returned an unreadable message.'));
  }
  run(request:PreparationRequest):Promise<PreparationResponse>{
    if(this.closed)return Promise.reject(new Error('The character preparation worker is closed.'));
    if(this.pending)return Promise.reject(new Error('The character preparation worker already has a request.'));
    validatePreparationRequest(request);
    return new Promise((resolve,reject)=>{this.pending={request,resolve,reject};try{this.worker.postMessage(request);}catch(error){this.fail(error);}});
  }
  private fail(error:unknown):void {const pending=this.pending;this.pending=undefined;this.closed=true;this.worker.terminate();pending?.reject(error);}
  dispose():void {if(this.closed)return;const error=new Error('Character preparation was disposed.');error.name='AbortError';this.fail(error);}
}
