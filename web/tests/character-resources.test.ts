import { expect, it } from 'vitest';
import { acquireStaticCharacterBuffers } from '../src/render/character/resources.js';
import type { Geometry } from '../src/render/character/bundle.js';

it('shares immutable buffers until the last actor releases them',()=>{
  Object.assign(globalThis,{GPUBufferUsage:{STORAGE:128,INDEX:16,COPY_DST:8}});
  const created:{size:number;destroyed:boolean;destroy():void}[]=[];
  const device={lost:new Promise(()=>{}),queue:{writeBuffer(){}},createBuffer({size}:{size:number}){const buffer={size,destroyed:false,destroy(){this.destroyed=true;}};created.push(buffer);return buffer;}} as unknown as GPUDevice;
  const geometry={indices:new Uint32Array([0,1,2]),stencilRanges:new Uint32Array(12),stencilWeights:new ArrayBuffer(24),
    normalRanges:new Uint32Array(6),normalTriangles:new Uint32Array([0,0,0]),manifest:{materials:[{colour:[1,1,1,1],ramp:[],group:0,unlit:false,interpolation:'CONSTANT'}]}} as unknown as Geometry;
  const first=acquireStaticCharacterBuffers(device,geometry),second=acquireStaticCharacterBuffers(device,geometry);
  expect(first.buffers).toBe(second.buffers);
  expect(created).toHaveLength(6);
  first.release();first.release();
  expect(created.some(buffer=>buffer.destroyed)).toBe(false);
  second.release();
  expect(created.every(buffer=>buffer.destroyed)).toBe(true);
  const third=acquireStaticCharacterBuffers(device,geometry);
  expect(third.buffers).not.toBe(first.buffers);
  expect(created).toHaveLength(12);
  third.release();
});

it('destroys shared buffers on device loss and refuses reuse of the lost device',async()=>{
  Object.assign(globalThis,{GPUBufferUsage:{STORAGE:128,INDEX:16,COPY_DST:8}});
  let lose!:()=>void;let destroyed=0;
  const device={lost:new Promise<void>(resolve=>{lose=resolve;}),queue:{writeBuffer(){}},createBuffer({size}:{size:number}){return {size,destroy(){destroyed++;}};}} as unknown as GPUDevice;
  const geometry={indices:new Uint32Array([0]),stencilRanges:new Uint32Array(4),stencilWeights:new ArrayBuffer(8),normalRanges:new Uint32Array(2),normalTriangles:new Uint32Array([0]),
    manifest:{materials:[{colour:[1,1,1,1],ramp:[],group:0,unlit:false,interpolation:'CONSTANT'}]}} as unknown as Geometry;
  const first=acquireStaticCharacterBuffers(device,geometry),second=acquireStaticCharacterBuffers(device,geometry);
  lose();await Promise.resolve();
  expect(destroyed).toBe(6);expect(()=>acquireStaticCharacterBuffers(device,geometry)).toThrow('lost');
  first.release();second.release();expect(destroyed).toBe(6);
});
