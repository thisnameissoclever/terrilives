import {validatePreparationRequest,validatePreparationResponse,type PreparationRequest,type PreparationResponse} from './preparation-protocol.js';
import {preparationCancelled} from './preparation-abort.js';
import {preparationErrorEvent,attachPreparationContext} from './preparation-error.js';
export interface PreparationTransport {run(request:PreparationRequest,signal?:AbortSignal):Promise<PreparationResponse>;dispose():void}
export class WorkerPreparationTransport implements PreparationTransport {
  private readonly worker:Worker;
  private pending:{request:PreparationRequest;resolve:(value:PreparationResponse)=>void;reject:(error:unknown)=>void;detach:()=>void}|undefined;
  private closed=false;
  constructor(){
    this.worker=new Worker(new URL('./preparation-worker.ts',import.meta.url),{type:'module',name:'character-preparation'});
    this.worker.onmessage=event=>{
      if(this.closed)return;
      try{validatePreparationResponse(event.data);const pending=this.pending;
        if(!pending||pending.request.id!==event.data.id||pending.request.kind!==event.data.kind)throw new Error('Character preparation response does not match its request.');
        this.pending=undefined;pending.detach();pending.resolve(event.data);
      }catch(error){this.fail(error);}
    };
    this.worker.onerror=event=>{
      if(this.closed){event.preventDefault();return;}
      if(this.pending)event.preventDefault();
      this.fail(preparationErrorEvent(event),'worker-error-event');
    };
    this.worker.onmessageerror=()=>this.fail(new Error('The character preparation worker returned an unreadable message.'));
  }
  run(request:PreparationRequest,signal?:AbortSignal):Promise<PreparationResponse>{
    if(signal?.aborted)return Promise.reject(preparationCancelled());
    if(this.closed)return Promise.reject(new Error('The character preparation worker is closed.'));
    if(this.pending)return Promise.reject(new Error('The character preparation worker already has a request.'));
    validatePreparationRequest(request);
    return new Promise((resolve,reject)=>{
      const pending={request,resolve,reject,detach:()=>signal?.removeEventListener('abort',abort)};
      const abort=()=>{if(this.pending===pending)this.fail(preparationCancelled());};
      this.pending=pending;signal?.addEventListener('abort',abort,{once:true});
      try{this.worker.postMessage(request);}catch(error){this.fail(error);}
    });
  }
  private fail(error:unknown,operation='worker-transport'):void {if(this.closed)return;const pending=this.pending;this.pending=undefined;pending?.detach();this.closed=true;this.worker.terminate();pending?.reject(pending?attachPreparationContext(error,pending.request,operation):error);}
  dispose():void {if(this.closed)return;const error=new Error('Character preparation was disposed.');error.name='AbortError';this.fail(error);}
}
