import {expect,it,vi} from 'vitest';
import {defaultAppearance} from '../src/character/schema.js';
import {BikeContactService,BikeContactNotReadyError,bikeContactAppearanceKey} from '../src/render/character/bike-contact-service.js';
import {FakeBikeContactTransport,testInput,testArtifact} from './bike-contact-service-fixture.js';

const jobs=(transport:FakeBikeContactTransport,count:number)=>vi.waitFor(()=>expect(transport.requests).toHaveLength(count),{interval:1,timeout:1000});
const appearance=(height=50)=>{const a=defaultAppearance();a.body.height=height;return a;};
function service(){const transport=new FakeBikeContactTransport(),inputFactory=vi.fn(testInput),value=new BikeContactService({inputFactory,transportFactory:()=>transport});return {value,transport,inputFactory};}

it('admits immutable results, clears in-flight state before ready, and transfers owners synchronously',async()=>{
  const {value,transport,inputFactory}=service(),a=appearance();
  try{
    const stage=value.acquire('stage',a);expect(()=>value.require('stage',a)).toThrow(BikeContactNotReadyError);
    await jobs(transport,1);transport.complete(0);const artifact=await stage.ready;
    expect(value.diagnostics().inFlight).toBe(0);expect(Object.isFrozen(artifact.fit.feet[0].rotation)).toBe(true);
    const live=value.acquire('live',structuredClone(a));expect(value.require('live',a)).toBe(artifact);
    stage.release();expect(value.require('live',a)).toBe(artifact);expect(await live.ready).toBe(artifact);
    expect(inputFactory).toHaveBeenCalledTimes(1);expect(transport.requests).toHaveLength(1);
    live.release();expect(value.diagnostics()).toMatchObject({owners:0,entries:0,queued:0,inFlight:0});
  }finally{value.dispose();}
  expect(transport.disposals).toBe(1);
});

it('coalesces rapid A-B-A edits onto the matching in-flight job',async()=>{
  const {value,transport,inputFactory}=service(),a=appearance(20),b=appearance(80);
  try{
    const first=value.acquire('draft',a);await jobs(transport,1);
    const second=value.acquire('draft',b),third=value.acquire('draft',a);
    await expect(first.ready).rejects.toMatchObject({name:'AbortError'});await expect(second.ready).rejects.toMatchObject({name:'AbortError'});
    expect(third.generation).toBeGreaterThan(first.generation);expect(value.diagnostics()).toMatchObject({owners:1,entries:1,queued:0,inFlight:1});
    first.release();transport.complete(0);expect(await third.ready).toBe(value.require('draft',a));
    expect(inputFactory).toHaveBeenCalledTimes(1);expect(transport.requests).toHaveLength(1);
  }finally{value.dispose();}
});

it('keeps current live owners and newest draft only, with one stale in-flight job',async()=>{
  const {value,transport}=service();
  try{
    const old=value.acquire('draft',appearance(0));await jobs(transport,1);
    let latest=old;
    for(let height=1;height<=100;height++){
      latest=value.acquire('draft',appearance(height));
      expect(value.diagnostics().entries).toBeLessThanOrEqual(2);expect(value.diagnostics().queued).toBeLessThanOrEqual(1);
    }
    const live=value.acquire('live',appearance(25));expect(value.diagnostics()).toMatchObject({owners:2,entries:3,queued:2,inFlight:1});
    transport.complete(0);await jobs(transport,2);expect(transport.requests[1].input.hip[0]).toBe(1);
    transport.complete(1);await latest.ready;await jobs(transport,3);transport.complete(2);await live.ready;
    expect(transport.maxActive).toBe(1);expect(value.diagnostics()).toMatchObject({owners:2,entries:2,queued:0,inFlight:0,discardedResults:1});
    value.release('draft');value.release('live');expect(value.diagnostics().entries).toBe(0);
  }finally{value.dispose();}
});

it('discards superseded input preparation before sending it to the worker',async()=>{
  const transport=new FakeBikeContactTransport();let finish!:(input:Awaited<ReturnType<typeof testInput>>)=>void;
  const pending=new Promise<Awaited<ReturnType<typeof testInput>>>(resolve=>{finish=resolve;});
  const value=new BikeContactService({inputFactory:a=>a.body.height===10?pending:testInput(a),transportFactory:()=>transport});
  try{
    const first=value.acquire('draft',appearance(10)),last=value.acquire('draft',appearance(90));
    await expect(first.ready).rejects.toMatchObject({name:'AbortError'});expect(transport.requests).toHaveLength(0);
    finish(await testInput(appearance(10)));await jobs(transport,1);expect(transport.requests[0].input.hip[0]).toBe(.9);
    transport.complete(0);await last.ready;expect(value.diagnostics()).toMatchObject({inputPreparations:2,compilations:1,discardedResults:1});
  }finally{value.dispose();}
});

it('rejects mismatched or malformed worker results without publishing them and permits explicit retry',async()=>{
  const {value,transport}=service(),a=appearance();
  try{
    const first=value.acquire('live',a);await jobs(transport,1);
    const artifact=testArtifact(transport.requests[0].input);artifact.shapeKey='wrong-body';
    transport.complete(0,{version:1,id:transport.requests[0].id,ok:true,artifact});
    await expect(first.ready).rejects.toThrow('does not match');expect(()=>value.require('live',a)).toThrow(BikeContactNotReadyError);
    const retry=value.acquire('live',a);expect(retry.generation).toBeGreaterThan(first.generation);
    await jobs(transport,2);transport.complete(1);await retry.ready;expect(value.require('live',a).shapeKey).not.toBe('wrong-body');
  }finally{value.dispose();}
});

it('reports preparation and worker failures without synchronous construction or a replacement artifact',async()=>{
  const bad=new BikeContactService({inputFactory:async()=>{throw new Error('bad source');},transportFactory:()=>{throw new Error('must not start');}});
  const lease=bad.acquire('live',appearance());await expect(lease.ready).rejects.toThrow('bad source');expect(bad.diagnostics()).toMatchObject({compilations:0,lastError:'bad source',inFlight:0});bad.dispose();
  const {value,transport}=service();
  try{const live=value.acquire('live',appearance());await jobs(transport,1);transport.fail(0,new Error('worker failed'));await expect(live.ready).rejects.toThrow('worker failed');expect(()=>value.require('live',appearance())).toThrow(BikeContactNotReadyError);}
  finally{value.dispose();}
});

it('terminates the worker on disposal and never publishes its late result',async()=>{
  const {value,transport}=service(),a=appearance(),lease=value.acquire('live',a);await jobs(transport,1);
  value.dispose();await expect(lease.ready).rejects.toMatchObject({name:'AbortError'});transport.complete(0);await Promise.resolve();
  expect(value.diagnostics()).toMatchObject({owners:0,entries:0,queued:0,inFlight:0,workerAlive:false,disposed:true});
  expect(()=>value.acquire('next',a)).toThrow('disposed');expect(()=>value.require('live',a)).toThrow(BikeContactNotReadyError);
  value.dispose();expect(transport.disposals).toBe(1);
});

it('does not invalidate admission for color, face, hair or upper-garment choices',async()=>{
  const {value,transport,inputFactory}=service(),a=appearance();
  try{
    const lease=value.acquire('live',a);await jobs(transport,1);transport.complete(0);const artifact=await lease.ready;
    const changed=structuredClone(a);changed.colors.shirt=[1,2,3];changed.face.jaw=100;changed.hairstyle='bob';changed.top='jacket';changed.sleeves='short';
    expect(bikeContactAppearanceKey(changed)).toBe(bikeContactAppearanceKey(a));expect(value.acquire('live',changed)).toBe(lease);expect(value.require('live',changed)).toBe(artifact);
    expect(inputFactory).toHaveBeenCalledTimes(1);
    changed.footwear='trainers';expect(()=>value.require('live',changed)).toThrow(BikeContactNotReadyError);
  }finally{value.dispose();}
});
