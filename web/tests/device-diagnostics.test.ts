import {afterEach,expect,it,vi} from 'vitest';
import {initDevice} from '../src/render/device.js';
import {readCharacterAsset} from '../src/render/character/asset-download.js';

afterEach(()=>vi.unstubAllGlobals());
function capture(){
  const target=new EventTarget(),events:Array<{operation:string;details?:Record<string,unknown>;error?:Error}>=[];
  target.addEventListener('terrilives:diagnostic',event=>events.push((event as CustomEvent).detail));
  vi.stubGlobal('window',target);return events;
}
it('retains actual graphics validation and device-loss errors independently of startup readiness',async()=>{
  const events=capture();let lose!:(info:{reason:string;message:string})=>void;
  const device=Object.assign(new EventTarget(),{lost:new Promise(resolve=>{lose=resolve;})});
  const adapter={limits:{maxTextureDimension2D:8192},info:{vendor:'test'},requestDevice:vi.fn(async()=>device)};
  vi.stubGlobal('navigator',{gpu:{requestAdapter:async()=>adapter,getPreferredCanvasFormat:()=> 'bgra8unorm'}});
  const canvas={getContext:()=>({configure:vi.fn()})};
  await initDevice(canvas as unknown as HTMLCanvasElement);
  const validation=new Error('Render attachment is invalid');
  device.dispatchEvent(Object.assign(new Event('uncapturederror'),{error:validation}));
  lose({reason:'unknown',message:'GPU process reset'});await Promise.resolve();
  expect(events.find(row=>row.operation==='gpu.uncaptured-error')?.error).toBe(validation);
  expect(events.find(row=>row.operation==='gpu.device-lost')?.error?.message).toContain('GPU process reset');
  expect(events.filter(row=>row.operation==='gpu.acquire').map(row=>row.details?.state)).toEqual(['start','complete']);
});
it('records pending download context and preserves the identical transport error',async()=>{
  const events=capture(),error=new TypeError('Load failed');vi.stubGlobal('fetch',vi.fn(async()=>{throw error;}));
  await expect(readCharacterAsset(new URL('https://game.test/asset.bin?private=query'))).rejects.toBe(error);
  expect(events.filter(row=>row.operation==='asset.download').map(row=>row.details?.state)).toEqual(['start','failed']);
  expect(events.at(-1)?.error).toBe(error);expect(JSON.stringify(events)).not.toContain('private=query');
});
