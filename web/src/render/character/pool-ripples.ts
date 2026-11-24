import type {SceneTarget} from '../scene-target.js';
import {SCENE_COLOR_FORMAT,sceneColorFunctions} from '../scene-sampling.js';
import type {Vec3} from './math.js';
import type {PoolRippleContact,PoolWaterFootprint} from './pool-water-contact.js';

interface RippleFrame {
  x:number;y:number;scale:number;depth:number;depthStep:number;angle:number;
  owner:number;water:PoolWaterFootprint;light:Vec3;phase:number;
}

const shader=sceneColorFunctions+`
struct View { canvas:vec4f };
struct Ripple {
  source:vec4f,
  origin:vec4f,
  water:vec4f,
  bounds:vec4f,
  lighting:vec4f,
  effect:vec4f,
  cutout:vec4f,
};
@group(0) @binding(0) var<uniform> view:View;
@group(0) @binding(1) var<storage,read> ripples:array<Ripple>;
@group(0) @binding(2) var opaqueDepth:texture_2d<f32>;
@group(0) @binding(3) var opaqueOwner:texture_2d<u32>;

struct Vertex {
  @builtin(position) position:vec4f,
  @location(0) local:vec2f,
  @location(1) @interpolate(flat) ripple:u32,
};
fn rotate(point:vec2f,rotation:vec2f)->vec2f {
  return vec2f(rotation.x*point.x-rotation.y*point.y,rotation.y*point.x+rotation.x*point.y);
}
@vertex fn vertex(@builtin(vertex_index) i:u32,@builtin(instance_index) instance:u32)->Vertex {
  let ripple=ripples[instance];
  let corner=array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1))[i];
  let local=ripple.source.xy+corner*ripple.source.z;
  let point=rotate(local,ripple.water.xy);
  let screen=ripple.origin.xy+
    vec2f((point.x+point.y)*32.,(point.x-point.y)*21.-ripple.water.z*sqrt(1166.))*ripple.origin.z;
  var out:Vertex;
  out.position=vec4f(screen/view.canvas.xy*vec2f(2,-2)+vec2f(-1,1),0.,1.);
  out.local=local;out.ripple=instance;return out;
}

struct Fragment { @location(0) color:vec4f, @builtin(frag_depth) depth:f32 };
@fragment fn fragment(input:Vertex)->Fragment {
  let ripple=ripples[input.ripple];
  if(any(input.local<=ripple.bounds.xy)||any(input.local>=ripple.bounds.zw)){discard;}

  if(ripple.cutout.w>0. && input.local.x>=ripple.cutout.x && input.local.x<=ripple.cutout.y && input.local.y>=ripple.cutout.z){discard;}

  // A rail and the pool share a pick owner. Accept only the samples that
  // also lie on the registered basin surface, within its pixel quantization.
  let pixel=vec2i(input.position.xy);
  if(textureLoad(opaqueOwner,pixel,0).r!=u32(ripple.effect.x)){discard;}
  let point=rotate(input.local,ripple.water.xy);
  let planeDepth=ripple.origin.w-(point.x-point.y)*ripple.water.w;
  let surfaceDepth=textureLoad(opaqueDepth,pixel,0).r;
  if(abs(planeDepth-surfaceDepth)>.024*ripple.water.w){discard;}

  let relative=(input.local-ripple.source.xy)/ripple.source.z;
  let distance=length(relative);
  let disturbance=ripple.effect.y;
  let phase=ripple.lighting.w;
  let crescent=.58+.42*sin(dot(relative,vec2f(4,-3))+phase);
  let wobble=.035*sin(relative.x*9.+relative.y*5.+phase);
  let wave=distance+wobble;
  let primary=1.-smoothstep(.028,.095,abs(wave-mix(.68,.83,disturbance)));
  let secondary=1.-smoothstep(.020,.072,abs(wave-.93));
  let opacity=ripple.source.w*(primary*mix(crescent,1.,disturbance)+.38*secondary);
  if(opacity<=.002){discard;}
  let hue=mix(vec3f(.61,.80,.92),vec3f(.73,.87,.95),disturbance);
  var out:Fragment;
  out.color=vec4f(sceneLinear(hue*ripple.lighting.rgb)*opacity,opacity);
  // Quantize to the same hardware depth as the scene's visible water sample.
  out.depth=surfaceDepth;
  return out;
}`;

export function poolRipplePipelineDescriptor(module:GPUShaderModule):GPURenderPipelineDescriptor {
  const alpha:GPUBlendComponent={srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'};
  return {layout:'auto',vertex:{module,entryPoint:'vertex'},
    fragment:{module,entryPoint:'fragment',targets:[{format:SCENE_COLOR_FORMAT,blend:{color:alpha,alpha}}]},
    primitive:{topology:'triangle-list'},
    depthStencil:{format:'depth24plus',depthWriteEnabled:false,depthCompare:'less-equal'},
  };
}

const STRIDE=28;
const CAPACITY=256;
const WATER_INSET=.018;

/** One bounded color pass over the already resolved opaque scene. */
export class PoolRipples {
  private readonly viewport=new Float32Array(4);
  private readonly records=new Float32Array(CAPACITY*STRIDE);
  private readonly uniform:GPUBuffer;
  private readonly instances:GPUBuffer;
  private readonly pipeline:GPURenderPipeline;
  private readonly groups=new WeakMap<SceneTarget,GPUBindGroup>();
  private count=0;

  constructor(private readonly device:GPUDevice){
    this.uniform=device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    this.instances=device.createBuffer({size:this.records.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
    this.pipeline=device.createRenderPipeline(poolRipplePipelineDescriptor(device.createShaderModule({code:shader})));
  }
  get allocatedBufferBytes():number{return this.uniform.size+this.instances.size;}
  get active():boolean{return this.count>0;}
  begin():void{this.count=0;}
  add(contact:PoolRippleContact,frame:RippleFrame,landing=false):void{
    if(this.count>=CAPACITY)return;
    const {minimum,maximum,height,cutout}=frame.water;
    this.records.set([
      contact.x,contact.y,contact.radius,contact.strength,
      frame.x,frame.y,frame.scale,frame.depth,
      Math.cos(frame.angle),Math.sin(frame.angle),height,frame.depthStep,
      minimum[0]+WATER_INSET,minimum[1]+WATER_INSET,maximum[0]-WATER_INSET,maximum[1]-WATER_INSET,
      ...frame.light,frame.phase,
      frame.owner,Number(landing),0,0,
      cutout?.[0]??0,cutout?.[1]??0,cutout?.[2]??0,Number(!!cutout),
    ],this.count++*STRIDE);
  }
  draw(encoder:GPUCommandEncoder,target:SceneTarget):void{
    if(!this.count)return;
    this.viewport[0]=target.logicalWidth;this.viewport[1]=target.logicalHeight;
    this.device.queue.writeBuffer(this.uniform,0,this.viewport);
    this.device.queue.writeBuffer(this.instances,0,this.records,0,this.count*STRIDE);
    let group=this.groups.get(target);
    if(!group){
      group=this.device.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[
        {binding:0,resource:{buffer:this.uniform}},
        {binding:1,resource:{buffer:this.instances}},
        {binding:2,resource:target.surface.createView()},
        {binding:3,resource:target.identity.createView()},
      ]});
      this.groups.set(target,group);
    }
    const pass=encoder.beginRenderPass({
      colorAttachments:[{view:target.color.createView(),loadOp:'load',storeOp:'store'}],
      depthStencilAttachment:{view:target.depth.createView(),depthLoadOp:'load',depthStoreOp:'store'},
    });
    pass.setPipeline(this.pipeline);pass.setBindGroup(0,group);pass.draw(6,this.count);pass.end();
  }
  destroy():void{this.uniform.destroy();this.instances.destroy();}
}
