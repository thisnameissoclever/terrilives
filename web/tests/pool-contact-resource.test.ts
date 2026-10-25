import {freePoolPolicy} from './pool-policy-fixture.js';
import {expect,it,vi} from 'vitest';
import {defaultAppearance} from '../src/character/schema.js';
import {PreparationQueue} from '../src/render/character/preparation-queue.js';
import {poolContactResource} from '../src/render/character/pool-contact-resource.js';
import {createPoolContactInput} from '../src/render/character/pool-contact-preparation.js';
import {POOL_INTERPOLATION_REVISION,POOL_OBSERVER_REVISION,type PoolContactInputV1,type PoolContactArtifactV1,type PoolPreparedTrack} from '../src/render/character/pool-contact-types.js';
import {identity} from '../src/render/character/math.js';

/** Synthetic protocol/queue data. No evaluated physical surface or admission witness. */
function schemaArtifact(input:PoolContactInputV1):PoolContactArtifactV1 {
  const track=(keys:{phase:number;pose:number}[]):PoolPreparedTrack=>({keys,intervals:keys.slice(1).map(()=>({controls:[],supportLimbs:[],policy:freePoolPolicy(),status:'measured',
    observerRevision:POOL_OBSERVER_REVISION,interpolationRevision:POOL_INTERPOLATION_REVISION,
    observations:[0,.5,1].map(fraction=>({fraction,minimumObservedClearance:0,minimumClassifiedClearance:0,arithmeticContacts:[],airwayMinimum:1,rootReachSatisfied:true,supports:[]}))}))});
  return {...input,source:'synthetic queue fixture',partKeys:['synthetic body','synthetic garment'],shapeKey:'synthetic',top:2,waterHeight:.82,
    graph:{poses:[{preferenceBasis:Array.from({length:17},identity),controls:[],policy:freePoolPolicy()},{preferenceBasis:Array.from({length:17},identity),controls:[],policy:freePoolPolicy()}],entry:track([{phase:0,pose:0},{phase:1,pose:1}]),
      paddle:track(Array.from({length:13},(_,index)=>({phase:index/12,pose:1}))),bridges:Array.from({length:12},()=>track([{phase:0,pose:1},{phase:1,pose:1}]))},
    coverage:{observerRevision:POOL_OBSERVER_REVISION,samples:75,interpolationSamples:25,minimumObservedClearance:0,minimumClassifiedClearance:0,continuousBound:false}};
}
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(yes=>{resolve=yes;});return {promise,resolve};}
const turn=()=>new Promise<void>(resolve=>queueMicrotask(resolve));

it('cancels obsolete pool input work before compilation and ignores its late completion',async()=>{
  const queue=new PreparationQueue<PoolContactArtifactV1>(),a=defaultAppearance(),gate=deferred<PoolContactInputV1>();
  const compile=vi.fn(async(input:PoolContactInputV1)=>schemaArtifact(input));
  const definition=poolContactResource({inputFactory:()=>gate.promise,compile});
  try{
    const lease=queue.acquire('draft',a,definition);lease.release();await turn();
    await expect(lease.ready).rejects.toMatchObject({name:'AbortError'});gate.resolve(await createPoolContactInput(a));await turn();await turn();
    expect(compile).not.toHaveBeenCalled();expect(queue.diagnostics()).toMatchObject({owners:0,entries:0,ready:0,inFlight:0});
  }finally{queue.dispose();}
});

it('retains shared pool compilation until its final owner leaves and rejects late publication',async()=>{
  const queue=new PreparationQueue<PoolContactArtifactV1>(),a=defaultAppearance(),pending=deferred<unknown>(),calls:{input:PoolContactInputV1;signal:AbortSignal}[]=[];
  const definition=poolContactResource({compile:async(input,signal)=>{calls.push({input,signal});return pending.promise;}});
  try{
    const first=queue.acquire('draft',a,definition),second=queue.acquire('live',a,definition);
    await vi.waitFor(()=>expect(calls).toHaveLength(1),{interval:1,timeout:1000});
    first.release();await turn();expect(calls[0].signal.aborted).toBe(false);
    second.release();await turn();expect(calls[0].signal.aborted).toBe(true);
    await expect(first.ready).rejects.toMatchObject({name:'AbortError'});await expect(second.ready).rejects.toMatchObject({name:'AbortError'});
    pending.resolve(schemaArtifact(calls[0].input));await turn();await turn();
    expect(queue.require('live',definition.key(a))).toBeUndefined();expect(queue.diagnostics().ready).toBe(0);
  }finally{queue.dispose();}
});

it('rejects incomplete or stale pool graphs, retries the failed key and freezes retained protocol data',async()=>{
  const queue=new PreparationQueue<PoolContactArtifactV1>(),a=defaultAppearance();let failures=2;
  const compile=vi.fn(async(input:PoolContactInputV1)=>{
    const value=schemaArtifact(input);if(failures===2)value.graph.entry.intervals=[];else if(failures===1)value.revisions={...value.revisions,fixture:'f'.repeat(64)};failures--;return value;
  });
  const definition=poolContactResource({compile});
  try{
    await expect(queue.acquire('draft',a,definition).ready).rejects.toThrow('incomplete interval');
    await expect(queue.acquire('draft',a,definition).ready).rejects.toThrow('requested physical inputs');
    const lease=queue.acquire('draft',a,definition),artifact=await lease.ready;
    expect(Object.isFrozen(artifact.graph.poses[0].preferenceBasis[0])).toBe(true);expect(compile).toHaveBeenCalledTimes(3);
    const tint=structuredClone(a);tint.colors.hair=[1,2,3];expect(queue.acquire('draft',tint,definition)).toBe(lease);
    expect(queue.require('draft',definition.key(tint))).toBe(artifact);
  }finally{queue.dispose();}
});

it('rejects a valid input digest for a different physical appearance before dispatch',async()=>{
  const queue=new PreparationQueue<PoolContactArtifactV1>(),a=defaultAppearance(),other=structuredClone(a);other.body.height=99;
  const compile=vi.fn(async(input:PoolContactInputV1)=>schemaArtifact(input));
  const definition=poolContactResource({inputFactory:()=>createPoolContactInput(other),compile});
  try{await expect(queue.acquire('draft',a,definition).ready).rejects.toThrow('requested physical appearance');expect(compile).not.toHaveBeenCalled();}
  finally{queue.dispose();}
});
