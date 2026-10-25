import {afterEach,describe,expect,it,vi} from 'vitest';
import {loadAtlasTexture} from '../src/render/sprites.js';
import {loadAtlasStorage} from '../src/render/atlas-storage.js';
import {uploadGrimePage} from '../src/render/grime-decals.js';
import {uploadFixtureDepth} from '../src/render/fixture-depth.js';
import {readFileSync} from 'node:fs';
import manifest from '../../assets/models/sims/character-repair/fixture-depth/manifest.json';

vi.mock('../src/render/atlas-storage.js',()=>({loadAtlasStorage:vi.fn()}));

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
 it('delegates the texture and lookup ownership together with unchanged progress',async()=>{
  const texture={} as GPUTexture,lookup={} as GPUBuffer,device={} as GPUDevice;
  const progress={files:vi.fn(),bytes:vi.fn()};
  vi.mocked(loadAtlasStorage).mockResolvedValueOnce({texture,lookup});
  await expect(loadAtlasTexture(device,progress)).resolves.toEqual({texture,lookup});
  expect(loadAtlasStorage).toHaveBeenLastCalledWith(device,progress);
 });
});
