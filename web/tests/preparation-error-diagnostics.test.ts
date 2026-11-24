import {beforeAll,afterEach,expect,it,vi} from 'vitest';
import {defaultAppearance} from '../src/character/schema.js';
import {CharacterPreparationService} from '../src/render/character/character-preparation-service.js';
import {WorkerPreparationTransport} from '../src/render/character/preparation-transport.js';
import {validatePreparationResponse,type PreparationRequest} from '../src/render/character/preparation-protocol.js';
import {testInput} from './bike-contact-service-fixture.js';
import {CreatorView} from '../src/ui/character-creator/view.js';
import {preparationCancelled} from '../src/render/character/preparation-abort.js';

const compiler=vi.hoisted(()=>({failure:undefined as unknown}));
vi.mock('../src/render/character/bike-contact-compile.js',()=>({compileBikeContact:()=>{throw compiler.failure;}}));
vi.mock('../src/render/character/sleep-contact-preparation.js',()=>({prepareSleepContact:()=>{throw new Error('Unused sleep compiler');},createSleepContactInput:()=>new Promise(()=>{}),sleepContactAppearanceKey:()=> 'sleep'}));
vi.mock('../src/render/character/seat-contact-preparation.js',()=>({prepareSeatContact:()=>{throw new Error('Unused seat compiler');},createSeatContactInput:()=>new Promise(()=>{}),seatContactAppearanceKey:()=> 'seat'}));

type ConsumerError=Error&{workerStack?:string;workerKind?:string;preparation?:{requestId:number;resource:string;inputKey:string;operation:string};workerEvent?:{filename?:string;lineno?:number;colno?:number};originalError?:unknown};
const scope={onmessage:null as null|((event:MessageEvent)=>Promise<void>),postMessage(value:unknown){Peer.responses++;const peer=Peer.current;if(!peer)return;const data=structuredClone(Peer.transform?Peer.transform(value):value);if(Peer.hold)Peer.held.push({peer,data});else peer.onmessage?.({data} as MessageEvent);}};
class Peer {
  static current:Peer|undefined;
  static transform:((value:unknown)=>unknown)|undefined;static hold=false;static held:{peer:Peer;data:unknown}[]=[];
  static responses=0;static escaped:unknown[]=[];
  onmessage:((event:MessageEvent)=>void)|null=null;onerror:((event:ErrorEvent)=>void)|null=null;onmessageerror:(()=>void)|null=null;
  request:PreparationRequest|undefined;terminated=false;
  constructor(){Peer.current=this;}
  postMessage(request:PreparationRequest){this.request=request;void scope.onmessage!({data:structuredClone(request)} as MessageEvent).catch(error=>Peer.escaped.push(error));}
  terminate(){this.terminated=true;}
}
beforeAll(async()=>{vi.stubGlobal('self',scope);await import('../src/render/character/preparation-worker.js');});
afterEach(()=>{Peer.current=undefined;Peer.transform=undefined;Peer.hold=false;Peer.held=[];Peer.responses=0;Peer.escaped=[];vi.unstubAllGlobals();});
function service(){vi.stubGlobal('Worker',Peer);return new CharacterPreparationService({bikeInputFactory:testInput});}
function suppliedStack<T extends Error>(error:T,stack=error.stack):T {Object.defineProperty(error,'stack',{value:stack,writable:true,configurable:true});return error;}

it('preserves a real worker Error cause chain and known request context through transport and service',async()=>{
  const leaf=suppliedStack(new TypeError('Bad support coefficient')),original=suppliedStack(new RangeError('Contact preparation failed',{cause:leaf}),'RangeError: Contact preparation failed\n    at compileContact (worker.ts:7:3)');
  compiler.failure=original;const owner=service();
  try{
    const error=await owner.acquire('current',defaultAppearance()).ready.catch(error=>error) as ConsumerError;
    expect(error.message).toBe(original.message);expect(error.name).toBe(original.name);expect(error.stack).toBe(original.stack);
    expect(error.cause).toBeInstanceOf(TypeError);expect((error.cause as Error).message).toBe(leaf.message);expect((error.cause as Error).stack).toBe(leaf.stack);
    expect(error.preparation).toEqual({requestId:Peer.current!.request!.id,resource:'bike',inputKey:Peer.current!.request!.input.key,operation:'compileBikeContact'});
  }finally{owner.dispose();}
});

it('retains original ErrorEvent.error and only available event metadata on the real transport',async()=>{
  vi.stubGlobal('Worker',Peer);const transport=new WorkerPreparationTransport();
  try{
    // Keep the worker request pending so the actual onerror consumer owns this failure.
    const handler=scope.onmessage;scope.onmessage=async()=>{};
    const input=await testInput(defaultAppearance()),pending=transport.run({version:1,id:31,kind:'bike',input});scope.onmessage=handler;
    const original=new SyntaxError('Worker module failed',{cause:new Error('Source parse failed')}),preventDefault=vi.fn();
    Peer.current!.onerror!({error:original,message:'Uncaught SyntaxError: Worker module failed',filename:'worker.js',lineno:23,colno:5,preventDefault} as unknown as ErrorEvent);
    const error=await pending.catch(error=>error) as ConsumerError;
    expect(error).toBe(original);expect(error.cause).toBe(original.cause);expect(error.workerEvent).toMatchObject({filename:'worker.js',lineno:23,colno:5});
    expect(error.preparation).toMatchObject({requestId:31,resource:'bike',inputKey:input.key});expect(preventDefault).toHaveBeenCalledOnce();
  }finally{transport.dispose();}
});

it('keeps legacy error responses valid and rejects malformed optional diagnostic trees',()=>{
  const legacy={version:1,id:1,kind:'bike',ok:false,error:'Failed',errorName:'TypeError',workerStack:'TypeError: Failed'};
  expect(()=>validatePreparationResponse(legacy)).not.toThrow();
  expect(()=>validatePreparationResponse({...legacy,errorDetails:{kind:'error',name:'TypeError',message:'Failed',cause:{kind:'value',value:{unsafe:'object'}}}})).toThrow('diagnostic');
  expect(()=>validatePreparationResponse({...legacy,workerContext:{operation:'compileBikeContact',requestId:2,resource:'bike',inputKey:'key'}})).toThrow('diagnostic');
});

it('restores an actual legacy worker response without fabricating its absent cause or worker operation',async()=>{
  compiler.failure=suppliedStack(new TypeError('Legacy failure'));Peer.transform=value=>{const row=value as Record<string,unknown>;delete row.errorDetails;delete row.workerContext;return row;};
  const owner=service();
  try{const error=await owner.acquire('current',defaultAppearance()).ready.catch(error=>error) as ConsumerError;
    expect(error.name).toBe('TypeError');expect(error.stack).toBe((compiler.failure as Error).stack);expect(Object.hasOwn(error,'cause')).toBe(false);expect(error.preparation?.operation).toBe('worker-response');
  }finally{owner.dispose();}
});

it('rejects corrupt input identity after the real worker serializes a failure',async()=>{
  compiler.failure=new Error('Original failure');Peer.transform=value=>{const row=value as {workerContext:{inputKey:string}};row.workerContext.inputKey='wrong-key';return row;};
  const owner=service();
  try{await expect(owner.acquire('current',defaultAppearance()).ready).rejects.toThrow('diagnostics do not match their input');}
  finally{owner.dispose();}
});

it.each(['cause','request','resource','name'])('rejects corrupted %s diagnostics across the real serializer/transport/consumer seam',async field=>{
  compiler.failure=new TypeError('Original failure',{cause:new Error('Original cause')});
  Peer.transform=value=>{
    const row=value as {errorDetails:{name:string;cause:unknown};workerContext:{requestId:number;resource:string}};
    if(field==='cause')row.errorDetails.cause={kind:'value',value:{not:'primitive'}};
    if(field==='request')row.workerContext.requestId++;
    if(field==='resource')row.workerContext.resource='seat';
    if(field==='name')row.errorDetails.name='RangeError';return row;
  };
  const owner=service();
  try{await expect(owner.acquire('current',defaultAppearance()).ready).rejects.toThrow('error diagnostics');expect(Peer.current!.terminated).toBe(true);}
  finally{owner.dispose();}
});

it('bounds actual object causes without executing accessors or mislabeling shared data as cycles',async()=>{
  let accesses=0;const shared={part:'foot'},wide=Object.fromEntries(Array.from({length:16},(_,index)=>{
    const value={};for(let at=0;at<16;at++)Object.defineProperty(value,'field'+at,{enumerable:true,get(){accesses++;throw new Error('Getter must not run');}});return ['item'+index,value];
  }));
  compiler.failure=new Error('Bounded cause',{cause:{sharedLeft:shared,sharedRight:shared,wide}});const owner=service();
  try{const error=await owner.acquire('current',defaultAppearance()).ready.catch(error=>error) as ConsumerError;
    expect(error.message).toBe('Bounded cause');expect(accesses).toBe(0);expect(error.cause).toMatchObject({sharedLeft:shared,sharedRight:shared});
  }finally{owner.dispose();}
});

it('retains an explicit diagnostic cycle limit through the real serializer and consumer',async()=>{
  const cycle=new Error('Cyclic cause');cycle.cause=cycle;compiler.failure=cycle;const owner=service();
  try{const error=await owner.acquire('current',defaultAppearance()).ready.catch(error=>error) as ConsumerError;
    expect(error.message).toBe('Cyclic cause');expect(error.cause).toEqual({diagnosticLimit:'cycle'});
  }finally{owner.dispose();}
});

it('records only available ErrorEvent metadata and does not invent a cause',async()=>{
  vi.stubGlobal('Worker',Peer);const transport=new WorkerPreparationTransport(),handler=scope.onmessage;scope.onmessage=async()=>{};
  try{const input=await testInput(defaultAppearance()),pending=transport.run({version:1,id:32,kind:'bike',input});scope.onmessage=handler;
    Peer.current!.onerror!({message:'Worker failed',filename:'',lineno:0,colno:0,preventDefault(){}} as ErrorEvent);
    const error=await pending.catch(error=>error) as ConsumerError;expect(error.workerEvent).toEqual({message:'Worker failed'});expect(Object.hasOwn(error,'cause')).toBe(false);
  }finally{scope.onmessage=handler;transport.dispose();}
});

it('retains an immutable original event error separately without fabricating a cause',async()=>{
  vi.stubGlobal('Worker',Peer);const transport=new WorkerPreparationTransport(),handler=scope.onmessage;scope.onmessage=async()=>{};
  try{const input=await testInput(defaultAppearance()),pending=transport.run({version:1,id:33,kind:'bike',input});scope.onmessage=handler;
    const original=Object.freeze(suppliedStack(new URIError('Immutable failure')));
    Peer.current!.onerror!({error:original,message:'Immutable failure',preventDefault(){}} as unknown as ErrorEvent);
    const error=await pending.catch(error=>error) as ConsumerError;expect(error.originalError).toBe(original);expect(error.name).toBe(original.name);expect(error.stack).toBe(original.stack);expect(Object.hasOwn(error,'cause')).toBe(false);
  }finally{scope.onmessage=handler;transport.dispose();}
});

it('ignores a canceled worker serialized failure and original late ErrorEvent instead of publishing a current error',async()=>{
  compiler.failure=new Error('Obsolete failure',{cause:new Error('Obsolete cause')});Peer.hold=true;const owner=service();
  try{const lease=owner.acquire('old',defaultAppearance());await vi.waitFor(()=>expect(Peer.held).toHaveLength(1),{interval:1,timeout:1000});
    lease.release();await expect(lease.ready).rejects.toMatchObject({name:'AbortError'});await new Promise<void>(resolve=>queueMicrotask(resolve));
    const {peer,data}=Peer.held[0],original=new Error('Late event');peer.onmessage?.({data} as MessageEvent);peer.onerror?.({error:original,message:'Late event',preventDefault:vi.fn()} as unknown as ErrorEvent);
    expect(Object.hasOwn(original,'workerEvent')).toBe(false);expect(owner.diagnostics().lastError).toBeNull();expect(owner.diagnostics().lastWorkerError).toBeNull();
  }finally{owner.dispose();}
});

it('leaves an unowned worker event to the browser and suppresses a known closed worker event',()=>{
  vi.stubGlobal('Worker',Peer);const transport=new WorkerPreparationTransport(),peer=Peer.current!,idle=vi.fn(),late=vi.fn();
  const original=new Error('Idle worker failure');peer.onerror!({error:original,message:original.message,preventDefault:idle} as unknown as ErrorEvent);
  expect(idle).not.toHaveBeenCalled();expect(peer.terminated).toBe(true);
  peer.onerror!({error:new Error('Late closed worker failure'),message:'Late failure',preventDefault:late} as unknown as ErrorEvent);
  expect(late).toHaveBeenCalledOnce();transport.dispose();
});

it.each(['prepare','draw'])('shows a current real worker AbortError in the actual creator %s consumer without treating its name as owner cancellation',async mode=>{
  const failure=new Error('Compiler aborted its calculation',{cause:new Error('Invariant failed')});failure.name='AbortError';compiler.failure=failure;const owner=service(),appearance=defaultAppearance();
  const view=Object.assign(Object.create(CreatorView.prototype),{destroyed:false,session:{draft:{value:{appearance}}},preview:{prepare:()=>mode==='prepare'?owner.acquire('creator',appearance).ready:Promise.resolve(),draw:()=>owner.acquire('creator',appearance).ready},
    previewInFlight:false,previewReady:false,appearanceReady:false,preparationKey:'',preparationGeneration:0,previewKey:'',previewError:'',facing:0,action:'idle',queuedDraw:false,
    frame:0,element:()=>({textContent:''}),visible:()=>mode==='draw',syncStatus:vi.fn(),refreshAnimation:vi.fn()});
  try{await Reflect.get(view,'drawPreview').call(view);await vi.waitFor(()=>expect(Peer.responses).toBeGreaterThan(0),{interval:1,timeout:1000});
    await vi.waitFor(()=>expect(view.previewError).toBe(failure.message),{interval:1,timeout:1000});expect(owner.diagnostics().lastError).toBe(failure.message);
  }finally{owner.dispose();}
});

it.each(['name','message','stack'])('never executes an Error %s getter while the real handler still replies',async field=>{
  let accesses=0;const cause=new Error('Cause');Object.defineProperty(cause,field,{configurable:true,get(){accesses++;throw new Error('Getter escaped');}});
  compiler.failure=new Error('Outer failure',{cause});const owner=service();
  try{const pending=owner.acquire('current',defaultAppearance()).ready;
    await vi.waitFor(()=>expect(Peer.responses+Peer.escaped.length).toBeGreaterThan(0),{interval:1,timeout:1000});expect(Peer.escaped).toEqual([]);
    const error=await pending.catch(error=>error);expect(error.message).toBe('Outer failure');expect(accesses).toBe(0);expect(error.workerErrorDetails.cause.unavailableFields).toContain(field);
  }finally{owner.dispose();}
});

it('does not invoke hostile thrown-object conversion while posting a real worker failure',async()=>{
  let conversions=0;compiler.failure={toString(){conversions++;throw new Error('Conversion escaped');}};const owner=service();
  try{const pending=owner.acquire('current',defaultAppearance()).ready;
    await vi.waitFor(()=>expect(Peer.responses+Peer.escaped.length).toBeGreaterThan(0),{interval:1,timeout:1000});expect(Peer.escaped).toEqual([]);
    const error=await pending.catch(error=>error);expect(error).toBeInstanceOf(Error);expect(conversions).toBe(0);expect(Object.hasOwn(error,'cause')).toBe(false);
  }finally{owner.dispose();}
});

it('suppresses actual owner cancellation provenance in the creator without suppressing an arbitrary name',async()=>{
  const appearance=defaultAppearance(),view=Object.assign(Object.create(CreatorView.prototype),{destroyed:false,session:{draft:{value:{appearance}}},
    preview:{prepare:()=>Promise.reject(preparationCancelled())},previewInFlight:false,previewReady:false,appearanceReady:false,preparationKey:'',preparationGeneration:0,
    previewKey:'',previewError:'',facing:0,action:'idle',queuedDraw:false,visible:()=>false,syncStatus:vi.fn(),refreshAnimation:vi.fn()});
  await Reflect.get(view,'drawPreview').call(view);await Promise.resolve();expect(view.previewError).toBe('');expect(view.appearanceReady).toBe(false);
});

it.each(['diagnostic-extra','context-extra','undefined-cause'])('rejects %s fields rather than retaining an unbounded optional object',async field=>{
  compiler.failure=new Error('Original failure');Peer.transform=value=>{
    const row=value as {errorDetails:Record<string,unknown>;workerContext:Record<string,unknown>};
    if(field==='diagnostic-extra')row.errorDetails.extra='x'.repeat(1000000);
    if(field==='context-extra')row.workerContext.extra='x'.repeat(1000000);
    if(field==='undefined-cause')row.errorDetails={kind:'undefined',cause:{kind:'value',value:'hidden'}};return row;
  };
  const owner=service();try{await expect(owner.acquire('current',defaultAppearance()).ready).rejects.toThrow('error diagnostics');}finally{owner.dispose();}
});

it.each(['items','entries','tuple','unavailable'])('rejects extra fields on diagnostic %s arrays through the actual consumer',async field=>{
  compiler.failure=new Error('Original failure');Peer.transform=value=>{
    const row=value as {errorDetails:Record<string,unknown>},extra={extra:'x'.repeat(1000000)};
    if(field==='items')row.errorDetails.cause={kind:'array',items:Object.assign([{kind:'value',value:'data'}],extra)};
    if(field==='entries')row.errorDetails.cause={kind:'object',entries:Object.assign([['part',{kind:'value',value:'data'}]],extra)};
    if(field==='tuple')row.errorDetails.cause={kind:'object',entries:[Object.assign(['part',{kind:'value',value:'data'}],extra)]};
    if(field==='unavailable')row.errorDetails.unavailableFields=Object.assign(['stack'],extra);return row;
  };
  const owner=service();try{await expect(owner.acquire('current',defaultAppearance()).ready).rejects.toThrow('error diagnostics');}finally{owner.dispose();}
});

it.each(['array','nested-array'])('rejects a coercible %s limit reason without retaining its oversized data',async variant=>{
  compiler.failure=new Error('Original failure');Peer.transform=value=>{
    const row=value as {errorDetails:{cause:unknown}};row.errorDetails.cause={kind:'limit',reason:Object.assign(variant==='array'?['cycle']:[['cycle']],{extra:'x'.repeat(1000000)})};return row;
  };
  const owner=service();try{await expect(owner.acquire('current',defaultAppearance()).ready).rejects.toThrow('error diagnostics');}finally{owner.dispose();}
});

it('preserves original ordinary native worker and nested cause stacks through the real maintained seam',async()=>{
  const leaf=new TypeError('Native leaf'),original=new RangeError('Native outer',{cause:leaf}),workerStack=original.stack,causeStack=leaf.stack;
  compiler.failure=original;const owner=service();
  try{const error=await owner.acquire('current',defaultAppearance()).ready.catch(error=>error);
    expect(error.stack).toBe(workerStack);expect(error.cause.stack).toBe(causeStack);expect(error.workerStack).toBe(workerStack);
  }finally{owner.dispose();}
});

it.each(['name','message','stack'])('does not invoke a hostile prototype Error %s getter to recover a stack',async field=>{
  let accesses=0;const cause=new Error('Cause'),prototype=Object.create(Object.getPrototypeOf(cause));
  delete (cause as unknown as Record<string,unknown>)[field];Object.defineProperty(prototype,field,{get(){accesses++;throw new Error('Prototype getter escaped');}});Object.setPrototypeOf(cause,prototype);
  compiler.failure=new Error('Outer failure',{cause});const owner=service();
  try{const pending=owner.acquire('current',defaultAppearance()).ready;
    await vi.waitFor(()=>expect(Peer.responses+Peer.escaped.length).toBeGreaterThan(0),{interval:1,timeout:1000});expect(Peer.escaped).toEqual([]);
    const error=await pending.catch(error=>error);expect(accesses).toBe(0);expect(error.workerErrorDetails.cause.unavailableFields).toContain(field);expect(error.cause.stack).toBeUndefined();
  }finally{owner.dispose();}
});

it.each(['data-function','accessor'])('does not invoke a changed %s application formatter and does not substitute a restoration stack',async variant=>{
  const original=new Error('Formatter guard'),descriptor=Object.getOwnPropertyDescriptor(Error,'prepareStackTrace');let formats=0,accesses=0;compiler.failure=original;
  const owner=service();let received:ConsumerError|undefined;
  const formatter=()=>{formats++;throw new Error('Formatter executed');};
  try{Object.defineProperty(Error,'prepareStackTrace',variant==='accessor'?{configurable:true,get(){accesses++;return formatter;}}:{configurable:true,writable:true,value:formatter});
    received=await owner.acquire('current',defaultAppearance()).ready.catch(error=>error);
  }finally{if(descriptor)Object.defineProperty(Error,'prepareStackTrace',descriptor);else Reflect.deleteProperty(Error,'prepareStackTrace');owner.dispose();}
  expect(formats).toBe(0);expect(accesses).toBe(0);expect(received?.stack).toBeUndefined();expect((received as ConsumerError&{workerErrorDetails:{unavailableFields:string[]}}).workerErrorDetails.unavailableFields).toContain('stack');
});

it('keeps a supplied data stack while an application formatter is unsafe',async()=>{
  const stack='Error: Provided stack\n    at suppliedWorker (worker.ts:7:1)',original=suppliedStack(new Error('Provided stack'),stack),descriptor=Object.getOwnPropertyDescriptor(Error,'prepareStackTrace');let formats=0;compiler.failure=original;
  const owner=service();let received:ConsumerError|undefined;
  try{Object.defineProperty(Error,'prepareStackTrace',{configurable:true,writable:true,value:()=>{formats++;throw new Error('Formatter executed');}});received=await owner.acquire('current',defaultAppearance()).ready.catch(error=>error);}
  finally{if(descriptor)Object.defineProperty(Error,'prepareStackTrace',descriptor);else Reflect.deleteProperty(Error,'prepareStackTrace');owner.dispose();}
  expect(formats).toBe(0);expect(received?.stack).toBe(stack);
});
