import {expect,it,vi} from 'vitest';
import {defaultAppearance,type CharacterAppearanceV1} from '../src/character/schema.js';
import {CharacterPreparationService,CharacterPreparationNotReadyError} from '../src/render/character/character-preparation-service.js';
import {testInput,testArtifact} from './bike-contact-service-fixture.js';
import {makeSleepContactInput} from '../src/render/character/sleep-contact-protocol.js';
import {sleepContactAppearanceKey} from '../src/render/character/sleep-contact-identity.js';
import {SLEEP_CONTACT_SOLVER_REVISION,type SleepContactInputV1,type SleepContactArtifactV1} from '../src/render/character/sleep-contact-types.js';
import {validatePreparationResponse,type PreparationRequest,type PreparationResponse} from '../src/render/character/preparation-protocol.js';
import type {PreparationTransport} from '../src/render/character/preparation-transport.js';
import {seatInput,seatArtifact} from './seat-contact-service-fixture.js';

function sleepInput(appearance:CharacterAppearanceV1){return makeSleepContactInput({version:1,solverRevision:SLEEP_CONTACT_SOLVER_REVISION,appearance,
  appearanceKey:sleepContactAppearanceKey(appearance),revisions:{source:'test',body:'body',bed:'bed',bunk:'bunk'}});}
function sleepArtifact(input:SleepContactInputV1):SleepContactArtifactV1 {
  const clip=(action:'bed_sleep'|'bunk_sleep')=>({action,sourcePhase:0 as const,source:'test',partKey:'parts',shapeKey:'shape',top:2,
    matrices:new Array(17*16).fill(0),covers:(action==='bed_sleep'?[0,-.77]:[0]).map(offsetX=>({offsetX,heights:new Array(action==='bed_sleep'?49*45:25*45).fill(.5)}))});
  return {...input,clips:{bed_sleep:clip('bed_sleep'),bunk_sleep:clip('bunk_sleep')}};
}
class Transport implements PreparationTransport {
  readonly requests:PreparationRequest[]=[];private pending:{request:PreparationRequest;resolve:(response:PreparationResponse)=>void;reject:(error:unknown)=>void}|undefined;
  disposals=0;
  run(request:PreparationRequest):Promise<PreparationResponse>{expect(this.pending).toBeUndefined();this.requests.push(request);return new Promise((resolve,reject)=>{this.pending={request,resolve,reject};});}
  complete(){const {request,resolve}=this.pending!;this.pending=undefined;resolve({version:1,id:request.id,kind:request.kind,ok:true,artifact:request.kind==='bike'?testArtifact(request.input):request.kind==='sleep'?sleepArtifact(request.input):seatArtifact(request.input)});}
  fail(){const pending=this.pending!;this.pending=undefined;pending.reject(new Error('Worker failed'));}
  reportFailure(error:string,errorName:string,workerStack:string){const {request,resolve}=this.pending!;this.pending=undefined;resolve({version:1,id:request.id,kind:request.kind,ok:false,error,errorName,workerStack});}
  dispose(){this.disposals++;this.pending?.reject(new Error('Disposed'));this.pending=undefined;}
}
function setup(){const transport=new Transport(),bike=vi.fn(testInput),sleep=vi.fn(sleepInput),seat=vi.fn(seatInput),service=new CharacterPreparationService({bikeInputFactory:bike,sleepInputFactory:sleep,seatInputFactory:seat,transportFactory:()=>transport});return {transport,bike,sleep,seat,service};}
const jobs=(transport:Transport,count:number)=>vi.waitFor(()=>expect(transport.requests).toHaveLength(count),{interval:1,timeout:1000});

it('requires all three resources, uses one serial worker and transfers ready leases synchronously',async()=>{
  const {service,transport}=setup(),a=defaultAppearance();
  try{
    const stage=service.acquire('stage',a);await jobs(transport,1);expect(transport.requests[0].kind).toBe('bike');transport.complete();
    await jobs(transport,2);expect(transport.requests[1].kind).toBe('sleep');expect(()=>service.require('stage',a)).toThrow(CharacterPreparationNotReadyError);
    transport.complete();await jobs(transport,3);expect(transport.requests[2].kind).toBe('seat');expect(()=>service.require('stage',a)).toThrow(CharacterPreparationNotReadyError);
    transport.complete();const artifact=await stage.ready;expect(service.diagnostics()).toMatchObject({inFlight:0,compilations:3,inputPreparations:3});
    const live=service.acquire('live',a);expect(service.require('live',a)).toEqual(artifact);stage.release();expect(await live.ready).toEqual(artifact);
    expect(Object.isFrozen(artifact.sleep.clips.bed_sleep.covers[0].heights)).toBe(true);live.release();expect(service.diagnostics()).toMatchObject({owners:0,entries:0,resourceOwners:0});
  }finally{service.dispose();}expect(transport.disposals).toBe(1);
});

it('head and garment edits retain bike work; uniform edits retain the complete configuration',async()=>{
  const {service,transport,bike,sleep}=setup(),a=defaultAppearance();
  try{
    const first=service.acquire('draft',a);await jobs(transport,1);transport.complete();await jobs(transport,2);transport.complete();await jobs(transport,3);transport.complete();const old=await first.ready;
    const b=structuredClone(a);b.face.jaw=100;b.top='jacket';const next=service.acquire('draft',b);await jobs(transport,4);
    expect(transport.requests[3].kind).toBe('sleep');first.release();transport.complete();await jobs(transport,5);transport.complete();const result=await next.ready;expect(result.bike).toBe(old.bike);
    const tint=structuredClone(b);tint.colors.hair=[1,2,3];tint.freckles=true;tint.freckle_density=91;tint.undertone='cool';
    expect(service.acquire('draft',tint)).toBe(next);expect(service.require('draft',tint)).toBe(result);expect(bike).toHaveBeenCalledTimes(1);expect(sleep).toHaveBeenCalledTimes(2);
  }finally{service.dispose();}
});

it('A-B-A rejects obsolete composite waiters while retaining matching in-flight work',async()=>{
  const {service,transport}=setup(),a=defaultAppearance(),b=defaultAppearance();b.face.jaw=100;
  try{
    const first=service.acquire('draft',a);await jobs(transport,1);transport.complete();await jobs(transport,2);
    const second=service.acquire('draft',b),last=service.acquire('draft',a);
    await expect(first.ready).rejects.toMatchObject({name:'AbortError'});await expect(second.ready).rejects.toMatchObject({name:'AbortError'});
    expect(service.diagnostics()).toMatchObject({owners:1,resourceOwners:3,entries:3,inFlight:1,queued:1});
    first.release();second.release();transport.complete();await jobs(transport,3);transport.complete();await last.ready;expect(transport.requests).toHaveLength(3);
  }finally{service.dispose();}
});

it('bounds obsolete full-body edits to newest components and one stale active resource',async()=>{
  const {service,transport}=setup(),a=defaultAppearance();
  try{
    service.acquire('draft',a);await jobs(transport,1);let latest;
    for(let height=0;height<100;height++){const edit=structuredClone(a);edit.body.height=height;latest=service.acquire('draft',edit);
      expect(service.diagnostics().entries).toBeLessThanOrEqual(4);expect(service.diagnostics().queued).toBeLessThanOrEqual(3);}
    transport.complete();await jobs(transport,2);transport.complete();await jobs(transport,3);transport.complete();await jobs(transport,4);transport.complete();await latest!.ready;
    expect(service.diagnostics()).toMatchObject({owners:1,resourceOwners:3,entries:3,inFlight:0,discardedResults:1});service.release('draft');expect(service.diagnostics().entries).toBe(0);
  }finally{service.dispose();}
});

it('retries a failed required component and releases cancelled jobs without publishing results',async()=>{
  const {service,transport}=setup(),a=defaultAppearance();
  const first=service.acquire('draft',a);await jobs(transport,1);transport.complete();await jobs(transport,2);transport.fail();await expect(first.ready).rejects.toThrow('Worker failed');
  const retry=service.acquire('draft',a);await jobs(transport,3);transport.complete();await jobs(transport,4);expect(transport.requests[3].kind).toBe('sleep');transport.complete();await retry.ready;
  const other=defaultAppearance('feminine'),pending=service.acquire('draft',other);await jobs(transport,5);service.dispose();
  await expect(pending.ready).rejects.toMatchObject({name:'AbortError'});expect(service.diagnostics()).toMatchObject({owners:0,entries:0,queued:0,inFlight:0,workerAlive:false});
});

it('retains the worker stack separately from the concise readiness error',async()=>{
  const {service,transport}=setup(),a=defaultAppearance(),stack='RangeError: Maximum call stack size exceeded\n    at SupportSurface (worker.ts:16:20)';
  try{
    const pending=service.acquire('draft',a);await jobs(transport,1);transport.complete();await jobs(transport,2);
    transport.reportFailure('Maximum call stack size exceeded','RangeError',stack);
    await expect(pending.ready).rejects.toMatchObject({message:'Maximum call stack size exceeded',workerStack:stack});
    expect(service.diagnostics()).toMatchObject({lastError:'Maximum call stack size exceeded',lastWorkerError:{name:'RangeError',kind:'sleep',stack}});
    expect(()=>validatePreparationResponse({version:1,id:1,kind:'sleep',ok:false,error:'Failed',workerStack:{message:'not a stack'}})).toThrow('Invalid character preparation error diagnostics');
  }finally{service.dispose();}
});

it('blocks admission on a failed seat artifact and retries only that required resource',async()=>{
  const {service,transport}=setup(),a=defaultAppearance();
  try{const first=service.acquire('load-candidate',a);await jobs(transport,1);transport.complete();await jobs(transport,2);transport.complete();await jobs(transport,3);
    expect(transport.requests[2].kind).toBe('seat');transport.fail();await expect(first.ready).rejects.toThrow('Worker failed');expect(()=>service.require('load-candidate',a)).toThrow(CharacterPreparationNotReadyError);
    const retry=service.acquire('load-candidate',a);await jobs(transport,4);expect(transport.requests[3].kind).toBe('seat');transport.complete();expect((await retry.ready).seat).toBe(service.require('load-candidate',a).seat);
  }finally{service.dispose();}
});
