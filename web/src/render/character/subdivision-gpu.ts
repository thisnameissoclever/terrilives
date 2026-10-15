import type { Geometry } from './bundle.js';
import type { StaticCharacterBuffers } from './resources.js';
import {subdivisionDevicePipelines} from './device-pipelines.js';

/** Preserve the source order: configured cage, skin, subdivision, surface normals. */
export class SubdivisionGpu {
  private readonly owned: GPUBuffer[]=[];
  readonly cage: GPUBuffer;
  private readonly passes: {pipeline:GPUComputePipeline;group:GPUBindGroup;count:number}[]=[];
  constructor(private readonly device:GPUDevice, geometry:Geometry, vertex:GPUBuffer, index:GPUBuffer, skeleton:GPUBuffer, shared:StaticCharacterBuffers) {
    const upload=(data:ArrayBufferView<ArrayBuffer>)=>{
      const b=device.createBuffer({size:data.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
      device.queue.writeBuffer(b,0,data);this.owned.push(b);return b;
    };
    this.cage=upload(geometry.cage);
    const posed=device.createBuffer({size:geometry.description.cageCount*32,usage:GPUBufferUsage.STORAGE});this.owned.push(posed);
    const {ranges,weights,normalRanges,normalTriangles}=shared;
    const pipelines=subdivisionDevicePipelines(device);
    const add=(pipeline:GPUComputePipeline,buffers:GPUBuffer[],count:number)=>{
      const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:buffers.map((buffer,binding)=>({binding,resource:{buffer}}))});
      this.passes.push({pipeline,group,count});
    };
    add(pipelines.skin,[this.cage,posed,skeleton],geometry.description.cageCount);
    add(pipelines.subdivision,[posed,ranges,weights,vertex],geometry.description.vertexCount);
    add(pipelines.normals,[vertex,index,normalRanges,normalTriangles,ranges],geometry.description.vertexCount);
  }
  update(cage:Float32Array<ArrayBuffer>):void{this.device.queue.writeBuffer(this.cage,0,cage);}
  get allocatedBufferBytes():number{return this.owned.reduce((bytes,buffer)=>bytes+buffer.size,0);}
  encode(encoder:GPUCommandEncoder):void {
    for(const stage of this.passes){const pass=encoder.beginComputePass();pass.setPipeline(stage.pipeline);pass.setBindGroup(0,stage.group);pass.dispatchWorkgroups(Math.ceil(stage.count/64));pass.end();}
  }
  destroy():void{for(const b of this.owned)b.destroy();}
}
