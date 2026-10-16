import {FLOATS_PER_INSTANCE,type InstanceArray} from './instances.js';
import {type SceneTarget} from './scene-target.js';

/** A dedicated packed command; placement tile rings keep their ordinary sprite path. */
export const GROUND_SELECTION_COMMAND=-14;

/** The selection command keeps its packed position but bypasses bitmap sampling. */
export function selectionCommand(instances:InstanceArray,count:number):number {
 for(let row=0;row<count;row++)if(instances[row*FLOATS_PER_INSTANCE+8]===GROUND_SELECTION_COMMAND)return row;
 return -1;
}

export const groundSelectionShader=`
struct View { canvas:vec2f, centre:vec2f, radius:vec2f, depth:f32, pad:f32 };
@group(0) @binding(0) var<uniform> u:View;
struct Vertex { @builtin(position) position:vec4f, @location(0) local:vec2f };
@vertex fn vs(@builtin(vertex_index) i:u32)->Vertex {
 let q=array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1))[i];
 var o:Vertex; let p=u.centre+q*(u.radius+vec2f(4));
 o.position=vec4f(p/u.canvas*vec2f(2,-2)+vec2f(-1,1),u.depth,1);
 o.local=q*(u.radius+vec2f(4));return o;
}
fn linear(c:vec3f)->vec3f {
 return select(pow((c+.055)/1.055,vec3f(2.4)),c/12.92,c<=vec3f(.04045));
}
@fragment fn fs(i:Vertex)->@location(0) vec4f {
 let dist=(length(i.local/u.radius)-1.)*min(u.radius.x,u.radius.y);
 let aa=max(fwidth(dist),.42);
 // The approved 1.3-pixel border is now 1.5 times as thick: 1.95 pixels.
 let edge=1.-smoothstep(.975-aa,.975+aa,abs(dist));
 let fill=(1.-smoothstep(-aa,aa,dist))*.105;
 let opacity=edge*.94+(1.-edge)*fill;
 if(opacity<.001){discard;}
 return vec4f(linear(vec3f(.29,.77,.98))*opacity,opacity);
}`;

/** Translucent floor color never replaces world identity or physical depth. */
export class GroundSelectionRenderer {
 private readonly pipeline:GPURenderPipeline;
 private readonly uniform:GPUBuffer;
 private readonly group:GPUBindGroup;
 private readonly values=new Float32Array(8);
 constructor(private readonly device:GPUDevice){
  const module=device.createShaderModule({label:'Selected person floor ellipse',code:groundSelectionShader});
  this.pipeline=device.createRenderPipeline({label:'Selected person floor ellipse',layout:'auto',vertex:{module,entryPoint:'vs'},
   fragment:{module,entryPoint:'fs',targets:[{format:'rgba16float',blend:{
    color:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'},
    alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}]},
   primitive:{topology:'triangle-list'},
   depthStencil:{format:'depth24plus',depthWriteEnabled:false,depthCompare:'less'}});
  this.uniform=device.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  this.group=device.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.uniform}}]});
 }
 draw(encoder:GPUCommandEncoder,target:SceneTarget,instances:InstanceArray,row:number,scale:number):void {
  if(row<0)return;
  const offset=row*FLOATS_PER_INSTANCE,v=this.values;
  v[0]=target.logicalWidth;v[1]=target.logicalHeight;v[2]=instances[offset];v[3]=instances[offset+1];
  v[4]=30*scale;v[5]=19.6875*scale;v[6]=instances[offset+2];
  this.device.queue.writeBuffer(this.uniform,0,v);
  const pass=encoder.beginRenderPass({colorAttachments:[{view:target.color.createView(),loadOp:'load',storeOp:'store'}],
   depthStencilAttachment:{view:target.depth.createView(),depthLoadOp:'load',depthStoreOp:'store'}});
  pass.setPipeline(this.pipeline);pass.setBindGroup(0,this.group);pass.draw(6);pass.end();
 }
 destroy():void {this.uniform.destroy();}
}
