import type {SceneTarget} from '../scene-target.js';
import {SCENE_COLOR_FORMAT,sceneColorFunctions} from '../scene-sampling.js';
import type {SteamEnvelope} from './steam-envelope.js';
import type {Vec3} from './math.js';

export const showerSteamShader=sceneColorFunctions+`
struct View {canvas:vec2f,pad:vec2f};
struct Cloud {centre:vec4f,radii:vec4f,screen:vec4f,light:vec4f,cabin:vec4f,
 chest:vec4f,chestR:vec4f,pelvis:vec4f,pelvisR:vec4f};
@group(0) @binding(0) var<uniform> view:View;
@group(0) @binding(1) var<storage,read> clouds:array<Cloud>;
@group(0) @binding(2) var opaque:texture_2d<f32>;
struct Vertex {@builtin(position) position:vec4f,@location(0) screen:vec2f,@location(1) @interpolate(flat) cloud:u32};
@vertex fn vertex(@builtin(vertex_index) i:u32,@builtin(instance_index) instance:u32)->Vertex {
 let cloud=clouds[instance];let q=array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1))[i];
 let r=cloud.radii.xyz;
 let extent=vec2f(32.*(r.x+r.y),21.*(r.x+r.y)+sqrt(1166.)*r.z)*cloud.screen.z;
 let pixel=cloud.screen.xy+q*extent;
 var out:Vertex;out.position=vec4f(pixel/view.canvas*vec2f(2,-2)+vec2f(-1,1),0.,1.);out.screen=pixel;out.cloud=instance;return out;
}
struct Density {value:f32,gradient:vec3f};
fn envelope(point:vec3f,centre:vec3f,radii:vec3f)->Density {
 let delta=(point-centre)/radii;let q=dot(delta,delta);var out:Density;
 if(q>=1.){out.value=0.;out.gradient=vec3f(0);return out;}
 out.value=(1.-q)*(1.-q);out.gradient=-4.*(1.-q)*delta/radii;return out;
}
fn densityAt(point:vec3f,cloud:Cloud)->Density {
 let chest=envelope(point,cloud.chest.xyz,cloud.chestR.xyz);
 let pelvis=envelope(point,cloud.pelvis.xyz,cloud.pelvisR.xyz);
 let support=chest.value+pelvis.value;
 var out:Density;if(support<.00001){out.value=0.;out.gradient=vec3f(0);return out;}
 // Nested periodic fields advect curled filaments around the whole body.
 let q=(point-cloud.chest.xyz)*vec3f(5.,5.,7.);let phase=cloud.radii.w;
 let u=q.x*1.5+.9*sin(q.y+phase);let v=q.z-phase;
 let f=sin(u)+.7*sin(v);
 let df=vec3f(1.5*cos(u),.9*cos(u)*cos(q.y+phase),.7*cos(v))*vec3f(5.,5.,7.);
 let w=q.y*1.7-.8*sin(q.z+phase);let z=q.x-phase;
 let g=sin(w)+.7*cos(z);
 let dg=vec3f(-.7*sin(z),1.7*cos(w),-.8*cos(w)*cos(q.z+phase))*vec3f(5.,5.,7.);
 let first=exp(-6.*f*f);let second=exp(-6.*g*g);
 let filament=.60*first+.40*second;
 let gradient=-12.*(.60*f*first*df+.40*g*second*dg);
 let structure=.012+.90*filament;
 let headStart=cloud.chest.z+cloud.chestR.z*.70;let headEnd=cloud.chest.z+cloud.chestR.z*1.25;
 let headClear=1.-smoothstep(headStart,headEnd,point.z);
 out.value=support*structure*headClear;
 out.gradient=((chest.gradient+pelvis.gradient)*structure+support*.90*gradient)*headClear;
 return out;
}
struct Fragment {@location(0) color:vec4f,@builtin(frag_depth) depth:f32};
@fragment fn fragment(input:Vertex)->Fragment {
 let cloud=clouds[input.cloud];let delta=(input.screen-cloud.screen.xy)/cloud.screen.z;
 let origin=vec3f((delta.x/32.+delta.y/21.)*.5,(delta.x/32.-delta.y/21.)*.5,0.);
 let direction=vec3f(1.,-1.,42./sqrt(1166.));
 var near=-10000.;var far=10000.;
 for(var axis=0u;axis<3u;axis++){
  let a=(-cloud.radii[axis]-origin[axis])/direction[axis];let b=(cloud.radii[axis]-origin[axis])/direction[axis];
  near=max(near,min(a,b));far=min(far,max(a,b));
 }
 let c=cos(cloud.cabin.z);let s=sin(cloud.cabin.z);
 let planes=array<vec3f,2>(vec3f(-c,-s,-cloud.cabin.x),vec3f(-s,c,cloud.cabin.y));
 for(var plane=0u;plane<2u;plane++){
  let normal=planes[plane].xy;let distance=planes[plane].z-dot(normal,cloud.centre.xy+origin.xy);let denominator=dot(normal,direction.xy);
  if(abs(denominator)<.00001){if(distance<0.){far=near-1.;}}
  else if(denominator>0.){far=min(far,distance/denominator);}else{near=max(near,distance/denominator);}
 }
 // Only vapor in front of this exact opaque sample contributes to opacity.
 let depth=textureLoad(opaque,vec2i(input.position.xy),0).r;
 let opaqueT=((cloud.centre.w-depth)/cloud.screen.w-cloud.centre.x+cloud.centre.y-origin.x+origin.y)*.5;
 near=max(near,opaqueT);if(far<=near){discard;}
 let dt=(far-near)/48.;let ds=length(direction)*dt;var opacity=0.;var scattering=vec3f(0);
 for(var sample=0u;sample<48u;sample++){
  let point=cloud.centre.xyz+origin+(far-(f32(sample)+.5)*dt)*direction;
  let density=densityAt(point,cloud);
  let alpha=1.-exp(-density.value*ds*24.);
  let normal=-density.gradient*inverseSqrt(max(dot(density.gradient,density.gradient),.000001));
  let illumination=.18+.82*max(0.,dot(normal,normalize(vec3f(-.45,-.35,.82))));
  let encoded=mix(vec3f(.38,.50,.59),vec3f(.96,.98,1.),illumination);
  scattering+=(1.-opacity)*alpha*sceneLinear(encoded*cloud.light.rgb);opacity+=(1.-opacity)*alpha;
 }
 if(opacity<.002){discard;}
 let front=origin+far*direction;
 var out:Fragment;out.color=vec4f(scattering,opacity);
 out.depth=cloud.centre.w-((cloud.centre.x+front.x)-(cloud.centre.y+front.y))*cloud.screen.w;
 return out;
}`;

const FIELD_FLOATS=36;
const VAPOR_SPREAD=1.45;
/** Sample one heterogeneous vapor field, without changing opaque ownership or depth. */
export class ShowerSteam {
 private readonly uniform:GPUBuffer;
 private readonly particles:GPUBuffer;
 private readonly pipeline:GPURenderPipeline;
 private readonly groups=new WeakMap<SceneTarget,GPUBindGroup>();
 private readonly data=new Float32Array(64*FIELD_FLOATS);
 private readonly viewport=new Float32Array(4);
 private count=0;
 private closed=false;
 constructor(private readonly device:GPUDevice){
  this.uniform=device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  this.particles=device.createBuffer({size:this.data.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
  const module=device.createShaderModule({code:showerSteamShader});
  this.pipeline=device.createRenderPipeline({layout:'auto',vertex:{module,entryPoint:'vertex'},
   fragment:{module,entryPoint:'fragment',targets:[{format:SCENE_COLOR_FORMAT,blend:{
    color:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}]},
   primitive:{topology:'triangle-list'},depthStencil:{format:'depth24plus',depthWriteEnabled:false,depthCompare:'less'}});
 }
 begin():void{this.count=0;}
 get allocatedBufferBytes():number{return this.uniform.size+this.particles.size;}
 add(envelopes:readonly SteamEnvelope[],x:number,y:number,scale:number,depth:number,step:number,phase:number,light:Vec3,cabin:readonly[number,number],angle:number):void {
  if(this.count>=64)throw new Error('Too many shower vapor fields.');
  const chest=envelopes[0],pelvis=envelopes[1],at=this.count++*FIELD_FLOATS;
  const minX=Math.min(chest.centre[0]-chest.radii[0]*VAPOR_SPREAD,pelvis.centre[0]-pelvis.radii[0]*VAPOR_SPREAD),maxX=Math.max(chest.centre[0]+chest.radii[0]*VAPOR_SPREAD,pelvis.centre[0]+pelvis.radii[0]*VAPOR_SPREAD);
  const minY=Math.min(chest.centre[1]-chest.radii[1]*VAPOR_SPREAD,pelvis.centre[1]-pelvis.radii[1]*VAPOR_SPREAD),maxY=Math.max(chest.centre[1]+chest.radii[1]*VAPOR_SPREAD,pelvis.centre[1]+pelvis.radii[1]*VAPOR_SPREAD);
  const minZ=Math.min(chest.centre[2]-chest.radii[2],pelvis.centre[2]-pelvis.radii[2]),maxZ=Math.max(chest.centre[2]+chest.radii[2],pelvis.centre[2]+pelvis.radii[2]);
  const data=this.data;
  data[at+3]=depth;data[at+7]=phase;data[at+10]=scale;data[at+11]=step;
  data[at+12]=light[0];data[at+13]=light[1];data[at+14]=light[2];data[at+15]=0;
  data[at+16]=cabin[0];data[at+17]=cabin[1];data[at+18]=angle;data[at+19]=0;
  for(let axis=0;axis<3;axis++){
   data[at+20+axis]=chest.centre[axis];data[at+24+axis]=chest.radii[axis]*(axis===2?1:VAPOR_SPREAD);
   data[at+28+axis]=pelvis.centre[axis];data[at+32+axis]=pelvis.radii[axis]*(axis===2?1:VAPOR_SPREAD);
  }
  data[at+23]=data[at+27]=data[at+31]=data[at+35]=0;
  const bx=(minX+maxX)/2,by=(minY+maxY)/2,bz=(minZ+maxZ)/2;
  data[at]=bx;data[at+1]=by;data[at+2]=bz;
  data[at+4]=(maxX-minX)/2;data[at+5]=(maxY-minY)/2;data[at+6]=(maxZ-minZ)/2;
  data[at+8]=x+(bx+by)*32*scale;data[at+9]=y+((bx-by)*21-bz*Math.sqrt(1166))*scale;
 }
 draw(encoder:GPUCommandEncoder,target:SceneTarget):void {
  if(!this.count||this.closed)return;
  this.viewport[0]=target.logicalWidth;this.viewport[1]=target.logicalHeight;
  this.device.queue.writeBuffer(this.uniform,0,this.viewport);
  this.device.queue.writeBuffer(this.particles,0,this.data,0,this.count*FIELD_FLOATS);
  let group=this.groups.get(target);
  if(!group){group=this.device.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[
   {binding:0,resource:{buffer:this.uniform}},{binding:1,resource:{buffer:this.particles}},{binding:2,resource:target.surface.createView()}]});this.groups.set(target,group);}
  const pass=encoder.beginRenderPass({colorAttachments:[{view:target.color.createView(),loadOp:'load',storeOp:'store'}],
   depthStencilAttachment:{view:target.depth.createView(),depthLoadOp:'load',depthStoreOp:'store'}});
  pass.setPipeline(this.pipeline);pass.setBindGroup(0,group);pass.draw(6,this.count);pass.end();
 }
 destroy():void{if(this.closed)return;this.closed=true;this.uniform.destroy();this.particles.destroy();}
}
