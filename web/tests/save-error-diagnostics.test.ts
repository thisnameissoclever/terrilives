import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createSaveStore} from '../src/storage/save-store.js';
import {CURRENT_SAVE_VERSION} from '../src/storage/save-header.js';
import {PersistenceController,type PersistableSim} from '../src/ui/persistence-controller.js';

const currentBytes=new Uint8Array([84,69,82,82,73,83,65,86,CURRENT_SAVE_VERSION,0,17]);
type Reply={id:number;ok:boolean;error?:string;errorDetails?:unknown;workerContext?:unknown};
type Failure=Error&{persistence?:{operation:string;requestId:number};workerErrorDetails?:Record<string,unknown>;workerThrownValue?:unknown;workerResponseDetails?:unknown};
let scope:{onmessage:((event:MessageEvent)=>void)|null;postMessage(reply:Reply):void};
let failure:unknown,failStorage=false;
let transform:((reply:Reply)=>unknown)|undefined;
let escaped:unknown[],requests:{id:number;kind:string}[];
class Peer {
  static current:Peer;
  private readonly listeners=new Map<string,((event:any)=>void)[]>();
  constructor(){Peer.current=this;}
  addEventListener(kind:string,listener:(event:any)=>void){const list=this.listeners.get(kind)??[];list.push(listener);this.listeners.set(kind,list);}
  postMessage(request:{id:number;kind:string}){requests.push(request);scope.onmessage!({data:structuredClone(request)} as MessageEvent);}
  receive(reply:unknown){try{for(const listener of this.listeners.get('message')??[])listener({data:reply});}catch(error){escaped.push(error);}}
  error(event:ErrorEvent){for(const listener of this.listeners.get('error')??[])listener(event);}
  messageerror(){for(const listener of this.listeners.get('messageerror')??[])listener({});}
  terminate(){}
}
function status(){const attributes=new Map<string,string>();return {textContent:'',attributes,setAttribute(name:string,value:string){attributes.set(name,value);},removeAttribute(name:string){attributes.delete(name);}};}
function simulation():PersistableSim{return {saveBytes:()=>currentBytes,loadBytes:()=>true,clockTick:()=>0,dayTicks:()=>100};}
async function rejected(promise:Promise<unknown>):Promise<Failure>{
  let settled=false,result:unknown;void promise.then(value=>{settled=true;result=value;},error=>{settled=true;result=error;});
  await vi.waitFor(()=>expect(settled).toBe(true),{interval:1,timeout:1000});expect(result).toBeInstanceOf(Error);return result as Failure;
}
beforeEach(async()=>{
  failure=undefined;failStorage=false;transform=undefined;escaped=[];requests=[];
  scope={onmessage:null,postMessage(reply){const cloned=structuredClone(reply);Peer.current.receive(transform?transform(cloned):cloned);}};
  vi.stubGlobal('self',scope);vi.stubGlobal('Worker',Peer);
  vi.stubGlobal('navigator',{locks:{request:async(_name:string,run:()=>Promise<void>)=>run()},storage:{getDirectory:async()=>{
    if(failStorage)throw failure;
    return {getFileHandle:async()=>{throw new DOMException('Missing','NotFoundError');},removeEntry:async()=>{}};
  }}});
  vi.resetModules();await import('../src/storage/save-worker.js');
});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});

it.each(['save','load','clear'] as const)('publishes one %s failure with the original native worker Error, nested cause and operation',async operation=>{
  const leaf=new TypeError('Filesystem rejected access'),original=new RangeError('Storage operation failed',{cause:leaf});
  const stack=original.stack,causeStack=leaf.stack;failure=original;failStorage=true;
  const publish=vi.spyOn(console,'error').mockImplementation(()=>{}),warning=vi.spyOn(console,'warn').mockImplementation(()=>{});
  const report=vi.fn(error=>console.error('Save/load failed',error)),store=createSaveStore(),view=status();
  const controller=new PersistenceController(store,simulation(),view,report);
  try{
    expect(await controller[operation]()).toBe(false);
    expect(report).toHaveBeenCalledOnce();expect(publish).toHaveBeenCalledOnce();expect(warning).not.toHaveBeenCalled();
    const received=report.mock.calls[0][0] as Failure;
    expect(received.name).toBe(original.name);expect(received.message).toBe(original.message);expect(received.stack).toBe(stack);
    expect(received.cause).toBeInstanceOf(TypeError);expect((received.cause as Error).message).toBe(leaf.message);expect((received.cause as Error).stack).toBe(causeStack);
    expect(received.persistence).toEqual({operation,requestId:requests[0].id});expect(escaped).toEqual([]);
    expect(view.textContent).not.toMatch(/still running|\bkept\b/);
    if(operation==='load')expect(view.textContent).toContain('Saving paused. Retry Load or confirm New game');
    if(operation==='save')expect(view.textContent).toBe('Save failed. Try again.');
  }finally{controller.close();}
});

it.each([false,true])('retains an actual worker error event and its cause when frozen=%s with one publication',async frozen=>{
  scope.onmessage=()=>{};
  const original=new SyntaxError('Worker initialization failed',{cause:new TypeError('Invalid module')});
  // Materialize the engine's original stack before freezing its property descriptors.
  const stack=original.stack;if(frozen)Object.freeze(original);
  const publish=vi.spyOn(console,'error').mockImplementation(()=>{}),report=vi.fn(error=>console.error('Save/load failed',error));
  const controller=new PersistenceController(createSaveStore(),simulation(),status(),report),preventDefault=vi.fn();
  try{
    const pending=controller.load();await Promise.resolve();
    Peer.current.error({error:original,message:original.message,filename:'save-worker.js',lineno:17,colno:2,preventDefault} as unknown as ErrorEvent);
    expect(await pending).toBe(false);expect(report).toHaveBeenCalledOnce();expect(publish).toHaveBeenCalledOnce();expect(preventDefault).toHaveBeenCalledOnce();
    const received=report.mock.calls[0][0] as Failure&{workerEvent:unknown;originalError?:unknown};
    expect(received.stack).toBe(stack);expect(received.cause).toBe(original.cause);expect(received.name).toBe(original.name);
    expect(received.persistence).toEqual({operation:'load',requestId:1});
    expect(received.workerEvent).toEqual({message:original.message,filename:'save-worker.js',lineno:17,colno:2});
    if(frozen)expect(received.originalError).toBe(original);else expect(received).toBe(original);
  }finally{controller.close();}
});

it('leaves an idle worker error visible to the browser without a duplicate publisher',()=>{
  const store=createSaveStore(),preventDefault=vi.fn(),publish=vi.spyOn(console,'error').mockImplementation(()=>{});
  try{Peer.current.error({error:new Error('Idle worker error'),message:'Idle worker error',preventDefault} as unknown as ErrorEvent);
    expect(preventDefault).not.toHaveBeenCalled();expect(publish).not.toHaveBeenCalled();
  }finally{store.close();}
});

it('retains only available error-event source fields without inventing an original stack or cause',async()=>{
  scope.onmessage=()=>{};const store=createSaveStore(),preventDefault=vi.fn();
  try{
    const pending=store.load();await Promise.resolve();
    Peer.current.error({message:'Worker module could not load',filename:'save-worker.js',lineno:0,colno:0,preventDefault} as unknown as ErrorEvent);
    const received=await rejected(pending) as Failure&{workerEvent:unknown};
    expect(received.message).toBe('Worker module could not load');expect(received.stack).toBeUndefined();expect(Object.hasOwn(received,'cause')).toBe(false);
    expect(received.workerEvent).toEqual({message:'Worker module could not load',filename:'save-worker.js'});expect(preventDefault).toHaveBeenCalledOnce();
  }finally{store.close();}
});

it('uses a plain worker-event fallback without inventing source details',async()=>{
  scope.onmessage=()=>{};const store=createSaveStore(),preventDefault=vi.fn();
  try{
    const pending=store.load();await Promise.resolve();
    Peer.current.error({message:'',filename:'',lineno:0,colno:0,preventDefault} as unknown as ErrorEvent);
    const received=await rejected(pending) as Failure&{workerEvent:unknown};
    expect(received.message).toBe('The browser storage worker stopped.');expect(received.stack).toBeUndefined();expect(Object.hasOwn(received,'cause')).toBe(false);
    expect(received.workerEvent).toEqual({});expect(preventDefault).toHaveBeenCalledOnce();
  }finally{store.close();}
});

it('reports unreadable message data with operation context once and permits a later request',async()=>{
  const handler=scope.onmessage;scope.onmessage=()=>{};
  const store=createSaveStore(),report=vi.fn(),controller=new PersistenceController(store,simulation(),status(),report);
  try{
    const pending=controller.save();await Promise.resolve();Peer.current.messageerror();expect(await pending).toBe(false);
    expect(report).toHaveBeenCalledOnce();expect(report.mock.calls[0][0]).toMatchObject({message:'The browser storage worker returned unreadable data.',persistence:{operation:'save',requestId:1}});
    scope.onmessage=handler;await expect(store.load()).resolves.toBeNull();
  }finally{controller.close();}
});

it('accepts a frozen legacy string-only failure without inventing its missing original stack or cause',async()=>{
  failStorage=true;failure=new Error('Original');transform=reply=>Object.freeze({id:reply.id,ok:false,error:'Legacy failure'});
  const store=createSaveStore();try{
    const received=await rejected(store.load());expect(received.message).toBe('Legacy failure');expect(received.name).toBe('Error');
    expect(received.stack).toBeUndefined();expect(Object.hasOwn(received,'cause')).toBe(false);expect(received.workerErrorDetails).toBeUndefined();
    expect(received.persistence).toEqual({operation:'load',requestId:1});
  }finally{store.close();}
});

it('preserves an unknown thrown value as bounded data without calling its conversion hooks or inventing an Error cause',async()=>{
  let conversions=0;failure={tag:'failure',toString(){conversions++;throw new Error('Conversion escaped');}};failStorage=true;
  const store=createSaveStore();try{
    const received=await rejected(store.load());expect(conversions).toBe(0);expect(escaped).toEqual([]);
    expect(received.message).toBe('Browser storage operation failed.');expect(received.stack).toBeUndefined();expect(Object.hasOwn(received,'cause')).toBe(false);
    expect(received.workerThrownValue).toEqual({tag:'failure',toString:{diagnosticLimit:'unsupported'}});
  }finally{store.close();}
});

it('retains bounded cyclic and oversized worker causes through the save consumer',async()=>{
  const cycle=new Error('Cyclic failure');cycle.cause=cycle;failure=cycle;failStorage=true;const store=createSaveStore();
  try{
    const cyclic=await rejected(store.load());expect(cyclic.cause).toEqual({diagnosticLimit:'cycle'});
    failure=new Error('Oversized cause',{cause:{data:'x'.repeat(1000000)}});const bounded=await rejected(store.load());
    expect((bounded.cause as {data:string}).data).toHaveLength(16384);expect(JSON.stringify(bounded.workerErrorDetails).length).toBeLessThan(100000);
  }finally{store.close();}
});

it.each(['name','message','stack'] as const)('does not execute an original Error %s getter while still answering the save request',async field=>{
  let accesses=0;failure=new Error('Original');Object.defineProperty(failure,field,{configurable:true,get(){accesses++;throw new Error('Getter escaped');}});failStorage=true;
  const store=createSaveStore();try{
    const received=await rejected(store.load());expect(accesses).toBe(0);expect(escaped).toEqual([]);expect(received.workerErrorDetails?.unavailableFields).toContain(field);
    if(field==='stack')expect(received.stack).toBeUndefined();
  }finally{store.close();}
});

it.each(['details-getter','oversized-extra','diagnostic-extra','array-extra','deep-cause','wide-cause','cyclic-cause','bad-cause','wrong-message','wrong-operation','wrong-request','id-getter','bad-ok','bad-bytes'] as const)('rejects %s diagnostics without escaping the handler or poisoning the next operation',async variant=>{
  let accesses=0;failure=new Error('Storage refused the request');failStorage=true;
  transform=reply=>{
    transform=undefined;const value={...reply} as Record<string,unknown>;
    if(variant==='details-getter')Object.defineProperty(value,'errorDetails',{get(){accesses++;throw new Error('Getter escaped');},enumerable:true});
    if(variant==='oversized-extra')value.extra='x'.repeat(1000000);
    if(variant==='diagnostic-extra')value.errorDetails={kind:'value',value:'Storage refused the request',extra:'x'.repeat(1000000)};
    if(variant==='array-extra')value.errorDetails={kind:'array',items:Object.assign([{kind:'value',value:'data'}],{extra:'x'.repeat(1000000)})};
    if(variant==='deep-cause'){let cause:unknown={kind:'undefined'};for(let depth=0;depth<10;depth++)cause={kind:'array',items:[cause]};value.errorDetails=cause;}
    if(variant==='wide-cause')value.errorDetails={kind:'array',items:Array.from({length:16},()=>({kind:'array',items:Array.from({length:16},()=>({kind:'undefined'}))}))};
    if(variant==='cyclic-cause'){const cause={kind:'array',items:[] as unknown[]};cause.items.push(cause);value.errorDetails=cause;}
    if(variant==='bad-cause')value.errorDetails={kind:'error',name:'Error',message:'Storage refused the request',stack:'original',cause:{kind:'value',value:{bad:true}}};
    if(variant==='wrong-message')value.error='A different failure';
    if(variant==='wrong-operation')value.workerContext={operation:'clear',requestId:reply.id};
    if(variant==='wrong-request')value.workerContext={operation:'load',requestId:reply.id+1};
    if(variant==='id-getter')Object.defineProperty(value,'id',{get(){accesses++;throw new Error('ID getter escaped');},enumerable:true});
    if(variant==='bad-ok')value.ok='true';
    if(variant==='bad-bytes'){value.ok=true;value.bytes='not an ArrayBuffer';delete value.error;delete value.errorDetails;delete value.workerContext;}
    failStorage=false;return value;
  };
  const store=createSaveStore();try{
    const failed=store.load(),next=store.load(),received=await rejected(failed);
    expect(received.message).toContain('invalid');expect(received.persistence).toEqual({operation:'load',requestId:1});
    expect(received.workerResponseDetails).toBeDefined();expect(JSON.stringify(received.workerResponseDetails).length).toBeLessThan(100000);
    expect(accesses).toBe(0);expect(escaped).toEqual([]);await expect(next).resolves.toBeNull();expect(requests.map(row=>row.kind)).toEqual(['load','load']);
  }finally{store.close();}
});

it('cleans pending ownership after synchronous send failure and preserves the original Error',async()=>{
  const original=new Error('Worker rejected the send',{cause:new TypeError('Detached port')}),send=Peer.prototype.postMessage;
  vi.spyOn(Peer.prototype,'postMessage').mockImplementationOnce(()=>{throw original;}).mockImplementation(send);
  const store=createSaveStore(),preventDefault=vi.fn();try{
    const received=await rejected(store.load());expect(received).toBe(original);expect(received.cause).toBe(original.cause);expect(received.persistence).toEqual({operation:'load',requestId:1});
    Peer.current.error({message:'Idle after failed send',preventDefault} as unknown as ErrorEvent);expect(preventDefault).not.toHaveBeenCalled();
    await expect(store.load()).resolves.toBeNull();
  }finally{store.close();}
});

it.each(['legacy','context'] as const)('ignores a valid %s late reply for a settled request without disturbing the current operation',async variant=>{
  failStorage=true;failure=new Error('First load failed');const store=createSaveStore();
  let prior:Reply|undefined;transform=reply=>{prior=reply;transform=undefined;return reply;};
  try{
    await rejected(variant==='legacy'?store.load():store.clear());const handler=scope.onmessage;scope.onmessage=()=>{};const next=store.load();await Promise.resolve();
    Peer.current.receive(variant==='legacy'?{id:1,ok:false,error:'Late reply'}:prior);let settled=false;void next.then(()=>{settled=true;},()=>{settled=true;});await Promise.resolve();expect(settled).toBe(false);
    scope.onmessage=handler;Peer.current.receive({id:2,ok:true,bytes:null});await expect(next).resolves.toBeNull();
  }finally{store.close();}
});

it.each([
  ['stale','invalid-ok'],['stale','malformed-tree'],['future','invalid-ok'],['future','malformed-tree'],
] as const)('rejects a %s ID with %s, reports once, settles controls and runs the next queued request',async(age,variant)=>{
  const store=createSaveStore(),view=status(),publish=vi.spyOn(console,'error').mockImplementation(()=>{});
  const report=vi.fn(error=>console.error('Save/load failed',error)),controller=new PersistenceController(store,simulation(),view,report);
  // Settle ID 1 before ID 2 becomes the current operation.
  await store.load();failure=new Error('Current storage failure');failStorage=true;
  transform=reply=>{
    transform=undefined;failStorage=false;const id=age==='stale'?reply.id-1:reply.id+1000;
    if(variant==='invalid-ok')return {id,ok:'broken'};
    return {...reply,id,workerContext:{operation:'load',requestId:id},errorDetails:{kind:'value',value:{not:'primitive'}}};
  };
  let completed:boolean|undefined;
  const pending=controller.load().then(value=>{completed=value;}),next=store.load();void next.catch(()=>{});
  try{
    expect(view.attributes.get('data-pending')).toBe('true');expect(controller.controlState().newGameDisabled).toBe(true);
    await vi.waitFor(()=>expect(completed).toBe(false),{interval:1,timeout:1000});await pending;
    expect(report).toHaveBeenCalledOnce();expect(publish).toHaveBeenCalledOnce();
    expect(report.mock.calls[0][0]).toMatchObject({message:'The browser storage worker returned invalid data.',persistence:{operation:'load',requestId:2}});
    expect(view.attributes.has('data-pending')).toBe(false);
    expect(controller.controlState()).toEqual({saveDisabled:true,loadDisabled:false,newGameDisabled:false,confirmationDisabled:false});
    expect(view.textContent).toContain('Saving paused. Retry Load or confirm New game');
    await expect(next).resolves.toBeNull();expect(requests.map(request=>request.id)).toEqual([1,2,3]);expect(escaped).toEqual([]);
  }finally{controller.close();await pending;await next.catch(()=>{});}
});
