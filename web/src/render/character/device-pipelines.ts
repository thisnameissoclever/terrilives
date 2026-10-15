import {characterShaderSource,characterBindGroupLayoutEntries,characterPipelineDescriptor,
  subdivisionShaderSources,subdivisionPipelineDescriptor} from './pipelines.js';

interface CharacterPipelines {
  layout:GPUBindGroupLayout;
  fill:GPURenderPipeline;
  outline:GPURenderPipeline;
  sceneFill:GPURenderPipeline;
  sceneOutline:GPURenderPipeline;
}
type SubdivisionPipelines=Record<keyof typeof subdivisionShaderSources,GPUComputePipeline>;
interface DevicePrograms {character?:CharacterPipelines;subdivision?:SubdivisionPipelines}
const devices=new WeakMap<GPUDevice,DevicePrograms>();
const lostDevices=new WeakSet<GPUDevice>();

function programs(device:GPUDevice):DevicePrograms {
  if(lostDevices.has(device))throw new Error('Character graphics device was lost.');
  let entry=devices.get(device);
  if(!entry){
    entry={};devices.set(device,entry);
    void device.lost.then(()=>{lostDevices.add(device);devices.delete(device);});
  }
  return entry;
}

/** Programs depend on the device and attachment formats, never an actor's geometry. */
export function characterDevicePipelines(device:GPUDevice):CharacterPipelines {
  const entry=programs(device);
  if(!entry.character){
    const layout=device.createBindGroupLayout({entries:characterBindGroupLayoutEntries()});
    const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]});
    const module=device.createShaderModule({code:characterShaderSource});
    const create=(outline:boolean,scene:boolean)=>device.createRenderPipeline(characterPipelineDescriptor(module,pipelineLayout,outline,scene));
    entry.character={layout,fill:create(false,false),outline:create(true,false),sceneFill:create(false,true),sceneOutline:create(true,true)};
  }
  return entry.character;
}

/** Mutable cage, skeleton, output buffers, and bind groups remain owned by the pose. */
export function subdivisionDevicePipelines(device:GPUDevice):SubdivisionPipelines {
  const entry=programs(device);
  if(!entry.subdivision){
    const create=(code:string)=>device.createComputePipeline(subdivisionPipelineDescriptor(device.createShaderModule({code})));
    entry.subdivision={skin:create(subdivisionShaderSources.skin),subdivision:create(subdivisionShaderSources.subdivision),normals:create(subdivisionShaderSources.normals)};
  }
  return entry.subdivision;
}
