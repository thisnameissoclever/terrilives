import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {loadGeometryAssets,loadBundle,type Bundle,geometryBuffers} from '../src/render/character/bundle.js';
import {readCharacterAsset} from '../src/render/character/asset-download.js';

it('retains the actual terminal HTTP response without collecting cookies',async()=>{
  vi.useFakeTimers();
  const response=new Response('<title>Service refused</title>request failed',{status:503,headers:{
    'Server':'edge-test','X-GitHub-Request-Id':'request-42','X-Cache':'HIT','Age':'120',
    'Retry-After':'60','Set-Cookie':'private-cookie','Authorization':'private-token',
  }});
  vi.stubGlobal('fetch',vi.fn(async()=>response));
  const outcome=readCharacterAsset(new URL('https://game.test/asset.bin?private=query')).catch(error=>error);
  await vi.runAllTimersAsync();
  const error=await outcome;
  expect(error.assetFailure).toMatchObject({path:'/asset.bin',status:503,
    headers:{server:'edge-test','x-github-request-id':'request-42','x-cache':'HIT',age:'120'},
    body:'<title>Service refused</title>request failed'});
  expect(JSON.stringify(error.assetFailure)).not.toMatch(/private-cookie|private-token|private=query/);
  expect(error.message).toContain('request-42');
});

it('keeps a terminal response bounded when its body never finishes',async()=>{
  const cancel=vi.fn(()=>new Promise<void>(()=>{}));
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(new ReadableStream({cancel}),{status:404})));
  const outcome=readCharacterAsset(new URL('https://game.test/asset.bin')).catch(error=>error);
  await vi.advanceTimersByTimeAsync(1000);
  expect(await Promise.race([outcome,Promise.resolve('still waiting')])).not.toBe('still waiting');
  expect(await outcome).toBeInstanceOf(Error);
});

it('continues the existing retry when cleanup of the preceding response never settles',async()=>{
  const cancel=vi.fn(()=>new Promise<void>(()=>{}));
  const fetcher=vi.fn().mockResolvedValueOnce(new Response(new ReadableStream({cancel}),{status:503}))
    .mockResolvedValueOnce(new Response(new Uint8Array([19])));
  vi.stubGlobal('fetch',fetcher);
  const outcome=readCharacterAsset(new URL('https://game.test/asset.bin'));
  await vi.advanceTimersByTimeAsync(500);
  expect(new Uint8Array(await outcome)).toEqual(new Uint8Array([19]));
  expect(cancel).toHaveBeenCalledTimes(1);expect(fetcher).toHaveBeenCalledTimes(2);
});

it('retains at most 1024 error-body bytes and cancels the remaining stream',async()=>{
  const cancel=vi.fn();
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(new ReadableStream({
    start(controller){controller.enqueue(new TextEncoder().encode('X'.repeat(65536)));},cancel,
  }),{status:404})));
  const error=await readCharacterAsset(new URL('https://game.test/asset.bin')).catch(error=>error);
  expect(error.assetFailure.body).toHaveLength(1024);
  expect(error.assetFailure.bodyIncomplete).toBe(true);expect(cancel).toHaveBeenCalledTimes(1);
});

const payloads={
  vertices:new Float32Array(48).buffer,indices:new Uint32Array([0,1,2]).buffer,
  cage:new Float32Array(48).buffer,stencilRanges:new Uint32Array([0,1,0,0,1,1,1,0,2,1,2,0]).buffer,
  stencilWeights:new ArrayBuffer(24),normalRanges:new Uint32Array([0,1,1,1,2,1]).buffer,
  normalTriangles:new Uint32Array([0,0,0]).buffer,
};
for(let i=0;i<3;i++){const view=new DataView(payloads.stencilWeights);view.setUint32(i*8,i,true);view.setFloat32(i*8+4,1,true);}
const description={vertexCount:3,indexCount:3,cageCount:3,coefficientCount:3,parts:[],
  ...Object.fromEntries(geometryBuffers.flatMap(name=>[[name,`runtime.${name}.bin`],[`${name}Sha256`,createHash('sha256').update(new Uint8Array(payloads[name])).digest('hex')]]))};
const manifest={version:3,runtime:description,original:description,
  animationSpace:'evaluated-parent-local-delta',bones:Array.from({length:17},()=>({})),
  actions:{idle:[[]]},basisActions:{idle:[[]]}} as unknown as Bundle;
const urls=Object.fromEntries(geometryBuffers.map(name=>[`runtime.${name}.bin`,`/assets/runtime.${name}.bin`]));

beforeEach(()=>{vi.useFakeTimers();vi.stubGlobal('location',{href:'https://game.test/'});});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});

it('finishes the real geometry load after one temporary 503 without refetching successful buffers',async()=>{
  let failed=false;
  const fetcher=vi.fn(async(input:URL)=>{
    const name=input.pathname.match(/runtime\.(\w+)\.bin$/)![1] as keyof typeof payloads;
    if(name==='normalTriangles'&&!failed){failed=true;return new Response('Service unavailable',{status:503});}
    return new Response(payloads[name].slice(0));
  });
  vi.stubGlobal('fetch',fetcher);
  const result=loadGeometryAssets(manifest,urls).then(value=>({value,error:null}),error=>({value:null,error}));
  await vi.runAllTimersAsync();
  const outcome=await result;
  expect(outcome.error).toBeNull();
  expect(Array.from(outcome.value!.normalTriangles)).toEqual([0,0,0]);
  expect(fetcher.mock.calls.filter(([url])=>url.pathname.endsWith('normalTriangles.bin'))).toHaveLength(2);
  expect(fetcher).toHaveBeenCalledTimes(8);
});

it('uses the same recovery path for a bundle manifest before validating its binary files',async()=>{
  let attempt=0;
  const fetcher=vi.fn(async(input:URL)=>{
    if(input.pathname.endsWith('manifest.json')){
      return ++attempt===1?new Response(null,{status:503}):Response.json(manifest);
    }
    const name=input.pathname.match(/runtime\.(\w+)\.bin$/)![1] as keyof typeof payloads;
    return new Response(payloads[name].slice(0));
  });
  vi.stubGlobal('fetch',fetcher);
  const result=loadBundle('/assets/manifest.json').then(value=>({value,error:null}),error=>({value:null,error}));
  await vi.runAllTimersAsync();
  const outcome=await result;expect(outcome.error).toBeNull();expect(outcome.value!.vertices.length).toBe(48);
  expect(attempt).toBe(2);
});

it.each([404,403,500,502,504])('keeps HTTP %i failures terminal without repeating the request',async status=>{
  const fetcher=vi.fn(async()=>new Response(null,{status}));vi.stubGlobal('fetch',fetcher);
  await expect(readCharacterAsset(new URL('https://game.test/asset.bin'))).rejects.toThrow(`Character asset could not load: ${status} /asset.bin`);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('stops after three 503 responses and releases each failed response body',async()=>{
  const cancelled=vi.fn();
  const fetcher=vi.fn(async(_input:URL,_init?:RequestInit)=>new Response(new ReadableStream({cancel:cancelled}),{status:503}));vi.stubGlobal('fetch',fetcher);
  const outcome=readCharacterAsset(new URL('https://game.test/asset.bin')).catch(error=>error);
  await vi.runAllTimersAsync();
  expect(await outcome).toMatchObject({message:'Character asset could not load: 503 /asset.bin',
    assetFailure:{status:503,path:'/asset.bin',bodyIncomplete:true}});
  expect(fetcher).toHaveBeenCalledTimes(3);expect(cancelled).toHaveBeenCalledTimes(3);
  expect(fetcher.mock.calls[0]).toHaveLength(1);
  expect(fetcher.mock.calls[1][1]).toEqual({cache:'reload'});
});

it.each(['2','Wed, 01 Jan 2031 00:00:02 GMT'])('honors Retry-After %s without issuing the next request early',async header=>{
  vi.setSystemTime(new Date('2031-01-01T00:00:00Z'));
  const fetcher=vi.fn().mockResolvedValueOnce(new Response(null,{status:503,headers:{'Retry-After':header}}))
    .mockResolvedValueOnce(new Response(new Uint8Array([17])));vi.stubGlobal('fetch',fetcher);
  const result=readCharacterAsset(new URL('https://game.test/asset.bin'));
  await vi.advanceTimersByTimeAsync(1999);expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);expect(new Uint8Array(await result)).toEqual(new Uint8Array([17]));
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it.each(['60','99999999999999999999999999999999'])('fails instead of shortening an excessive server delay: %s',async header=>{
  const fetcher=vi.fn(async()=>new Response(null,{status:503,headers:{'Retry-After':header}}));vi.stubGlobal('fetch',fetcher);
  await expect(readCharacterAsset(new URL('https://game.test/asset.bin'))).rejects.toThrow(/503/);
  expect(fetcher).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
});

it('bounds cumulative waiting across repeated service responses',async()=>{
  const fetcher=vi.fn(async()=>new Response(null,{status:503,headers:{'Retry-After':'10'}}));vi.stubGlobal('fetch',fetcher);
  const outcome=readCharacterAsset(new URL('https://game.test/asset.bin')).catch(error=>error);
  await vi.advanceTimersByTimeAsync(10_000);expect(await outcome).toBeInstanceOf(Error);
  expect(fetcher).toHaveBeenCalledTimes(2);expect(vi.getTimerCount()).toBe(0);
});

it.each(['invalid','0.5','-1'])('uses bounded backoff for malformed Retry-After: %s',async header=>{
  const fetcher=vi.fn().mockResolvedValueOnce(new Response(null,{status:503,headers:{'Retry-After':header}}))
    .mockResolvedValueOnce(new Response(new Uint8Array([23])));vi.stubGlobal('fetch',fetcher);
  const result=readCharacterAsset(new URL('https://game.test/asset.bin'));
  await vi.advanceTimersByTimeAsync(499);expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);expect(new Uint8Array(await result)[0]).toBe(23);
});

it('does not retry a network exception',async()=>{
  const error=new TypeError('Network connection failed'),fetcher=vi.fn().mockRejectedValue(error);vi.stubGlobal('fetch',fetcher);
  await expect(readCharacterAsset(new URL('https://game.test/asset.bin'))).rejects.toBe(error);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('recovers from 503 even when the unused error response body is already broken',async()=>{
  const body=new ReadableStream({start(controller){controller.error(new Error('Error body interrupted'));}});
  const fetcher=vi.fn().mockResolvedValueOnce(new Response(body,{status:503}))
    .mockResolvedValueOnce(new Response(new Uint8Array([31])));vi.stubGlobal('fetch',fetcher);
  const outcome=readCharacterAsset(new URL('https://game.test/asset.bin')).then(value=>({value,error:null}),error=>({value:null,error}));
  await vi.runAllTimersAsync();const result=await outcome;
  expect(result.error).toBeNull();expect(new Uint8Array(result.value!)[0]).toBe(31);expect(fetcher).toHaveBeenCalledTimes(2);
});

it('still rejects corrupted character data after a successful service recovery',async()=>{
  let attempt=0;
  const fetcher=vi.fn(async(input:URL)=>{
    const name=input.pathname.match(/runtime\.(\w+)\.bin$/)![1] as keyof typeof payloads;
    if(name==='normalTriangles'){
      if(++attempt===1)return new Response(null,{status:503});
      const bytes=payloads[name].slice(0);new Uint8Array(bytes)[0]^=1;return new Response(bytes);
    }
    return new Response(payloads[name].slice(0));
  });vi.stubGlobal('fetch',fetcher);
  const outcome=loadGeometryAssets(manifest,urls).catch(error=>error);await vi.runAllTimersAsync();
  expect((await outcome).message).toContain('Character asset hash differs');expect(attempt).toBe(2);
});
