import {worldPickingShaderSource,worldPickingPipelineDescriptor} from './pipelines.js';
import type { CharacterRenderer } from './renderer.js';
import type { CharacterCompositor } from './compositor.js';

/** Resolve actor ownership only where the final world depth still exposes its surface. */
export class CharacterWorldPicker {
  private readonly pipeline: GPUComputePipeline;
  private readonly uniform: GPUBuffer;
  private readonly output: GPUBuffer;
  private destroyed = false;

  constructor(private readonly device: GPUDevice, private readonly actor: CharacterRenderer,
    private readonly compositor: CharacterCompositor, private readonly sceneDepth: () => GPUTexture) {
    const module=device.createShaderModule({code:worldPickingShaderSource});
    this.pipeline=device.createComputePipeline(worldPickingPipelineDescriptor(module));
    this.uniform=device.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    this.output=device.createBuffer({size:4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
  }

  async pick(x:number,y:number):Promise<number> {
    if(this.destroyed)throw new Error('Character picker is closed');
    const placement=this.compositor.placementData;
    if(!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x>=placement[4]||y>=placement[5])return 0;
    const staging=this.device.createBuffer({size:4,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
    try{
      this.device.queue.writeBuffer(this.uniform,0,new Float32Array([...placement,x,y,0,0]));
      const group=this.device.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[
        {binding:0,resource:{buffer:this.uniform}}, {binding:1,resource:this.actor.identity.createView()},
        {binding:2,resource:this.actor.surface.createView()}, {binding:3,resource:this.sceneDepth().createView()},
        {binding:4,resource:{buffer:this.output}},
      ]});
      const encoder=this.device.createCommandEncoder(),pass=encoder.beginComputePass();
      pass.setPipeline(this.pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(1);pass.end();
      encoder.copyBufferToBuffer(this.output,0,staging,0,4);this.device.queue.submit([encoder.finish()]);
      await staging.mapAsync(GPUMapMode.READ);return new Uint32Array(staging.getMappedRange())[0];
    }finally{staging.unmap();staging.destroy();}
  }

  destroy():void{if(this.destroyed)return;this.destroyed=true;this.uniform.destroy();this.output.destroy();}
}
