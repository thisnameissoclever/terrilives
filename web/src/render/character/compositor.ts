import {compositorShaderSource,compositorPipelineDescriptor} from './pipelines.js';
import { layeredDepth, LAYER_SIM } from '../iso.js';
import type { CharacterRenderer } from './renderer.js';
import type {Vec3} from './math.js';

/** Dynamic geometry joins the same depth attachment as ordinary game sprites. */
export class CharacterCompositor {
  private readonly pipeline: GPURenderPipeline;
  private readonly group: GPUBindGroup;
  private readonly uniform: GPUBuffer;
  private readonly placement = new Float32Array(16);
  get placementData(): Float32Array<ArrayBuffer> { return this.placement.slice(0,8); }
  constructor(private readonly device: GPUDevice, format: GPUTextureFormat, actor: CharacterRenderer) {
    const module=device.createShaderModule({code:compositorShaderSource});
    this.pipeline=device.createRenderPipeline(compositorPipelineDescriptor(module));
    this.uniform = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.group = device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: this.uniform } }, { binding: 1, resource: actor.color.createView() },
      { binding: 2, resource: actor.surface.createView() },
      { binding: 3, resource: actor.identity.createView() },
    ] });
  }
  place(rect: readonly [number, number, number, number], viewport: readonly [number, number], world: readonly [number, number], gridSize: number,light:Vec3=[1,1,1],colourway:Vec3=[0,0,0]): void {
    const depth = layeredDepth(world[0], world[1], gridSize, LAYER_SIM);
    const step = depth - layeredDepth(world[0]+1, world[1], gridSize, LAYER_SIM);
    this.placement.set([...rect, ...viewport, depth, step]);
    this.placement.set([...light,1,...colourway,0],8);
    this.device.queue.writeBuffer(this.uniform, 0, this.placement);
  }
  draw(pass: GPURenderPassEncoder): void { pass.setPipeline(this.pipeline); pass.setBindGroup(0, this.group); pass.draw(6); }
  destroy(): void { this.uniform.destroy(); }
}
