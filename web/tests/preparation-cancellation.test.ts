import {expect,it,vi} from 'vitest';
import {defaultAppearance} from '../src/character/schema.js';
import {PreparationQueue,type PreparationWork} from '../src/render/character/preparation-queue.js';
import {WorkerPreparationTransport} from '../src/render/character/preparation-transport.js';
import {testArtifact,testInput} from './bike-contact-service-fixture.js';
import type {PreparationRequest} from '../src/render/character/preparation-protocol.js';

const turn=()=>new Promise<void>(resolve=>queueMicrotask(resolve));
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(yes=>{resolve=yes;});return {promise,resolve};}

it('cancels only the final shared owner and dispatches the newest input without waiting for an obsolete factory',async()=>{
  const queue=new PreparationQueue<{key:string}>(),old=deferred(),started:number[]=[],work=new Map<number,PreparationWork<{key:string}>>();
  const definition={key:(appearance:ReturnType<typeof defaultAppearance>)=>String(appearance.body.height),prepare:async(appearance:ReturnType<typeof defaultAppearance>,context:PreparationWork<{key:string}>)=>{
    const height=appearance.body.height;started.push(height);work.set(height,context);context.inputPrepared();
    if(height===50)await old.promise;context.compiled();return {key:String(height)};
  }};
  try{
    const a=defaultAppearance(),first=queue.acquire('one',a,definition),shared=queue.acquire('two',a,definition);
    await turn();first.release();await turn();expect(work.get(50)!.signal.aborted).toBe(false);
    shared.release();const b=defaultAppearance();b.body.height=75;
    const latest=queue.acquire('newest',b,definition);
    await expect(first.ready).rejects.toMatchObject({name:'AbortError'});
    await expect(shared.ready).rejects.toMatchObject({name:'AbortError'});
    await expect(latest.ready).resolves.toEqual({key:'75'});
    expect(work.get(50)!.signal.aborted).toBe(true);expect(started).toEqual([50,75]);
    old.resolve();await turn();expect(queue.require('newest','75')).toEqual({key:'75'});
  }finally{old.resolve();queue.dispose();}
});

it('disposal aborts input work and never publishes a late completion',async()=>{
  const queue=new PreparationQueue<{key:string}>(),gate=deferred();let work:PreparationWork<{key:string}>|undefined;
  const lease=queue.acquire('draft',defaultAppearance(),{key:()=> 'same',prepare:async(_,context)=>{work=context;await gate.promise;context.compiled();return {key:'same'};}});
  await turn();queue.dispose();expect(work!.signal.aborted).toBe(true);
  await expect(lease.ready).rejects.toMatchObject({name:'AbortError'});gate.resolve();await turn();
  expect(queue.diagnostics()).toMatchObject({owners:0,entries:0,inFlight:0,ready:0});
});

it('reacquires an aborted physical key without reusing its entry or allowing its late work to remove the replacement',async()=>{
  const queue=new PreparationQueue<{key:string;serial:number}>(),gates=[deferred(),deferred()],signals:AbortSignal[]=[];
  const definition={key:()=> 'same',prepare:async(_:ReturnType<typeof defaultAppearance>,work:PreparationWork<{key:string;serial:number}>)=>{
    const serial=signals.length;signals.push(work.signal);await gates[serial].promise;work.compiled();return {key:'same',serial};
  }};
  try{
    const first=queue.acquire('draft',defaultAppearance(),definition);await turn();first.release();await turn();
    expect(signals[0].aborted).toBe(true);
    const next=queue.acquire('draft',defaultAppearance(),definition);
    await vi.waitFor(()=>expect(signals).toHaveLength(2),{interval:1,timeout:1000});
    expect(signals[1]).not.toBe(signals[0]);expect(signals[1].aborted).toBe(false);
    gates[1].resolve();await expect(next.ready).resolves.toEqual({key:'same',serial:1});
    gates[0].resolve();await turn();await turn();
    expect(queue.require('draft','same')).toEqual({key:'same',serial:1});
    expect(queue.diagnostics()).toMatchObject({owners:1,entries:1,ready:1,inFlight:0});
  }finally{for(const gate of gates)gate.resolve();queue.dispose();}
});

class FakeWorker {
  static instances:FakeWorker[]=[];
  onmessage:((event:MessageEvent)=>void)|null=null;
  onerror:((event:ErrorEvent)=>void)|null=null;
  onmessageerror:(()=>void)|null=null;
  readonly requests:PreparationRequest[]=[];
  terminations=0;
  constructor(){FakeWorker.instances.push(this);}
  postMessage(request:PreparationRequest){this.requests.push(request);}
  terminate(){this.terminations++;}
  complete(){const request=this.requests.at(-1)!;if(request.kind!=='bike')throw new Error('Test expects a bike request');
    this.onmessage?.({data:{version:1,id:request.id,kind:request.kind,ok:true,artifact:testArtifact(request.input)}} as MessageEvent);}
  error(){this.onerror?.({message:'Late worker failure',preventDefault(){}} as ErrorEvent);}
}

it('terminates an active worker on abort and ignores its late response/error after replacement',async()=>{
  FakeWorker.instances=[];vi.stubGlobal('Worker',FakeWorker);
  const old=new WorkerPreparationTransport(),controller=new AbortController();let replacement:WorkerPreparationTransport|undefined;
  try{
    const input=await testInput(defaultAppearance()),pending=old.run({version:1,id:1,kind:'bike',input},controller.signal);
    controller.abort();await expect(pending).rejects.toMatchObject({name:'AbortError'});
    expect(FakeWorker.instances[0].terminations).toBe(1);
    replacement=new WorkerPreparationTransport();const next=replacement.run({version:1,id:2,kind:'bike',input});let settled=false;void next.then(()=>{settled=true;});
    FakeWorker.instances[0].complete();FakeWorker.instances[0].error();await turn();
    expect(settled).toBe(false);expect(FakeWorker.instances[1].terminations).toBe(0);
    FakeWorker.instances[1].complete();await expect(next).resolves.toMatchObject({id:2,ok:true});
  }finally{old.dispose();replacement?.dispose();vi.unstubAllGlobals();}
});

it('detaches a completed request abort handler before reusing its worker',async()=>{
  FakeWorker.instances=[];vi.stubGlobal('Worker',FakeWorker);const transport=new WorkerPreparationTransport(),firstAbort=new AbortController();
  try{
    const input=await testInput(defaultAppearance()),first=transport.run({version:1,id:1,kind:'bike',input},firstAbort.signal);
    FakeWorker.instances[0].complete();await first;
    const second=transport.run({version:1,id:2,kind:'bike',input});firstAbort.abort();
    expect(FakeWorker.instances[0].terminations).toBe(0);FakeWorker.instances[0].complete();await expect(second).resolves.toMatchObject({id:2,ok:true});
  }finally{transport.dispose();vi.unstubAllGlobals();}
});
