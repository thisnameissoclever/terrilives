import type { SceneTarget } from './scene-target.js';
import { SCENE_COLOR_FORMAT, sceneColorFunctions } from './scene-sampling.js';
import { screenX, screenY, layeredDepth, LAYER_SIM, FLOOR_DEPTH } from './iso.js';
import type { Ambient } from './daylight.js';
import { weatherAt, type WeatherTuning } from './weather.js';
import { sampleWeatherParticles, weatherCandidates, INITIAL_WEATHER_PARTICLES, WEATHER_PARTICLE_FLOATS } from './weather-particles.js';

export const weatherShader = sceneColorFunctions + `
struct View {canvas:vec2f,origin:vec2f,scale:f32,width:u32,height:u32,pad:f32};
struct Particle {position:vec4f,shape:vec4f,color:vec4f};
@group(0) @binding(0) var<uniform> view:View;
@group(0) @binding(1) var<storage,read> particles:array<Particle>;
@group(0) @binding(2) var<storage,read> outside:array<u32>;
struct Vertex {@builtin(position) position:vec4f,@location(0) uv:vec2f,
 @location(1) @interpolate(flat) row:u32,@location(2) pixel:vec2f};
@vertex fn vertex(@builtin(vertex_index) i:u32,@builtin(instance_index) row:u32)->Vertex {
 let p=particles[row];let q=array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1))[i];
 let local=q*vec2f(p.position.w,p.shape.x);let c=cos(p.shape.y);let s=sin(p.shape.y);
 let pixel=p.position.xy+vec2f(c*local.x-s*local.y,s*local.x+c*local.y);
 var out:Vertex;out.position=vec4f(pixel/view.canvas*vec2f(2,-2)+vec2f(-1,1),p.position.z,1.);
 out.uv=q;out.row=row;out.pixel=pixel;return out;
}
@fragment fn fragment(input:Vertex)->@location(0) vec4f {
 // Clip the displayed footprint as well as the particle's world position.
 // A flake above the yard must not paint onto the cutaway house interior.
 let delta=(input.pixel-view.origin)/view.scale;
 let tile=vec2i(floor(vec2f((delta.x/32.+delta.y/21.)*.5,(delta.y/21.-delta.x/32.)*.5)+.5));
 if(tile.x<0||tile.y<0||tile.x>=i32(view.width)||tile.y>=i32(view.height)){discard;}
 if(outside[u32(tile.y)*view.width+u32(tile.x)]==0u){discard;}
 let p=particles[input.row];let q=input.uv;
 var coverage=1.-smoothstep(.55,1.,dot(q,q));
 var color=p.color.rgb;
 if(p.shape.z>0.5){
  let edge=abs(q.y)-(.82*(1.-q.x*q.x));
  coverage=1.-smoothstep(-.12,.05,edge);
  color*=select(1.,.65,abs(q.y)<.08);
 }
 let alpha=coverage*p.shape.w;if(alpha<.01){discard;}
 return vec4f(sceneLinear(color)*alpha,alpha);
}`;

/** Bounded visual effects; never writes scene depth, ownership, or household state. */
export class WeatherScene {
  private readonly uniform: GPUBuffer;
  private particles: GPUBuffer;
  private mask: GPUBuffer;
  private readonly pipeline: GPURenderPipeline;
  private group: GPUBindGroup | null = null;
  private world = new Float32Array(INITIAL_WEATHER_PARTICLES * WEATHER_PARTICLE_FLOATS);
  private packed = new Float32Array(INITIAL_WEATHER_PARTICLES * WEATHER_PARTICLE_FLOATS);
  private readonly view = new ArrayBuffer(32);
  private outside = new Float32Array();
  private width = 0;
  private height = 0;
  private originX = 0;
  private originY = 0;
  private count = 0;
  private closed = false;

  constructor(private readonly device: GPUDevice) {
    this.uniform = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.particles = device.createBuffer({ size: this.packed.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.mask = device.createBuffer({ size: 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const module = device.createShaderModule({ code: weatherShader });
    this.pipeline = device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vertex' },
      fragment: { module, entryPoint: 'fragment', targets: [{ format: SCENE_COLOR_FORMAT, blend: {
        color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
      } }] }, primitive: { topology: 'triangle-list' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' } });
  }

  setOutside(tiles: readonly (readonly [number, number])[], width: number, height: number, originX = 0, originY = 0): void {
    this.width = width; this.height = height;
    // Sampling uses the original content-lot frame. Clipping stays lot-local.
    this.originX = originX; this.originY = originY;
    this.outside = weatherCandidates(tiles, originX, originY);
    const floats = this.outside.length / 2 * WEATHER_PARTICLE_FLOATS;
    if (floats > this.world.length) {
      this.world = new Float32Array(floats);
      this.packed = new Float32Array(floats);
      this.particles.destroy();
      this.particles = this.device.createBuffer({ size: this.packed.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      this.group = null;
    }
    const mask = new Uint32Array(width * height);
    for (const [x, y] of tiles) mask[y * width + x] = 1;
    if (this.mask.size < mask.byteLength) {
      this.mask.destroy();
      this.mask = this.device.createBuffer({ size: mask.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      this.group = null;
    }
    this.device.queue.writeBuffer(this.mask, 0, mask);
  }

  prepare(tick: number, dayTicks: number, season: number, tuning: WeatherTuning | null,
    originX: number, originY: number, scale: number, gridSize: number, ambient: Ambient, reducedMotion: boolean): void {
    this.count = tuning ? sampleWeatherParticles(this.world, tick, weatherAt(tick, dayTicks, season, tuning), this.outside, reducedMotion) : 0;
    const view = new Float32Array(this.view), words = new Uint32Array(this.view);
    view[2] = originX; view[3] = originY; view[4] = scale; words[5] = this.width; words[6] = this.height;
    for (let i = 0; i < this.count; i++) {
      const at = i * WEATHER_PARTICLE_FLOATS, x = this.world[at] + this.originX,
        y = this.world[at + 1] + this.originY, z = this.world[at + 2];
      this.packed[at] = screenX(x, y, originX, scale);
      this.packed[at + 1] = screenY(x, y, originY, scale) - z * Math.sqrt(1166) * scale;
      this.packed[at + 2] = z === 0 ? FLOOR_DEPTH - 0.000001 : layeredDepth(x, y, gridSize, LAYER_SIM);
      this.packed[at + 3] = this.world[at + 3] * scale;
      this.packed[at + 4] = this.world[at + 4] * scale;
      this.packed[at + 5] = this.world[at + 5];
      this.packed[at + 6] = this.world[at + 6];
      this.packed[at + 7] = this.world[at + 7];
      for (let channel = 0; channel < 3; channel++) this.packed[at + 8 + channel] = this.world[at + 8 + channel] * ambient[channel];
    }
  }

  draw = (encoder: GPUCommandEncoder, target: SceneTarget): void => {
    if (this.closed || !this.count) return;
    const view = new Float32Array(this.view); view[0] = target.logicalWidth; view[1] = target.logicalHeight;
    this.device.queue.writeBuffer(this.uniform, 0, this.view);
    this.device.queue.writeBuffer(this.particles, 0, this.packed, 0, this.count * WEATHER_PARTICLE_FLOATS);
    this.group ??= this.device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: this.uniform } }, { binding: 1, resource: { buffer: this.particles } },
      { binding: 2, resource: { buffer: this.mask } },
    ] });
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.color.createView(), loadOp: 'load', storeOp: 'store' }],
      depthStencilAttachment: { view: target.depth.createView(), depthLoadOp: 'load', depthStoreOp: 'store' } });
    pass.setPipeline(this.pipeline); pass.setBindGroup(0, this.group); pass.draw(6, this.count); pass.end();
  };

  destroy(): void {
    if (this.closed) return;
    this.closed = true; this.uniform.destroy(); this.particles.destroy(); this.mask.destroy();
  }
}
