import {afterEach,describe,expect,it,vi} from 'vitest';
import {loadAtlasTexture} from '../src/render/sprites.js';
import {uploadGrimePage} from '../src/render/grime-decals.js';
import {uploadFixtureDepth} from '../src/render/fixture-depth.js';
import {readFileSync} from 'node:fs';
import manifest from '../../assets/models/sims/character-repair/fixture-depth/manifest.json';

vi.mock('../src/render/body-coverage.js',()=>({loadBodyCoverage:vi.fn()}));
vi.mock('../src/render/dish-coverage.js',()=>({loadDishCoverage:vi.fn()}));
vi.mock('../src/render/indicator-coverage.js',()=>({loadIndicatorCoverage:vi.fn()}));

afterEach(()=>vi.unstubAllGlobals());

describe('atlas upload lifetime',()=>{
 it.each(['grime','companion'] as const)('waits for the %s upload before releasing its source or advancing',async kind=>{
  let rejectFence!:(error:Error)=>void,started!:()=>void;
  const fence=new Promise<void>((_resolve,reject)=>{rejectFence=reject;});
  void fence.catch(()=>{});
  const copied=new Promise<void>(resolve=>{started=resolve;});
  const bitmap={width:1536,height:1024,close:vi.fn()};
  const queue={copyExternalImageToTexture:vi.fn(()=>started()),writeTexture:vi.fn(()=>started()),
    onSubmittedWorkDone:vi.fn(()=>fence)};
  const device={queue} as unknown as GPUDevice;
  const bytes=kind==='companion'?readFileSync(new URL(
    '../../assets/models/sims/character-repair/fixture-depth/'+manifest.pages[0].path,import.meta.url)):new Uint8Array([0]);
  const fetcher=vi.fn(async()=>new Response(bytes));
  vi.stubGlobal('fetch',fetcher);
  vi.stubGlobal('createImageBitmap',vi.fn(async()=>bitmap));
  const loading=kind==='grime'?uploadGrimePage(device,{} as GPUTexture):uploadFixtureDepth(device,{} as GPUTexture);
  void loading.catch(()=>{});
  try{
   await copied;await Promise.resolve();
   expect(queue.onSubmittedWorkDone).toHaveBeenCalledTimes(1);
   expect(fetcher).toHaveBeenCalledTimes(1);
   expect(bitmap.close).not.toHaveBeenCalled();
  }finally{
   rejectFence(new Error('Graphics upload failed'));
   await expect(loading).rejects.toThrow('Graphics upload failed');
  }
  expect(bitmap.close).toHaveBeenCalledTimes(kind==='grime'?1:0);
 });
 it('keeps one decoded page until its upload completes and cleans up a failed upload',async()=>{
  let rejectFence!:(error:Error)=>void,started!:()=>void;
  const fence=new Promise<void>((_resolve,reject)=>{rejectFence=reject;});
  void fence.catch(()=>{});
  const copied=new Promise<void>(resolve=>{started=resolve;});
  const bitmap={width:2048,height:2048,close:vi.fn()};
  const texture={destroy:vi.fn()};
  const decode=vi.fn(async()=>bitmap);
  const queue={copyExternalImageToTexture:vi.fn(()=>started()),onSubmittedWorkDone:vi.fn(()=>fence)};
  const device={limits:{maxTextureDimension2D:8192,maxTextureArrayLayers:256},
    queue,createTexture:()=>texture} as unknown as GPUDevice;
  vi.stubGlobal('GPUTextureUsage',{TEXTURE_BINDING:4,COPY_DST:2,RENDER_ATTACHMENT:16});
  vi.stubGlobal('createImageBitmap',decode);
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(new Uint8Array([0]))));
  const loading=loadAtlasTexture(device);
  void loading.catch(()=>{});
  try{
   await copied;
   await Promise.resolve();
   expect(queue.onSubmittedWorkDone).toHaveBeenCalledTimes(1);
   expect(bitmap.close).not.toHaveBeenCalled();
   expect(decode).toHaveBeenCalledTimes(1);
  }finally{
   rejectFence(new Error('Graphics upload failed'));
   await expect(loading).rejects.toThrow();
  }
  expect(bitmap.close).toHaveBeenCalledTimes(1);
  expect(texture.destroy).toHaveBeenCalledTimes(1);
 });
});
