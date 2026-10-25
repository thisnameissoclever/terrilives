import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {ATLAS_STORAGE} from '../src/render/atlas-storage-metadata.js';
import {SPRITES} from '../src/render/atlas.js';
import {validateAtlasStorage, decodeAtlasLookup, decodeAtlasCoverage, loadAtlasStorage} from '../src/render/atlas-storage.js';
import {sampleBodyCoverage, setBodyCoverage} from '../src/render/body-coverage.js';
import {sampleDishCoverage} from '../src/render/dish-coverage.js';
import {indicatorAnchorY} from '../src/render/indicator-coverage.js';

const disk = (file: string) => new Uint8Array(readFileSync(new URL('../public/'+file, import.meta.url)));
const rawLookup = new Uint8Array(gunzipSync(disk(ATLAS_STORAGE.lookup.file)));
const rawCoverage = new Uint8Array(gunzipSync(disk(ATLAS_STORAGE.coverage.file)));
const clone = () => JSON.parse(JSON.stringify(ATLAS_STORAGE));
function gpu() {
  const texture={destroy:vi.fn()}, lookup={destroy:vi.fn()};
  const queue={writeBuffer:vi.fn(),copyExternalImageToTexture:vi.fn(),onSubmittedWorkDone:vi.fn(async()=>{})};
  const device={limits:{maxTextureDimension2D:8192,maxTextureArrayLayers:256,maxStorageBufferBindingSize:128*1024*1024,
    maxBufferSize:256*1024*1024,maxStorageBuffersPerShaderStage:8},queue,pushErrorScope:vi.fn(),popErrorScope:vi.fn(async()=>null),createTexture:vi.fn(()=>texture),createBuffer:vi.fn(()=>lookup)};
  return {device:device as unknown as GPUDevice,texture,lookup,queue};
}
beforeEach(()=>{vi.stubGlobal('GPUTextureUsage',{TEXTURE_BINDING:4,COPY_DST:2,RENDER_ATTACHMENT:16});vi.stubGlobal('GPUBufferUsage',{STORAGE:128,COPY_DST:8});});
afterEach(()=>vi.unstubAllGlobals());

describe('committed atlas packet validation',()=>{
  it('accepts the entire committed catalogue, lookup and CPU coverage',async()=>{
    validateAtlasStorage(ATLAS_STORAGE,gpu().device);
    const lookup=await decodeAtlasLookup(rawLookup,ATLAS_STORAGE);
    const packet=await decodeAtlasCoverage(rawCoverage,ATLAS_STORAGE);
    expect(lookup.length).toBe(55*256*256);
    expect(Math.max(...lookup.subarray(0,65536))).toBeGreaterThan(0);
    expect(packet.bodies).toHaveLength(1428);expect(packet.dishes).toHaveLength(16);expect(packet.indicators).toHaveLength(62);
  });
  it.each(['virtualSize','virtualLayers','tileSize','border','physicalSize','tilesPerRow','uniqueTiles'])(
    'rejects invalid layout %s before allocation',key=>{const m=clone();m[key]=0;expect(()=>validateAtlasStorage(m,gpu().device)).toThrow();});
  it.each(['file','sha256','width','height'])('rejects stale original source %s',key=>{
    const m=clone();m.sources[0][key]=key==='file'?'web/public/other.png':key==='sha256'?'0'.repeat(64):1024;
    expect(()=>validateAtlasStorage(m,gpu().device)).toThrow(/source|catalogue/);
  });
  it('matches every source receipt to actual committed source bytes',async()=>{
    for(const source of ATLAS_STORAGE.sources){
      const bytes=new Uint8Array(readFileSync(new URL('../../'+source.file,import.meta.url)));
      expect(await hash(bytes),source.file).toBe(source.sha256);
    }
  });
  it('rejects stale fixture identities and grime dimensions',()=>{
    const m=clone();m.companions[0].sha256='0'.repeat(64);expect(()=>validateAtlasStorage(m,gpu().device)).toThrow(/source|catalogue/);
    const n=clone();n.sources[42].width=2048;expect(()=>validateAtlasStorage(n,gpu().device)).toThrow(/source|catalogue/);
  });
  it.each([['maxTextureDimension2D',1024],['maxTextureArrayLayers',20],['maxStorageBufferBindingSize',1024],['maxBufferSize',1024],['maxStorageBuffersPerShaderStage',3]])(
    'rejects device %s before fetch',async(key,value)=>{const {device}=gpu();Object.assign(device.limits,{[key]:value});const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
      await expect(loadAtlasStorage(device)).rejects.toThrow(/limit/);expect(fetcher).not.toHaveBeenCalled();expect(device.createTexture).not.toHaveBeenCalled();});
  it('rejects raw lookup length, checksum, header and out-of-range entries',async()=>{
    await expect(decodeAtlasLookup(rawLookup.subarray(1),ATLAS_STORAGE)).rejects.toThrow(/length/);
    const bad=rawLookup.slice();bad[4]^=1;await expect(decodeAtlasLookup(bad,ATLAS_STORAGE)).rejects.toThrow(/hash/);
    const m=clone();new DataView(bad.buffer).setUint32(4,m.uniqueTiles+1,true);m.lookup.sha256=await hash(bad);
    await expect(decodeAtlasLookup(bad,m)).rejects.toThrow(/lookup/);
    bad[0]=0;m.lookup.sha256=await hash(bad);await expect(decodeAtlasLookup(bad,m)).rejects.toThrow(/header/);
  });
  it.each(['missing','duplicate','span','alignment','length','indicator'])('rejects malformed complete CPU records: %s',async kind=>{
    const m=clone();
    if(kind==='missing')m.coverage.bodies.pop();
    if(kind==='duplicate')m.coverage.dishes[1]=m.coverage.dishes[0];
    if(kind==='span')m.coverage.bodies[0].opaque[0]=m.coverage.length;
    if(kind==='alignment')m.coverage.bodies[0].partialPixels[0]++;
    if(kind==='length')m.coverage.dishes[0].alpha[1]--;
    if(kind==='indicator')m.coverage.indicators[0].bottomPixels=0.12345;
    await expect(decodeAtlasCoverage(rawCoverage,m)).rejects.toThrow(/coverage/);
  });
  it.each(['order','alpha','overlap','range'])('rejects malformed body %s',async kind=>{
    const m=clone(),bytes=rawCoverage.slice();
    const row=m.coverage.bodies[0];
    expect(row).toBeDefined();const view=new DataView(bytes.buffer),pixel=view.getUint32(row.partialPixels[0],true);
    if(kind==='order')view.setUint32(row.partialPixels[0]+4,pixel,true);
    if(kind==='range')view.setUint32(row.partialPixels[0],0xffffffff,true);
    if(kind==='alpha')bytes[row.partialAlpha[0]]=255;
    if(kind==='overlap')bytes[row.opaque[0]+(pixel>>>3)]|=1<<(pixel&7);
    m.coverage.sha256=await hash(bytes);await expect(decodeAtlasCoverage(bytes,m)).rejects.toThrow(/coverage/);
  });
});
async function hash(bytes:Uint8Array<ArrayBuffer>){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');}

function downloads(transform?:(file:string,bytes:Uint8Array<ArrayBuffer>)=>Uint8Array<ArrayBuffer>){
 const fetcher=vi.fn(async(url:string)=>{const file=url.replace(/^\.\//,'').replace(/^\//,'');const bytes=disk(file);return new Response(transform?transform(file,bytes):bytes);});
 vi.stubGlobal('fetch',fetcher);return fetcher;
}
describe('physical uploads and ownership',()=>{
 it('rejects a corrupt downloaded CPU payload before GPU allocation',async()=>{
  const {device}=gpu();downloads((file,bytes)=>{if(file===ATLAS_STORAGE.coverage.file)bytes[20]^=1;return bytes;});
  await expect(loadAtlasStorage(device)).rejects.toThrow(/hash/);
  expect(device.createTexture).not.toHaveBeenCalled();expect(device.createBuffer).not.toHaveBeenCalled();
 });
 it('does not publish any CPU masks when the first upload fails',async()=>{
  const row=ATLAS_STORAGE.coverage.bodies[0],rect=SPRITES[row.sprite];
  setBodyCoverage(row.sprite,new Uint8Array(rect.w*rect.h).fill(99));
  const before=sampleBodyCoverage(row.sprite,0,0),indicator=ATLAS_STORAGE.coverage.indicators[0].sprite;
  expect(()=>indicatorAnchorY(indicator,100,1)).toThrow(/not loaded/);
  const {device,queue}=gpu();downloads();queue.onSubmittedWorkDone.mockRejectedValueOnce(Error('failed upload'));
  const bitmap={width:2048,height:2048,close:vi.fn()};vi.stubGlobal('createImageBitmap',vi.fn(async()=>bitmap));
  await expect(loadAtlasStorage(device)).rejects.toThrow('failed upload');
  expect(sampleBodyCoverage(row.sprite,0,0)).toBe(before);expect(()=>indicatorAnchorY(indicator,100,1)).toThrow(/not loaded/);
  expect(bitmap.close).toHaveBeenCalledTimes(1);
 });
 it('keeps one bitmap until its fence and bounds encoded prefetch to four pages',async()=>{
  const {device,texture,lookup,queue}=gpu();const fetcher=downloads();const bitmaps:{width:number;height:number;close:ReturnType<typeof vi.fn>}[]=[];
  let release!:()=>void,started!:()=>void;const copied=new Promise<void>(r=>{started=r;});
  const fence=new Promise<void>(r=>{release=r;});queue.onSubmittedWorkDone.mockImplementationOnce(()=>fence);
  queue.copyExternalImageToTexture.mockImplementationOnce(()=>started());
  vi.stubGlobal('createImageBitmap',vi.fn(async()=>{const b={width:2048,height:2048,close:vi.fn()};bitmaps.push(b);return b;}));
  const files=vi.fn();const loading=loadAtlasStorage(device,{files});await copied;
  expect(bitmaps).toHaveLength(1);expect(bitmaps[0].close).not.toHaveBeenCalled();
  expect(fetcher.mock.calls.filter(([url])=>url.endsWith('.png')).length).toBeLessThanOrEqual(4);
  release();await expect(loading).resolves.toEqual({texture,lookup});expect(bitmaps).toHaveLength(21);
  expect(device.createTexture).toHaveBeenCalledWith(expect.objectContaining({usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT}));
  for(const bitmap of bitmaps)expect(bitmap.close).toHaveBeenCalledTimes(1);
  expect(files).toHaveBeenLastCalledWith(23,23);expect(queue.writeBuffer).toHaveBeenCalledTimes(1);
  const row=ATLAS_STORAGE.coverage.bodies[0],rect=SPRITES[row.sprite],density=rect.pixel_density??1;
  const pixel=new DataView(rawCoverage.buffer).getUint32(row.partialPixels[0],true);
  expect(sampleBodyCoverage(row.sprite,(pixel%rect.w+.5)/density,(Math.floor(pixel/rect.w)+.5)/density)).toBeCloseTo(rawCoverage[row.partialAlpha[0]]/255);
  const dish=ATLAS_STORAGE.coverage.dishes[0],dr=SPRITES[dish.sprite],dd=dr.pixel_density??1;
  expect(sampleDishCoverage(dish.sprite,.5/dd,.5/dd)).toBe(rawCoverage[dish.alpha[0]]/255);
  expect(Number.isFinite(indicatorAnchorY(ATLAS_STORAGE.coverage.indicators[0].sprite,100,1))).toBe(true);
 });
 it('reuses installed CPU coverage on repeated successful loads',async()=>{
  const {device}=gpu(),fetcher=downloads();
  vi.stubGlobal('createImageBitmap',vi.fn(async()=>({width:2048,height:2048,close:vi.fn()})));
  await loadAtlasStorage(device);await loadAtlasStorage(device);
  expect(fetcher.mock.calls.some(([url])=>url.includes('/coverage-'))).toBe(false);
  expect(device.createTexture).toHaveBeenCalledTimes(2);expect(device.createBuffer).toHaveBeenCalledTimes(2);
 });
 it('releases every uploaded bitmap and both resources after a late failure',async()=>{
  const {device,texture,lookup,queue}=gpu();downloads();let uploads=0;
  queue.onSubmittedWorkDone.mockImplementation(async()=>{if(++uploads===20)throw Error('late upload failure');});
  const bitmaps:{close:ReturnType<typeof vi.fn>}[]=[];
  vi.stubGlobal('createImageBitmap',vi.fn(async()=>{const bitmap={width:2048,height:2048,close:vi.fn()};bitmaps.push(bitmap);return bitmap;}));
  await expect(loadAtlasStorage(device)).rejects.toThrow('late upload failure');
  expect(bitmaps).toHaveLength(20);for(const bitmap of bitmaps)expect(bitmap.close).toHaveBeenCalledTimes(1);
  expect(texture.destroy).toHaveBeenCalledTimes(1);expect(lookup.destroy).toHaveBeenCalledTimes(1);
 });
 it.each(['hash','shape','copy','fence','buffer','validation','out-of-memory'])('cleans failed %s resources and permits retry',async kind=>{
  const {device,texture,lookup,queue}=gpu();downloads((file,bytes)=>{if(kind==='hash'&&file.endsWith('.png')){bytes[30]^=1;}return bytes;});
  const bitmap={width:kind==='shape'?1024:2048,height:2048,close:vi.fn()};vi.stubGlobal('createImageBitmap',vi.fn(async()=>bitmap));
  if(kind==='copy')queue.copyExternalImageToTexture.mockImplementationOnce(()=>{throw Error('copy failed');});
  if(kind==='fence')queue.onSubmittedWorkDone.mockRejectedValueOnce(Error('fence failed'));
  if(kind==='validation'||kind==='out-of-memory')vi.mocked(device.popErrorScope).mockResolvedValueOnce({message:kind} as GPUError);
  if(kind==='buffer')vi.mocked(device.createBuffer).mockImplementationOnce(()=>{throw Error('buffer failed');});
  await expect(loadAtlasStorage(device)).rejects.toThrow();expect(texture.destroy).toHaveBeenCalledTimes(1);
  expect(lookup.destroy).toHaveBeenCalledTimes(kind==='buffer'?0:1);expect(bitmap.close).toHaveBeenCalledTimes(kind==='hash'||kind==='buffer'?0:kind==='validation'||kind==='out-of-memory'?21:1);
  downloads();bitmap.width=2048;await expect(loadAtlasStorage(device)).resolves.toEqual({texture,lookup});
 });
});
