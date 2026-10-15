import {afterEach,expect,it,vi} from 'vitest';
import {characterDevicePipelines,subdivisionDevicePipelines} from '../src/render/character/device-pipelines.js';

function device(){
  let lose!:(info:GPUDeviceLostInfo)=>void;
  const calls={shaders:0,renders:0,computes:0,layouts:0};
  const gpu={
    lost:new Promise<GPUDeviceLostInfo>(resolve=>{lose=resolve;}),
    createShaderModule:()=>{calls.shaders++;return {};},
    createBindGroupLayout:()=>{calls.layouts++;return {};},
    createPipelineLayout:()=>({}),
    createRenderPipeline:()=>{calls.renders++;return {};},
    createComputePipeline:()=>{calls.computes++;return {};},
  } as unknown as GPUDevice;
  return {gpu,calls,lose:()=>lose({reason:'destroyed',message:'Test device replaced'} as GPUDeviceLostInfo)};
}
afterEach(()=>vi.unstubAllGlobals());
it('compiles each immutable character program once per device, independently of actor count',()=>{
  vi.stubGlobal('GPUShaderStage',{VERTEX:1,FRAGMENT:2,COMPUTE:4});
  const first=device(),second=device(),draw=characterDevicePipelines(first.gpu),compute=subdivisionDevicePipelines(first.gpu);
  for(let i=0;i<12;i++){
    expect(characterDevicePipelines(first.gpu)).toBe(draw);
    expect(subdivisionDevicePipelines(first.gpu)).toBe(compute);
  }
  expect(first.calls).toEqual({shaders:4,renders:4,computes:3,layouts:1});
  expect(characterDevicePipelines(second.gpu)).not.toBe(draw);
  expect(subdivisionDevicePipelines(second.gpu)).not.toBe(compute);
  expect(second.calls).toEqual(first.calls);
});
it('invalidates the lost device without discarding another device programs',async()=>{
  vi.stubGlobal('GPUShaderStage',{VERTEX:1,FRAGMENT:2,COMPUTE:4});
  const first=device(),second=device();
  characterDevicePipelines(first.gpu);subdivisionDevicePipelines(first.gpu);
  const retained=characterDevicePipelines(second.gpu);
  first.lose();await first.gpu.lost;await Promise.resolve();
  expect(()=>characterDevicePipelines(first.gpu)).toThrow('lost');
  expect(()=>subdivisionDevicePipelines(first.gpu)).toThrow('lost');
  expect(characterDevicePipelines(second.gpu)).toBe(retained);
  expect(first.calls).toEqual({shaders:4,renders:4,computes:3,layouts:1});
});
